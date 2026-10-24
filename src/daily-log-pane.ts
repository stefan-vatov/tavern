/* eslint-disable eslint/max-statements, eslint/no-magic-numbers, eslint/no-ternary */
import { Component, Notice, setIcon } from 'obsidian';
import type { DailyLogController, DailyLogDropTarget } from './daily-log-controller';
import { shiftDay, type DailyNote, type DailyTask } from './daily-note';
import { filterTasks, type ProjectBoardTask } from './project-library';
import { taskDropPlacement, taskNestingDepth } from './task-drag';
import type { TaskEditPlan } from './task-edit';

interface DailyLogPaneOptions {
	day: string;
	query: string;
	onStateChange(state: { day: string; query: string }): void;
	onChanged(): Promise<void>;
	isEditing(): boolean;
	finishEditing(): Promise<void>;
	bindCapture(
		row: HTMLElement,
		input: HTMLInputElement,
		onSave: (plan: TaskEditPlan) => Promise<void>,
	): unknown;
	projectTaskFromDrop(event: DragEvent): ProjectBoardTask | undefined;
	renderTaskText(
		container: HTMLElement,
		text: string,
		options: { depth: number; onSave: (plan: TaskEditPlan) => Promise<void> },
	): void;
}

const DAILY_TASK_MIME = 'application/x-tavern-daily-task';
const DAILY_SOURCE_MIME = 'application/x-tavern-daily-source';
const DAILY_INDENT_STEP = 17;

class DailyLogPane extends Component {
	private day: string;
	private query: string;
	private active = true;
	private revision = 0;
	private note: DailyNote | null = null;
	private renderedLayout = '';
	private errorEl: HTMLElement | undefined;
	private readonly taskRows = new Map<string, { row: HTMLElement; checkbox: HTMLInputElement }>();
	private contentEvents: Component;
	private readonly header: HTMLElement;
	private readonly content: HTMLElement;

	constructor(
		container: HTMLElement,
		private readonly controller: DailyLogController,
		private readonly options: DailyLogPaneOptions,
	) {
		super();
		this.contentEvents = this.addChild(new Component());
		this.day = options.day;
		this.query = options.query;
		container.addClass('tavern-daily-panel');
		this.header = container.createDiv('tavern-daily-header');
		const filter = container.createDiv('tavern-daily-filter');
		const input = filter.createEl('input', {
			cls: 'tavern-search-input',
			type: 'search',
			attr: { placeholder: 'Search log...', 'aria-label': 'Search log' },
		});
		input.value = this.query;
		this.registerDomEvent(input, 'input', () => {
			this.query = input.value;
			this.publishState();
			this.renderContent();
		});
		this.content = container.createDiv('tavern-daily-content');
		this.renderHeader();
		this.registerDrop(this.content, undefined, this);
		this.register(() => {
			this.active = false;
			this.revision += 1;
		});
	}

	async refresh(): Promise<void> {
		const revision = ++this.revision;
		const { day } = this;
		try {
			const snapshot = await this.controller.read(day);
			if (!this.active || revision !== this.revision) {
				return;
			}
			this.note = snapshot.note;
			this.renderContent();
		} catch (error) {
			if (this.active && revision === this.revision) {
				this.showError(error);
			}
		}
	}

	private publishState(): void {
		this.options.onStateChange({ day: this.day, query: this.query });
	}

	private renderHeader(): void {
		this.header.empty();
		this.header.createEl('h2', { cls: 'tavern-detail-title', text: "Captain's Log" });
		this.header.createSpan({ cls: 'tavern-daily-date-chip', text: this.day });
		const nav = this.header.createEl('nav', {
			cls: 'tavern-daily-date-nav',
			attr: { 'aria-label': 'Daily note navigation' },
		});
		const previous = nav.createEl('button', {
			cls: 'tavern-daily-date-step',
			text: '←',
			attr: { 'aria-label': 'Previous day' },
		});
		nav.createSpan({
			cls: 'tavern-daily-date-label',
			text: new Intl.DateTimeFormat(undefined, {
				month: 'long',
				day: 'numeric',
				year: 'numeric',
			}).format(new Date(`${this.day}T12:00:00`)),
		});
		const next = nav.createEl('button', {
			cls: 'tavern-daily-date-step',
			text: '→',
			attr: { 'aria-label': 'Next day' },
		});
		const today = nav.createEl('button', { cls: 'tavern-daily-today', text: 'Today' });
		this.registerDomEvent(previous, 'click', () => void this.selectDay(shiftDay(this.day, -1)));
		this.registerDomEvent(next, 'click', () => void this.selectDay(shiftDay(this.day, 1)));
		this.registerDomEvent(today, 'click', () => void this.selectDay(this.controller.today()));
	}

	private async selectDay(day: string): Promise<void> {
		try {
			await this.options.finishEditing();
		} catch {
			return;
		}
		if (!this.active) {
			return;
		}
		this.day = day;
		this.note = null;
		this.publishState();
		this.renderHeader();
		this.content.empty();
		this.renderedLayout = '';
		await this.refresh();
	}

	private renderContent(): void {
		if (!this.active) {
			return;
		}
		if (this.options.isEditing()) {
			for (const task of this.note?.tasks ?? []) {
				this.updateTaskChecked(task);
			}
			return;
		}
		const layout = JSON.stringify({
			query: this.query,
			items: this.note?.items.map((item) => {
				if (item.type === 'task') {
					return { ...item, task: { ...item.task, checked: false } };
				}
				return item;
			}),
		});
		if (layout === this.renderedLayout) {
			for (const task of this.note?.tasks ?? []) {
				this.updateTaskChecked(task);
			}
			return;
		}
		this.renderedLayout = layout;
		this.taskRows.clear();
		this.removeChild(this.contentEvents);
		this.contentEvents = this.addChild(new Component());
		this.content.empty();
		if (!this.note) {
			this.content.createEl('p', { cls: 'tavern-daily-empty', text: 'No note' });
			const create = this.content.createEl('button', {
				cls: 'tavern-daily-create',
				text: 'Create daily log',
			});
			this.contentEvents.registerDomEvent(
				create,
				'click',
				() => void this.mutate(() => this.controller.create(this.day)),
			);
			return;
		}
		const visible = new Set(filterTasks(this.note.tasks, this.query).map((task) => task.id));
		const firstSection = this.note.items
			.filter((item) => item.type === 'heading')
			.find((item) => item.level === 2);
		let addRendered = false;
		let inPlan = false;
		for (const item of this.note.items) {
			if (item.type === 'heading') {
				if (inPlan && item.level <= 3 && !addRendered) {
					this.renderAddTask();
					addRendered = true;
				}
				inPlan = item.text === 'Plan';
				this.content.createEl(`h${item.level}` as 'h2', {
					cls: `tavern-daily-heading is-level-${item.level}`,
					text: item.text,
				});
			} else if (item.type === 'task') {
				if (visible.has(item.task.id)) {
					this.renderTask(item.task);
				}
			} else if (item.raw.trim() && (!firstSection || item.lineIndex > firstSection.lineIndex)) {
				this.content.createDiv({ cls: 'tavern-daily-text', text: item.raw });
			}
		}
		if (!addRendered) {
			this.renderAddTask();
		}
	}

	private renderAddTask(): void {
		const row = this.content.createDiv('tavern-daily-add-task');
		const input = row.createEl('input', {
			cls: 'tavern-add-task-input',
			attr: { placeholder: 'Add a todo...', 'aria-label': 'Add todo' },
		});
		this.options.bindCapture(row, input, async (plan) => {
			try {
				await this.controller.addTaskPlan(this.day, plan);
			} catch (error) {
				if (this.active) {
					this.showError(error);
					new Notice(`Tavern: ${error instanceof Error ? error.message : String(error)}`);
				}
				throw error;
			}
		});
	}

	private renderTask(task: DailyTask): void {
		const row = this.content.createDiv('tavern-daily-task tavern-project-task');
		const depth = taskNestingDepth(task.indent);
		row.style.setProperty('--tavern-task-depth', String(depth));
		if (depth > 0) {
			row.addClass('is-nested');
		}
		if (task.checked) {
			row.addClass('is-done');
		}
		const handle = row.createEl('button', {
			cls: 'tavern-task-drag-handle',
			attr: { 'aria-label': `Drag ${task.text}`, title: 'Drag to move' },
		});
		handle.draggable = true;
		setIcon(handle, 'grip-vertical');
		this.contentEvents.registerDomEvent(handle, 'click', (event) => event.stopPropagation());
		this.contentEvents.registerDomEvent(handle, 'dragstart', (event) => {
			event.stopPropagation();
			event.dataTransfer?.setData(
				DAILY_TASK_MIME,
				JSON.stringify({ day: this.day, taskId: task.id }),
			);
			if (event.dataTransfer) {
				event.dataTransfer.effectAllowed = 'move';
			}
			row.addClass('is-dragging-task');
		});
		this.contentEvents.registerDomEvent(handle, 'dragend', () =>
			row.removeClass('is-dragging-task'),
		);
		const checkbox = row.createEl('input', {
			type: 'checkbox',
			attr: {
				'aria-label': `Mark ${task.text} ${task.checked ? 'incomplete' : 'complete'}`,
			},
		});
		checkbox.checked = task.checked;
		this.taskRows.set(task.id, { row, checkbox });
		this.contentEvents.registerDomEvent(
			checkbox,
			'change',
			() =>
				void this.mutate(() => this.controller.setTaskChecked(this.day, task.id, checkbox.checked)),
		);
		const text = row.createSpan('tavern-project-task-text');
		this.options.renderTaskText(text, task.text, {
			depth,
			onSave: async (plan) => {
				try {
					await this.controller.editTaskPlan(this.day, task.id, plan);
				} catch (error) {
					if (this.active) {
						this.showError(error);
						new Notice(`Tavern: ${error instanceof Error ? error.message : String(error)}`);
					}
					throw error;
				}
			},
		});
		this.registerDrop(row, task.id);
	}

	private updateTaskChecked(task: DailyTask): void {
		const rendered = this.taskRows.get(task.id);
		if (!rendered) {
			return;
		}
		rendered.checkbox.checked = task.checked;
		rendered.checkbox.setAttribute(
			'aria-label',
			`Mark ${task.text} ${task.checked ? 'incomplete' : 'complete'}`,
		);
		if (task.checked) {
			rendered.row.addClass('is-done');
		} else {
			rendered.row.removeClass('is-done');
		}
	}

	private registerDrop(
		element: HTMLElement,
		taskId?: string,
		events: Component = this.contentEvents,
	): void {
		events.registerDomEvent(element, 'dragover', (event) => {
			if (!this.acceptsDrop(event)) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			if (event.dataTransfer) {
				event.dataTransfer.dropEffect = event.dataTransfer.types.includes(DAILY_TASK_MIME)
					? 'move'
					: 'copy';
			}
			element.addClass('is-drop-target');
			if (taskId) {
				this.clearPlacement(element);
				element.addClass(`is-drop-${taskDropPlacement(element, event, DAILY_INDENT_STEP)}`);
			}
		});
		events.registerDomEvent(element, 'dragleave', () => this.clearDrop(element));
		events.registerDomEvent(element, 'drop', (event) => {
			event.preventDefault();
			event.stopPropagation();
			this.clearDrop(element);
			const target = taskId
				? { taskId, placement: taskDropPlacement(element, event, DAILY_INDENT_STEP) }
				: undefined;
			void this.drop(event, target);
		});
	}

	private acceptsDrop(event: DragEvent): boolean {
		return Array.from(event.dataTransfer?.types ?? []).some((type) =>
			[DAILY_TASK_MIME, DAILY_SOURCE_MIME].includes(type),
		);
	}

	private clearPlacement(element: HTMLElement): void {
		element.removeClass('is-drop-before');
		element.removeClass('is-drop-after');
		element.removeClass('is-drop-child');
	}

	private clearDrop(element: HTMLElement): void {
		element.removeClass('is-drop-target');
		this.clearPlacement(element);
	}

	private async drop(event: DragEvent, target?: DailyLogDropTarget): Promise<void> {
		const raw = event.dataTransfer?.getData(DAILY_TASK_MIME);
		if (raw) {
			try {
				const source: unknown = JSON.parse(raw);
				if (
					!source ||
					typeof source !== 'object' ||
					!('day' in source) ||
					!('taskId' in source) ||
					source.day !== this.day ||
					typeof source.taskId !== 'string' ||
					!target
				) {
					return;
				}
				await this.mutate(() =>
					this.controller.moveTask(this.day, source.taskId as string, target),
				);
			} catch (error) {
				this.showError(error);
			}
			return;
		}
		const source = this.options.projectTaskFromDrop(event);
		if (source) {
			await this.mutate(() => this.controller.copyProjectTask(this.day, source, target));
		}
	}

	private async mutate(action: () => Promise<void>): Promise<void> {
		try {
			await action();
			if (!this.active) {
				return;
			}
			await this.options.onChanged();
			if (this.active) {
				await this.refresh();
			}
		} catch (error) {
			if (this.active) {
				this.showError(error);
				new Notice(`Tavern: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
	}

	private showError(error: unknown): void {
		this.renderedLayout = '';
		this.errorEl?.remove();
		this.errorEl = this.content.createDiv({
			cls: 'tavern-daily-error',
			text: error instanceof Error ? error.message : String(error),
		});
	}
}

export default DailyLogPane;
