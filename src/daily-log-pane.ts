/* eslint-disable eslint/max-statements, eslint/no-magic-numbers, eslint/no-ternary */
import { Component, Menu, Notice, setIcon } from 'obsidian';
import type {
	DailyLogController,
	DailyLogDropTarget,
	DailyLogSnapshot,
} from './daily-log-controller';
import { shiftDay, type DailyNote, type DailyTask } from './daily-note';
import { filterTasks, type ProjectBoardTask } from './project-library';
import addTaskDeleteItems from './task-context-menu';
import { taskDropPlacement, taskNestingDepth } from './task-drag';
import { taskHasChildren, type TaskEditPlan } from './task-edit';

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

type DailyTaskReference = { day: string; id: string };
type DailyDropTarget = { task: DailyTaskReference; placement: DailyLogDropTarget['placement'] };

const DAILY_TASK_MIME = 'application/x-tavern-daily-task';
const DAILY_SOURCE_MIME = 'application/x-tavern-daily-source';
const DAILY_INDENT_STEP = 17;

class DailyLogPane extends Component {
	private day: string;
	private query: string;
	private active = true;
	private revision = 0;
	private note: DailyNote | null = null;
	private notePath = '';
	private readonly taskReferencesSubscribed: boolean;
	private renderedLayout = '';
	private errorEl: HTMLElement | undefined;
	private readonly taskRows = new Map<string, { row: HTMLElement; checkbox: HTMLInputElement }>();
	private readonly pendingTaskReferences = new Set<DailyTaskReference>();
	private contextMenuTask: DailyTaskReference | undefined;
	private draggedTask: DailyTaskReference | undefined;
	private draggedTaskPayload = '';
	private readonly renderedTaskReferences = new Set<DailyTaskReference>();
	private taskMutationQueue = Promise.resolve();
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
		const unsubscribe = this.controller.onTaskReferencesChanged?.((path, mapping, kind) => {
			if (kind === 'daily' && path === this.notePath) {
				this.applyTaskReferences(this.day, mapping);
			}
		});
		this.taskReferencesSubscribed = Boolean(unsubscribe);
		if (unsubscribe) {
			this.register(unsubscribe);
		}
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
			this.notePath = snapshot.path;
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
			await this.taskMutationQueue;
		} catch {
			return;
		}
		if (!this.active) {
			return;
		}
		this.day = day;
		this.note = null;
		this.notePath = '';
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
		this.renderedTaskReferences.clear();
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
				const { day } = this;
				const mapping = await this.controller.addTaskPlan(day, plan);
				this.remapTaskReferences(day, mapping);
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
		const reference = { day: this.day, id: task.id };
		this.renderedTaskReferences.add(reference);
		this.contentEvents.registerDomEvent(row, 'contextmenu', (event) => {
			void this.showTaskContextMenu(event, reference);
		});
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
			this.draggedTask = reference;
			this.draggedTaskPayload = JSON.stringify({ day: reference.day, taskId: reference.id });
			event.dataTransfer?.setData(DAILY_TASK_MIME, this.draggedTaskPayload);
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
		this.contentEvents.registerDomEvent(checkbox, 'change', () => {
			const { checked } = checkbox;
			const target = { ...reference };
			void this.mutate(async () => {
				const mapping = await this.controller.setTaskChecked(target.day, target.id, checked);
				this.remapTaskReferences(target.day, mapping);
			}, [target]);
		});
		const text = row.createSpan('tavern-project-task-text');
		this.options.renderTaskText(text, task.text, {
			depth,
			onSave: async (plan) => {
				try {
					const { day } = reference;
					const mapping = await this.controller.editTaskPlan(day, reference.id, plan);
					this.remapTaskReferences(day, mapping);
				} catch (error) {
					if (this.active) {
						this.showError(error);
						new Notice(`Tavern: ${error instanceof Error ? error.message : String(error)}`);
					}
					throw error;
				}
			},
		});
		this.registerDrop(row, reference);
	}

	private async showTaskContextMenu(
		event: MouseEvent,
		reference: { day: string; id: string },
	): Promise<void> {
		event.preventDefault();
		event.stopPropagation();
		const target = { ...reference };
		this.contextMenuTask = target;
		let snapshot: DailyLogSnapshot | undefined = undefined;
		try {
			await this.options.finishEditing();
			await this.taskMutationQueue;
			await this.controller.whenIdle?.();
			snapshot = await this.controller.read(target.day);
		} catch (error) {
			if (this.active) {
				this.showError(error);
				new Notice(`Tavern: ${error instanceof Error ? error.message : String(error)}`);
			}
			return;
		}
		if (!this.active || this.day !== target.day || this.contextMenuTask !== target || !target.id) {
			return;
		}
		const current = snapshot.note?.tasks.find((candidate) => candidate.id === target.id);
		if (!snapshot.note || !current) {
			return;
		}
		const hasChildren = taskHasChildren(snapshot.note.markdown, current.lineIndex);
		const menu = new Menu();
		addTaskDeleteItems(menu, hasChildren, (mode) =>
			this.mutate(async () => {
				if (target.id) {
					const mapping = await this.controller.deleteTask(target.day, target.id, mode);
					this.remapTaskReferences(target.day, mapping);
				}
			}, [target]),
		);
		menu.showAtMouseEvent(event);
	}

	private remapTaskReferences(day: string, mapping: Map<string, string> | void): void {
		if (!this.taskReferencesSubscribed) {
			this.applyTaskReferences(day, mapping);
		}
	}

	private applyTaskReferences(day: string, mapping: Map<string, string> | void): void {
		const targets = new Set([...this.pendingTaskReferences, ...this.renderedTaskReferences]);
		if (this.contextMenuTask) {
			targets.add(this.contextMenuTask);
		}
		if (this.draggedTask) {
			targets.add(this.draggedTask);
		}
		for (const target of targets) {
			if (target.day === day) {
				target.id = mapping?.get(target.id) ?? target.id;
			}
		}
		if (day === this.day && mapping) {
			const rows = [...this.taskRows];
			this.taskRows.clear();
			for (const [id, row] of rows) {
				const currentId = mapping.get(id) ?? id;
				if (currentId) {
					this.taskRows.set(currentId, row);
				}
			}
		}
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
		task?: DailyTaskReference,
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
			if (task?.id) {
				this.clearPlacement(element);
				element.addClass(`is-drop-${taskDropPlacement(element, event, DAILY_INDENT_STEP)}`);
			}
		});
		events.registerDomEvent(element, 'dragleave', () => this.clearDrop(element));
		events.registerDomEvent(element, 'drop', (event) => {
			event.preventDefault();
			event.stopPropagation();
			this.clearDrop(element);
			const target = task?.id
				? { task, placement: taskDropPlacement(element, event, DAILY_INDENT_STEP) }
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

	private async drop(event: DragEvent, target?: DailyDropTarget): Promise<void> {
		const raw = event.dataTransfer?.getData(DAILY_TASK_MIME);
		if (raw) {
			try {
				const payload: unknown = JSON.parse(raw);
				if (
					!payload ||
					typeof payload !== 'object' ||
					!('day' in payload) ||
					!('taskId' in payload) ||
					payload.day !== this.day ||
					typeof payload.taskId !== 'string' ||
					!target
				) {
					return;
				}
				const source = {
					...(raw === this.draggedTaskPayload && this.draggedTask
						? this.draggedTask
						: { day: this.day, id: payload.taskId }),
				};
				const destination = { ...target.task };
				await this.mutate(async () => {
					if (!source.id || !destination.id) {
						throw new Error('The dragged task or destination was removed.');
					}
					const mapping = await this.controller.moveTask(source.day, source.id, {
						taskId: destination.id,
						placement: target.placement,
					});
					this.remapTaskReferences(source.day, mapping);
				}, [source, destination]);
			} catch (error) {
				this.showError(error);
			}
			return;
		}
		const source = this.options.projectTaskFromDrop(event);
		if (source) {
			const { day } = this;
			await this.mutate(
				() => {
					if (target && !target.task.id) {
						throw new Error('The drop destination was removed.');
					}
					return this.controller.copyProjectTask(
						day,
						source,
						target ? { taskId: target.task.id, placement: target.placement } : undefined,
					);
				},
				target ? [target.task] : [],
			);
		}
	}

	private mutate(
		action: () => Promise<void>,
		references: DailyTaskReference[] = [],
	): Promise<void> {
		for (const reference of references) {
			this.pendingTaskReferences.add(reference);
		}
		const previous = this.taskMutationQueue;
		const mutation = (async () => {
			await previous;
			try {
				await this.options.finishEditing();
				await this.controller.whenIdle?.();
				if (!this.active) {
					return;
				}
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
			} finally {
				for (const reference of references) {
					this.pendingTaskReferences.delete(reference);
				}
			}
		})();
		this.taskMutationQueue = mutation;
		return mutation;
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
