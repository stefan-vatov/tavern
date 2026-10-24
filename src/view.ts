/* eslint-disable eslint/func-style, eslint/max-lines, eslint/max-statements, eslint/no-magic-numbers */
import { Effect, Exit } from 'effect';
import { Component, ItemView, Menu, Notice, Scope, setIcon, type WorkspaceLeaf } from 'obsidian';
import { addTaskToFocusQueue, createProjectBoardModel } from './project-board-model';
import type { DailyLogController } from './daily-log-controller';
import DailyLogPane from './daily-log-pane';
import {
	filterTasks,
	projectTasks,
	taskSelectionKey,
	taskTreeKeys,
	type ProjectBoardTask,
	type ProjectLibrary,
	type ProjectSummary,
} from './project-library';
import { indentWidth, type ProjectTask } from './project-note';
import {
	addVaultProjectTaskPlan,
	completeVaultProjectTask,
	deleteVaultProjectTask,
	editVaultProjectTaskPlan,
	loadVaultProjectLibrary,
	moveVaultProjectTask,
	moveVaultProjectTaskToPosition,
	reorderVaultProjectTask,
	type ProjectVault,
} from './project-vault';
import { TAVERN_VIEW_TYPE } from './project-mode';
import type { TavernSettings } from './settings-defaults';
import { taskDropPlacement, taskNestingDepth } from './task-drag';
import type { TaskEditPlan } from './task-edit';
import showTaskEditRecovery from './task-edit-recovery';
import { createTaskTextEditor, type TaskTextEditor } from './task-text-editor';

const LIST_RESIZE = {
	cssVar: '--tavern-list-width',
	max: 520,
	min: 200,
};
const EMPTY_LIBRARY: ProjectLibrary = { projects: [] };
const DONE_SECTION_NAME = 'Done';
const TASK_ID_MIME = 'text/plain';
const TASK_QUEUE_KEY_MIME = 'application/x-tavern-task-key';
const QUEUE_KEY_MIME = 'application/x-tavern-queue-key';
const DAILY_SOURCE_MIME = 'application/x-tavern-daily-source';

type ResizeConfig = {
	cssVar: string;
	max: number;
	min: number;
};

type SidebarProjectSection = {
	projects: ProjectSummary[];
	title: string;
};

type TavernViewDeps = {
	dailyLogs?: DailyLogController;
	saveSettings: () => Promise<void>;
	settings: TavernSettings;
	vault: ProjectVault;
};

type TaskTextEditorOptions = {
	task?: ProjectBoardTask;
	onSave?: (plan: TaskEditPlan) => Promise<void>;
	depth?: number;
};

type TavernViewState = {
	availableTasksCollapsed?: unknown;
	boardPage?: unknown;
	boardTaskKeys?: unknown;
	globalTaskQuery?: unknown;
	mode?: unknown;
	projectQuery?: unknown;
	selectedPath?: unknown;
	sidebarCollapsedSections?: unknown;
};

type TavernBoardPage = 'global' | 'project';

class TavernView extends ItemView {
	private dailyPane: DailyLogPane | undefined;
	private listEl: HTMLElement | undefined;
	private detailEl: HTMLElement | undefined;
	private refreshRevision = 0;
	private dailyDay: string;
	private dailyQuery = '';
	private dragCleanup: (() => void) | null = null;
	private errorMessage: string | null = null;
	private library: ProjectLibrary = EMPTY_LIBRARY;
	private loading = true;
	private availableTasksCollapsed: boolean;
	private boardPage: TavernBoardPage = 'global';
	private globalTaskQuery = '';
	private focusQueueCollapsed = false;
	private overlayScope: Scope | null = null;
	private editingScope: Scope | null = null;
	private projectQuery = '';
	private query = '';
	private searchOverlayEl: HTMLElement | null = null;
	private searchOverlayOpen = false;
	private selectedPath = '';
	private sidebarCollapsedSections: Set<string>;
	private sidebarOpen = false;
	private closed = false;
	private readonly activeEditors = new Set<TaskTextEditor>();

	constructor(
		leaf: WorkspaceLeaf,
		private readonly deps: TavernViewDeps,
	) {
		super(leaf);
		this.dailyDay = deps.dailyLogs?.today() ?? '';
		this.availableTasksCollapsed = deps.settings.availableTasksCollapsed ?? false;
		this.sidebarCollapsedSections = new Set(deps.settings.sidebarCollapsedSections ?? []);
	}

	getViewType(): string {
		return TAVERN_VIEW_TYPE;
	}

	getDisplayText(): string {
		return this.deps.settings.tavernName;
	}

	getIcon(): string {
		return 'dice';
	}

	async onOpen(): Promise<void> {
		this.closed = false;
		this.dailyDay = this.deps.dailyLogs?.today() ?? '';
		try {
			await this.deps.dailyLogs?.syncAll?.();
		} catch (error) {
			new Notice(`Tavern: ${String(error)}`);
		}
		this.register(this.contentEl.onWindowMigrated(() => this.dragCleanup?.()));
		this.renderShell();
		await this.refreshProjects();
	}

	async onClose(): Promise<void> {
		// eslint-disable-next-line eslint/no-underscore-dangle
		// eslint-disable-next-line eslint/no-underscore-dangle
		this.closed = true;
		// Closing must not wait indefinitely for vault I/O; pending saves still report through their callbacks.
		// eslint-disable-next-line promise/prefer-await-to-then
		void this.finishTaskEditing().catch(() => {});
		for (const editor of this.activeEditors) {
			editor.dispose();
		}
		this.activeEditors.clear();
		this.popTaskEditingScope();
		if (this.dailyPane) {
			this.removeChild(this.dailyPane);
			this.dailyPane = undefined;
		}
		this.listEl = undefined;
		this.detailEl = undefined;
		this.refreshRevision += 1;
		this.popSearchOverlayScope();
		this.dragCleanup?.();
		this.dragCleanup = null;
	}

	getState(): Record<string, unknown> {
		return {
			...super.getState(),
			availableTasksCollapsed: this.availableTasksCollapsed,
			boardPage: this.boardPage,
			globalTaskQuery: this.globalTaskQuery,
			projectQuery: this.projectQuery,
			selectedPath: this.selectedPath,
			sidebarCollapsedSections: [...this.sidebarCollapsedSections],
			boardTaskKeys: this.deps.settings.boardTaskKeys,
		};
	}

	async setState(state: TavernViewState, result: { history: boolean }): Promise<void> {
		await super.setState(state, result);
		if (typeof state.selectedPath === 'string') {
			this.selectedPath = state.selectedPath;
		}
		// Older workspaces stored project-only views as note mode.
		if (state.mode === 'note') {
			this.boardPage = 'project';
		} else if (state.boardPage === 'global' || state.boardPage === 'project') {
			this.boardPage = state.boardPage;
		}
		if (typeof state.globalTaskQuery === 'string') {
			this.globalTaskQuery = state.globalTaskQuery;
		}
		if (typeof state.projectQuery === 'string') {
			this.projectQuery = state.projectQuery;
		}
		if (typeof state.availableTasksCollapsed === 'boolean') {
			this.availableTasksCollapsed = state.availableTasksCollapsed;
			this.deps.settings.availableTasksCollapsed = state.availableTasksCollapsed;
		}
		if (Array.isArray(state.sidebarCollapsedSections)) {
			this.sidebarCollapsedSections = new Set(
				state.sidebarCollapsedSections.filter((item): item is string => typeof item === 'string'),
			);
		}
		if (Array.isArray(state.boardTaskKeys)) {
			this.deps.settings.boardTaskKeys = state.boardTaskKeys.filter(
				(item): item is string => typeof item === 'string',
			);
		}
		await this.refreshProjects();
	}

	// One-liner helper to encapsulate boardTaskKeys assign + awaited save (used from prune site for consistency with peer await-save sites).
	// Full centralization of the 8+ direct mutation sites (toggle, add/remove/reorder selection, edit reconcile, delete filter, etc.) is out of scope for this mini-pass.
	private async updateBoardTaskKeys(next: string[]): Promise<void> {
		this.deps.settings.boardTaskKeys = next;
		await this.deps.saveSettings();
	}

	async refreshProjects(): Promise<void> {
		/* c8 ignore next -- closed guard; prevents post-onClose async from prior refresh/render/mutations (L4); mirrors inactive resize guards + c8 pattern */
		// eslint-disable-next-line eslint/no-underscore-dangle, curly
		if (this.closed) {
			return;
		}
		if (this.activeEditors.size > 0) {
			await this.dailyPane?.refresh();
			return;
		}
		const revision = ++this.refreshRevision;
		this.errorMessage = null;

		const exit = await Effect.runPromiseExit(
			loadVaultProjectLibrary(this.deps.vault, this.deps.settings.projectFolders),
		);

		if (this.closed || revision !== this.refreshRevision) {
			return;
		}

		if (this.activeEditors.size > 0) {
			return;
		}

		if (Exit.isFailure(exit)) {
			this.library = EMPTY_LIBRARY;
			this.errorMessage = 'Tavern could not load project notes.';
			this.loading = false;
			this.renderShell();
			new Notice(this.errorMessage);
			return;
		}

		this.library = exit.value;

		// Always prune stale boardTaskKeys on refresh (after any mutation or external edit). Uses Map/filter-equivalent logic (like selectedProjectTasks) to drop keys no longer resolving to live tasks post-renumber (text/line/section changes baked in createTaskId). Prevents bloat and surprise drops from persisted focus queue. Migration for text edits (see editTask) re-inserts surviving keys after prune.
		/* c8 ignore next -- prune + migration branches exercised in integration but add branch coverage here; core paths covered */
		const tasks = projectTasks(this.library);
		const completedTreeKeys = new Set(
			tasks.filter((task) => task.checked).flatMap((task) => taskTreeKeys(tasks, task)),
		);
		const currentTaskKeys = new Set(
			tasks.filter((task) => !task.checked).map((task) => taskSelectionKey(task)),
		);
		const originalBoardTaskKeys = this.deps.settings.boardTaskKeys;
		const prunedBoardTaskKeys = originalBoardTaskKeys.filter(
			(key) => currentTaskKeys.has(key) && !completedTreeKeys.has(key),
		);
		if (prunedBoardTaskKeys.length !== originalBoardTaskKeys.length) {
			await this.updateBoardTaskKeys(prunedBoardTaskKeys);
		}

		if (this.closed || revision !== this.refreshRevision) {
			return;
		}

		// only override selectedPath if current is absent/invalid in fresh library (preserve setState/UI selections; reconcile external delete only)
		if (this.boardPage === 'project') {
			if (
				!this.selectedPath ||
				!this.library.projects.some((proj) => proj.path === this.selectedPath)
			) {
				this.selectedPath = this.selectedProject()?.path ?? this.library.projects[0]?.path ?? '';
			}
		}
		this.loading = false;
		this.renderShell();
	}

	private renderShell(animateDetail = false): void {
		/* c8 ignore next -- closed guard; prevents post-onClose async from prior refresh/render/mutations (L4); mirrors inactive resize guards + c8 pattern */
		// eslint-disable-next-line eslint/no-underscore-dangle, curly
		if (this.closed) {
			return;
		}
		if (this.activeEditors.size > 0) {
			return;
		}
		this.dragCleanup?.();
		if (!this.listEl || !this.detailEl) {
			this.contentEl.empty();
			this.listEl = this.contentEl.createDiv('tavern-panel tavern-panel-list');
			this.createResizeHandle(this.contentEl, this.listEl, LIST_RESIZE);
			this.detailEl = this.contentEl.createDiv('tavern-panel tavern-panel-detail');
		}
		this.contentEl.addClass('tavern-container');
		this.contentEl.removeClass('is-sidebar-open');
		if (this.sidebarOpen) {
			this.contentEl.addClass('is-sidebar-open');
		}

		const { listEl, detailEl } = this;
		detailEl.removeClass('is-entering');
		if (animateDetail) {
			detailEl.addClass('is-entering');
		}

		this.renderList(listEl, () => {
			this.renderDetail(detailEl);
		});
		this.renderDetail(detailEl);
		if (this.deps.dailyLogs) {
			if (!this.dailyPane) {
				this.renderDailyLog();
			} else {
				void this.dailyPane.refresh();
			}
		}
	}

	private renderDailyLog(): void {
		const controller = this.deps.dailyLogs;
		if (!controller) {
			return;
		}
		this.contentEl.addClass('tavern-has-daily-log');
		const panel = this.contentEl.createDiv('tavern-panel tavern-daily-panel');
		this.dailyPane = this.addChild(
			new DailyLogPane(panel, controller, {
				day: this.dailyDay,
				query: this.dailyQuery,
				onStateChange: ({ day, query }) => {
					this.dailyDay = day;
					this.dailyQuery = query;
				},
				onChanged: () => this.refreshProjects(),
				projectTaskFromDrop: (event) => {
					const key = event.dataTransfer?.getData(DAILY_SOURCE_MIME) ?? '';
					return this.taskFromSelectionKey(key);
				},
				isEditing: () => this.activeEditors.size > 0,
				finishEditing: () => this.finishTaskEditing(),
				renderTaskText: (container, text, options) => {
					this.renderEditableTaskText(container, text, options);
				},
				bindCapture: (row, input, onSave) => this.bindTaskCapture(row, input, onSave),
			}),
		);
		void this.dailyPane.refresh();
	}

	private renderList(containerEl: HTMLElement, onQueryChange: () => void): void {
		containerEl.empty();
		containerEl.addClass('tavern-list');

		const brand = containerEl.createDiv('tavern-app-name');
		setIcon(brand.createSpan('tavern-app-icon'), 'sparkles');
		brand.createSpan({ cls: 'tavern-app-title', text: this.deps.settings.tavernName });
		this.renderSearch(containerEl);
		const itemsEl = containerEl.createDiv('tavern-list-items');
		this.renderListItems(itemsEl);
		onQueryChange();
	}

	private renderListItems(itemsEl: HTMLElement): void {
		if (this.loading) {
			itemsEl.createDiv({ cls: 'tavern-list-empty', text: 'Loading projects...' });
			return;
		}

		const model = this.boardModel();
		this.renderGlobalQueueCard(itemsEl, model.visibleProjects);

		if (model.visibleProjects.length === 0) {
			itemsEl.createDiv({ cls: 'tavern-list-empty', text: 'No project notes found.' });
			return;
		}

		for (const section of sidebarProjectSections(model.visibleProjects)) {
			const sectionEl = itemsEl.createDiv('tavern-sidebar-section');
			const collapsed = this.sidebarCollapsedSections.has(section.title);
			if (collapsed) {
				sectionEl.addClass('is-collapsed');
			}
			const header = sectionEl.createEl('button', {
				cls: 'tavern-sidebar-section-header',
				attr: {
					'aria-expanded': String(!collapsed),
					'aria-label': `Toggle ${section.title} projects`,
				},
			});
			this.registerDomEvent(header, 'click', () => {
				this.toggleSidebarSection(section.title);
			});
			header.createSpan({ cls: 'tavern-sidebar-section-title', text: section.title });
			header.createSpan({
				cls: 'tavern-sidebar-section-count',
				text: section.projects.length.toString(),
			});
			let sidebarIcon = 'chevron-down';
			if (collapsed) {
				sidebarIcon = 'chevron-right';
			}
			setIcon(header.createSpan('tavern-sidebar-section-chevron'), sidebarIcon);
			if (!collapsed) {
				for (const project of section.projects) {
					this.renderProjectCard(sectionEl, project);
				}
			}
		}
	}

	private toggleSidebarSection(title: string): void {
		if (this.sidebarCollapsedSections.has(title)) {
			this.sidebarCollapsedSections.delete(title);
		} else {
			this.sidebarCollapsedSections.add(title);
		}
		this.deps.settings.sidebarCollapsedSections = [...this.sidebarCollapsedSections];
		void this.deps.saveSettings();
		this.renderShell();
	}

	private renderSearch(containerEl: HTMLElement): void {
		const searchContainer = containerEl.createDiv('tavern-search');
		setIcon(searchContainer.createSpan('tavern-search-icon'), 'search');
		const input = searchContainer.createEl('input', {
			attr: { 'aria-label': 'Search tasks' },
			cls: 'tavern-search-input',
			placeholder: 'Search tasks...',
			type: 'text',
			value: this.query,
		});
		this.registerDomEvent(input, 'focus', () => {
			this.openSearchOverlay();
		});
		this.registerDomEvent(input, 'click', () => {
			this.openSearchOverlay();
		});
		this.registerDomEvent(input, 'input', () => {
			this.query = input.value;
			this.openSearchOverlay();
		});
		this.registerDomEvent(input, 'keydown', (event) => {
			if (event.key === 'Escape') {
				event.preventDefault();
				event.stopImmediatePropagation();
				event.stopPropagation();
				this.closeSearchOverlay();
			}
		});
	}

	private openSearchOverlay(): void {
		this.searchOverlayOpen = true;
		this.pushSearchOverlayScope();
		this.renderSearchOverlay();
	}

	openTaskSearch(): void {
		this.openSearchOverlay();
	}

	private closeSearchOverlay(rerenderShell = true): void {
		const shouldRerender = rerenderShell && (this.searchOverlayOpen || this.query.length > 0);
		this.searchOverlayOpen = false;
		this.query = '';
		this.searchOverlayEl?.remove();
		this.searchOverlayEl = null;
		this.popSearchOverlayScope();
		if (shouldRerender) {
			this.renderShell();
		}
	}

	private pushSearchOverlayScope(): void {
		if (this.overlayScope) {
			return;
		}

		const scope = new Scope(this.app.scope);
		scope.register(null, 'Escape', (event) => {
			event.preventDefault();
			event.stopImmediatePropagation();
			event.stopPropagation();
			this.closeSearchOverlay();
			return false;
		});
		this.app.keymap.pushScope(scope);
		this.overlayScope = scope;
	}

	private popSearchOverlayScope(): void {
		if (!this.overlayScope) {
			return;
		}

		this.app.keymap.popScope(this.overlayScope);
		this.overlayScope = null;
	}

	private renderSearchOverlay(): void {
		this.searchOverlayEl?.remove();
		if (!this.searchOverlayOpen) {
			return;
		}

		const overlay = this.contentEl.createDiv('tavern-search-overlay');
		this.searchOverlayEl = overlay;
		this.registerDomEvent(
			overlay,
			'keydown',
			(event) => {
				if (event.key === 'Escape') {
					event.preventDefault();
					event.stopImmediatePropagation();
					event.stopPropagation();
					this.closeSearchOverlay();
				}
			},
			{ capture: true },
		);
		this.registerDomEvent(overlay, 'click', () => {
			this.closeSearchOverlay();
		});

		const panel = overlay.createDiv('tavern-search-overlay-panel');
		this.registerDomEvent(panel, 'click', (event) => event.stopPropagation());
		const input = panel.createEl('input', {
			attr: { 'aria-label': 'Search Tavern tasks' },
			cls: 'tavern-search-input tavern-search-overlay-input',
			placeholder: 'Search tasks...',
			type: 'text',
			value: this.query,
		});
		this.registerDomEvent(input, 'input', () => {
			this.query = input.value;
			this.renderSearchOverlay();
		});
		this.registerDomEvent(input, 'keydown', (event) => {
			if (event.key === 'Escape') {
				event.preventDefault();
				event.stopImmediatePropagation();
				event.stopPropagation();
				this.closeSearchOverlay();
			}
		});

		const results = panel.createDiv('tavern-search-results');
		this.renderSearchResults(results);
		input.focus();
	}

	private renderSearchResults(containerEl: HTMLElement): void {
		if (this.activeEditors.size > 0) {
			return;
		}
		const query = this.query.trim();
		if (query.length === 0) {
			containerEl.createDiv({
				cls: 'tavern-search-empty',
				text: 'Start typing to search open tasks.',
			});
			return;
		}

		const tasks = filterTasks(
			projectTasks(this.library).filter((task) => !task.checked),
			query,
		).slice(0, 50);
		if (tasks.length === 0) {
			containerEl.createDiv({ cls: 'tavern-search-empty', text: 'No matching open tasks.' });
			return;
		}

		for (const task of tasks) {
			this.renderTaskSearchResult(containerEl, task);
		}
	}

	private renderTaskSearchResult(containerEl: HTMLElement, task: ProjectBoardTask): void {
		const row = containerEl.createDiv('tavern-project-task tavern-search-task');
		this.applyTaskNesting(row, task);
		this.renderTaskDragHandle(row, task.text, (event) => {
			event.dataTransfer?.setData(TASK_ID_MIME, task.id);
			event.dataTransfer?.setData(TASK_QUEUE_KEY_MIME, taskSelectionKey(task));
			this.setDailySource(event, task);
		});
		if (this.isTaskSelected(task)) {
			row.addClass('is-in-global-queue');
		}
		this.registerDomEvent(row, 'click', () => {
			this.openTaskProject(task);
		});
		this.registerDomEvent(row, 'contextmenu', (event) => {
			this.showTaskContextMenu(event, task);
		});

		const checkbox = row.createEl('input', {
			attr: { 'aria-label': `Complete ${task.text}` },
			type: 'checkbox',
		});
		checkbox.checked = task.checked;
		this.registerDomEvent(checkbox, 'click', (event) => {
			event.stopPropagation();
		});
		this.registerDomEvent(checkbox, 'change', () => {
			if (checkbox.checked) {
				void this.completeTask(task);
			}
		});

		const content = row.createSpan('tavern-global-task-content');
		this.renderEditableTaskText(content, task.text, { task });
		content.createSpan({
			cls: 'tavern-global-task-project',
			text: `${task.projectTitle} / ${task.sectionName}`,
		});

		this.renderTaskPin(row, task);
	}

	private openTaskProject(task: ProjectBoardTask): void {
		const animateDetail = this.boardPage !== 'project' || this.selectedPath !== task.projectPath;
		this.boardPage = 'project';
		this.selectedPath = task.projectPath;
		this.sidebarOpen = false;
		this.closeSearchOverlay(false);
		this.renderShell(animateDetail);
	}

	private renderGlobalQueueCard(containerEl: HTMLElement, visibleProjects: ProjectSummary[]): void {
		const card = containerEl.createDiv('tavern-skill-card tavern-global-card');
		if (this.boardPage === 'global') {
			card.addClass('is-selected');
		}

		const openTaskCount = projectTasks({ projects: visibleProjects }).filter(
			(task) => !task.checked,
		).length;
		const header = card.createDiv('tavern-skill-header');
		setIcon(header.createSpan('tavern-global-icon'), 'list-tree');
		header.createSpan({ cls: 'tavern-skill-name', text: 'Global queue' });
		const meta = card.createDiv('tavern-skill-meta');
		meta.createSpan({
			cls: 'tavern-meta-item',
			text: `${this.boardModel().focusTasks.length} queued`,
		});
		meta.createSpan({ cls: 'tavern-meta-item', text: `${openTaskCount} open` });

		this.registerDomEvent(card, 'click', () => {
			const animateDetail = this.boardPage !== 'global';
			this.boardPage = 'global';
			this.sidebarOpen = false;
			this.renderShell(animateDetail);
		});
	}

	private renderProjectCard(containerEl: HTMLElement, project: ProjectSummary): void {
		const card = containerEl.createDiv('tavern-skill-card');
		if (this.boardPage === 'project' && project.path === this.selectedPath) {
			card.addClass('is-selected');
		}

		const tasks = project.note.sections.flatMap((section) => section.tasks);
		const openTaskCount = tasks.filter((task) => !task.checked).length;
		const header = card.createDiv('tavern-skill-header');
		header.createSpan({ cls: 'tavern-skill-name', text: project.title });
		this.renderProjectMeta(card, openTaskCount);

		this.registerDomEvent(card, 'click', () => {
			const animateDetail = this.boardPage !== 'project' || this.selectedPath !== project.path;
			this.boardPage = 'project';
			if (this.selectedPath !== project.path) {
				this.projectQuery = '';
			}
			this.selectedPath = project.path;
			this.sidebarOpen = false;
			this.renderShell(animateDetail);
		});
	}

	private renderProjectMeta(containerEl: HTMLElement, openTaskCount: number): void {
		const meta = containerEl.createDiv('tavern-skill-meta');
		meta.createSpan({ cls: 'tavern-meta-item', text: `${openTaskCount} open` });
	}

	private renderDetail(containerEl: HTMLElement): void {
		if (this.activeEditors.size > 0) {
			return;
		}
		containerEl.empty();
		containerEl.addClass('tavern-detail');

		if (this.errorMessage) {
			containerEl.createDiv({ cls: 'tavern-detail-empty', text: this.errorMessage });
			return;
		}

		if (this.boardPage === 'global') {
			this.renderGlobalWorkQueue(containerEl);
			return;
		}

		const project = this.boardModel().selectedProject;
		if (!project) {
			containerEl.createDiv({ cls: 'tavern-detail-empty', text: 'Select a project note.' });
			return;
		}

		const toolbar = containerEl.createDiv('tavern-detail-toolbar');
		this.renderDetailToolbar(toolbar, project);
		this.renderProjectLists(containerEl, project);
	}

	private selectedProject(): ProjectSummary | undefined {
		return this.boardModel().selectedProject;
	}

	private renderGlobalWorkQueue(containerEl: HTMLElement): void {
		const openTasks = this.globalOpenTasks();

		const toolbar = containerEl.createDiv('tavern-detail-toolbar');
		this.renderGlobalToolbar(
			toolbar,
			this.library.projects.length,
			this.boardModel().openTaskCount,
		);

		this.renderGlobalTaskFilter(toolbar, () => {
			const filteredOpenTasks = this.globalOpenTasks();
			taskBody.empty();
			this.renderGlobalTaskBody(taskBody, filteredOpenTasks);
		});
		const body = containerEl.createDiv('tavern-detail-body');
		const taskBody = body.createDiv('tavern-global-task-body');
		this.renderGlobalTaskBody(taskBody, openTasks);
	}

	private globalOpenTasks(): ProjectBoardTask[] {
		const tasks = projectTasks(this.library);
		return filterTasks(
			tasks.filter((task) => !task.checked),
			this.globalTaskQuery,
		);
	}

	private renderGlobalTaskFilter(containerEl: HTMLElement, onInput: () => void): void {
		const filterEl = containerEl.createDiv('tavern-project-filter tavern-global-task-filter');
		setIcon(filterEl.createSpan('tavern-search-icon'), 'search');
		const input = filterEl.createEl('input', {
			attr: { 'aria-label': 'Filter global tasks' },
			cls: 'tavern-search-input tavern-project-filter-input',
			placeholder: 'Filter global tasks...',
			type: 'text',
			value: this.globalTaskQuery,
		});
		this.registerDomEvent(input, 'input', () => {
			this.globalTaskQuery = input.value;
			onInput();
		});
	}

	private renderGlobalTaskBody(containerEl: HTMLElement, openTasks: ProjectBoardTask[]): void {
		this.renderFocusQueue(containerEl);
		const section = containerEl.createDiv('tavern-project-section tavern-global-task-section');
		if (this.availableTasksCollapsed) {
			section.addClass('is-collapsed');
		}
		const header = section.createDiv('tavern-project-section-header');
		const titleWrap = header.createDiv('tavern-project-section-heading');
		const collapseButton = titleWrap.createEl('button', {
			cls: 'tavern-project-section-toggle',
			attr: { 'aria-label': 'Toggle available tasks' },
		});
		let collapseIcon = 'chevron-down';
		if (this.availableTasksCollapsed) {
			collapseIcon = 'chevron-right';
		}
		setIcon(collapseButton, collapseIcon);
		this.registerDomEvent(collapseButton, 'click', () => {
			this.availableTasksCollapsed = !this.availableTasksCollapsed;
			this.deps.settings.availableTasksCollapsed = this.availableTasksCollapsed;
			void this.deps.saveSettings();
			this.renderShell();
		});
		titleWrap.createDiv({ cls: 'tavern-project-section-title', text: 'Available tasks' });
		header.createSpan({ cls: 'tavern-project-section-count', text: `${openTasks.length} shown` });

		if (this.availableTasksCollapsed) {
			return;
		}

		if (openTasks.length === 0) {
			section.createDiv({ cls: 'tavern-list-empty', text: 'No open tasks found.' });
			return;
		}

		for (const task of openTasks) {
			this.renderGlobalTask(section, task);
		}
	}

	private renderGlobalToolbar(
		toolbar: HTMLElement,
		projectCount: number,
		openTaskCount: number,
	): void {
		const topRow = toolbar.createDiv('tavern-toolbar-top');
		const left = topRow.createDiv('tavern-toolbar-left');
		left.createSpan({ cls: 'tavern-detail-title', text: 'Global work queue' });

		const right = topRow.createDiv('tavern-toolbar-right');
		this.renderSidebarToggle(right);
		const refreshButton = right.createEl('button', {
			cls: 'tavern-toolbar-btn',
			attr: { 'aria-label': 'Refresh projects' },
		});
		setIcon(refreshButton, 'refresh-cw');
		this.registerDomEvent(refreshButton, 'click', () => {
			void this.refreshProjects();
		});

		const meta = toolbar.createDiv('tavern-detail-meta-bar');
		meta.createSpan({ cls: 'tavern-meta-item', text: `${projectCount} projects` });
		meta.createSpan({ cls: 'tavern-meta-item', text: `${openTaskCount} open tasks` });
		meta.createSpan({
			cls: 'tavern-meta-item',
			text: this.deps.settings.projectFolders.join(', '),
		});
	}

	private renderDetailToolbar(toolbar: HTMLElement, project: ProjectSummary): void {
		const topRow = toolbar.createDiv('tavern-toolbar-top');
		const left = topRow.createDiv('tavern-toolbar-left');
		left.createSpan({ cls: 'tavern-detail-title', text: project.title });

		const right = topRow.createDiv('tavern-toolbar-right');
		this.renderSidebarToggle(right);
		const refreshButton = right.createEl('button', {
			cls: 'tavern-toolbar-btn',
			attr: { 'aria-label': 'Refresh projects' },
		});
		setIcon(refreshButton, 'refresh-cw');
		this.registerDomEvent(refreshButton, 'click', () => {
			void this.refreshProjects();
		});
	}

	private renderSidebarToggle(containerEl: HTMLElement): void {
		const toggle = containerEl.createEl('button', {
			cls: 'tavern-sidebar-toggle',
			attr: {
				'aria-label': 'Toggle project navigation',
				'aria-expanded': String(this.sidebarOpen),
			},
		});
		setIcon(toggle, 'panel-left');
		this.registerDomEvent(toggle, 'click', () => {
			this.sidebarOpen = !this.sidebarOpen;
			this.renderShell();
		});
	}

	private renderProjectLists(containerEl: HTMLElement, project: ProjectSummary): void {
		const body = containerEl.createDiv('tavern-detail-body');
		if (this.boardPage === 'global') {
			this.renderFocusQueue(body);
		}
		this.renderProjectFilter(body, () => {
			list.empty();
			this.renderProjectSections(list, project);
		});
		const list = body.createDiv('tavern-project-lists');
		this.renderProjectSections(list, project);
	}

	private renderProjectSections(containerEl: HTMLElement, project: ProjectSummary): void {
		for (const section of project.note.sections) {
			const filteredTasks = filterTasks(section.tasks, this.projectQuery);
			const sectionEl = containerEl.createDiv('tavern-project-section');
			const sectionHeader = sectionEl.createDiv('tavern-project-section-header');
			sectionHeader.createDiv({ cls: 'tavern-project-section-title', text: section.name });
			sectionHeader.createSpan({
				cls: 'tavern-project-section-count',
				text: `${filteredTasks.length}`,
			});
			this.registerDomEvent(sectionEl, 'dragover', (event) => {
				this.markDropTarget(event, sectionEl);
			});
			this.registerDomEvent(sectionEl, 'dragleave', () => {
				this.clearDropTarget(sectionEl);
			});
			this.registerDomEvent(sectionEl, 'drop', (event) => {
				event.preventDefault();
				this.clearDropTarget(sectionEl);
				const task = this.projectTaskFromDrop(project.path, event);
				if (task) {
					void this.moveTask(task, section.name);
				}
			});

			let renderedTaskCount = 0;
			for (const line of section.lines) {
				if (line.type === 'text') {
					this.renderMarkdownLine(sectionEl, line.raw);
				} else if (filterTasks([line.task], this.projectQuery).length > 0) {
					this.renderTask(sectionEl, project, line.task);
					renderedTaskCount += 1;
				}
			}

			if (renderedTaskCount === 0) {
				sectionEl.addClass('is-empty');
			}
			this.renderAddTaskInput(sectionEl, project, section.name);
		}
	}

	private renderAddTaskInput(
		containerEl: HTMLElement,
		project: ProjectSummary,
		sectionName: string,
	): void {
		const form = containerEl.createDiv('tavern-add-task');
		const input = form.createEl('input', {
			attr: { 'aria-label': `Add task to ${sectionName}` },
			cls: 'tavern-add-task-input',
			placeholder: `Add task to ${sectionName}...`,
			type: 'text',
		});
		const button = form.createEl('button', {
			attr: { 'aria-label': `Create task in ${sectionName}` },
			cls: 'tavern-add-task-button',
			type: 'button',
		});
		setIcon(button, 'plus');

		const editor = this.bindTaskCapture(form, input, async (plan) => {
			try {
				if (this.deps.dailyLogs?.addProjectTaskPlan) {
					await this.deps.dailyLogs.addProjectTaskPlan(project.path, sectionName, plan);
				} else {
					const mapping = await Effect.runPromise(
						addVaultProjectTaskPlan({
							vault: this.deps.vault,
							projectPath: project.path,
							sectionName,
							plan,
						}),
					);
					await this.remapEditedTaskKeys(project.path, mapping);
				}
			} catch (error) {
				if (!this.closed) {
					new Notice('Tavern could not add the task.');
				}
				throw error;
			}
		});
		this.registerDomEvent(button, 'mousedown', (event) => event.preventDefault());
		this.registerDomEvent(button, 'click', async (event) => {
			event.preventDefault();
			event.stopPropagation();
			try {
				await editor.commit();
			} catch {
				/* The draft remains editable and its save callback reports the failure. */
			}
		});
	}

	private renderProjectFilter(containerEl: HTMLElement, onInput: () => void): void {
		const filterEl = containerEl.createDiv('tavern-project-filter');
		setIcon(filterEl.createSpan('tavern-search-icon'), 'search');
		const input = filterEl.createEl('input', {
			attr: { 'aria-label': 'Filter project tasks' },
			cls: 'tavern-search-input tavern-project-filter-input',
			placeholder: 'Filter this project...',
			type: 'text',
			value: this.projectQuery,
		});
		this.registerDomEvent(input, 'input', () => {
			this.projectQuery = input.value;
			onInput();
		});
	}

	private renderMarkdownLine(containerEl: HTMLElement, raw: string): void {
		const trimmed = raw.trim();
		if (trimmed.length === 0 || trimmed.startsWith('# ')) {
			return;
		}

		containerEl.createDiv({ cls: 'tavern-markdown-line', text: this.formatMarkdownText(trimmed) });
	}

	private formatMarkdownText(markdown: string): string {
		return markdown
			.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
			.replace(/\[\[([^\]]+)\]\]/g, '$1')
			.replace(/^⇱\s*/, '')
			.replace(/\s*▴$/, '')
			.trim();
	}

	private renderTask(containerEl: HTMLElement, project: ProjectSummary, task: ProjectTask): void {
		const taskEl = containerEl.createDiv('tavern-project-task');
		const boardTask = this.findBoardTask(project.path, task.id);
		this.applyTaskNesting(taskEl, task);
		if (this.isTaskSelected(boardTask)) {
			taskEl.addClass('is-in-global-queue');
		}
		if (task.checked) {
			taskEl.addClass('is-done');
		}
		this.renderTaskDragHandle(taskEl, task.text, (event) => {
			event.dataTransfer?.setData(TASK_ID_MIME, task.id);
			event.dataTransfer?.setData(TASK_QUEUE_KEY_MIME, taskSelectionKey(boardTask));
			event.dataTransfer?.setData(DAILY_SOURCE_MIME, taskSelectionKey(boardTask));
		});
		this.registerDomEvent(taskEl, 'dragover', (event) => {
			this.markTaskDropTarget(event, taskEl);
		});
		this.registerDomEvent(taskEl, 'dragleave', () => {
			this.clearTaskDropTarget(taskEl);
		});
		this.registerDomEvent(taskEl, 'drop', (event) => {
			event.preventDefault();
			event.stopPropagation();
			this.clearTaskDropTarget(taskEl);
			const sourceTask = this.projectTaskFromDrop(project.path, event);
			if (sourceTask) {
				void this.moveTaskToPosition(sourceTask, boardTask, taskDropPlacement(taskEl, event));
			}
		});
		this.registerDomEvent(taskEl, 'contextmenu', (event) => {
			this.showTaskContextMenu(event, boardTask);
		});

		const linked = boardTask && this.deps.dailyLogs?.isLinked?.(boardTask);
		let checkboxLabel = `Complete ${task.text}`;
		if (linked && task.checked) {
			checkboxLabel = `Reopen ${task.text}`;
		}
		const checkbox = taskEl.createEl('input', {
			attr: { 'aria-label': checkboxLabel },
			type: 'checkbox',
		});
		checkbox.checked = task.checked;
		checkbox.disabled = task.checked && task.sectionName === DONE_SECTION_NAME && !linked;
		this.registerDomEvent(checkbox, 'change', () => {
			if (checkbox.checked) {
				void this.completeTask(boardTask);
			} else if (linked && boardTask) {
				void this.setLinkedTaskChecked(boardTask, false);
			}
		});

		this.renderEditableTaskText(taskEl, task.text, { task: boardTask });

		this.renderTaskPin(taskEl, boardTask);
		const reorder = taskEl.createSpan('tavern-project-task-reorder');
		this.renderReorderButton(reorder, boardTask, 'up');
		this.renderReorderButton(reorder, boardTask, 'down');
	}

	private renderGlobalTask(containerEl: HTMLElement, task: ProjectBoardTask): void {
		const row = containerEl.createDiv('tavern-project-task tavern-global-task');
		this.applyTaskNesting(row, task);
		if (this.isTaskSelected(task)) {
			row.addClass('is-in-global-queue');
		}
		if (task.checked) {
			row.addClass('is-done');
		}
		this.renderTaskDragHandle(row, task.text, (event) => {
			event.dataTransfer?.setData(TASK_QUEUE_KEY_MIME, taskSelectionKey(task));
			this.setDailySource(event, task);
		});
		this.registerDomEvent(row, 'contextmenu', (event) => {
			this.showTaskContextMenu(event, task);
		});
		const checkbox = row.createEl('input', {
			attr: { 'aria-label': `Complete ${task.text}` },
			type: 'checkbox',
		});
		checkbox.checked = task.checked;
		this.registerDomEvent(checkbox, 'change', () => {
			if (checkbox.checked) {
				void this.completeTask(task);
			}
		});

		const content = row.createSpan('tavern-global-task-content');
		this.renderEditableTaskText(content, task.text, { task });
		content.createSpan({ cls: 'tavern-global-task-project', text: task.projectTitle });

		this.renderTaskPin(row, task);
	}

	private applyTaskNesting(containerEl: HTMLElement, task: ProjectTask): void {
		const depth = taskNestingDepth(task.indent);
		containerEl.style.setProperty('--tavern-task-depth', `${depth}`);
		if (depth > 0) {
			containerEl.addClass('is-nested');
		}
	}

	private renderTaskDragHandle(
		row: HTMLElement,
		taskText: string,
		onDragStart: (event: DragEvent) => void,
	): void {
		const handle = row.createEl('button', {
			attr: { 'aria-label': `Drag ${taskText}`, title: 'Drag to move' },
			cls: 'tavern-task-drag-handle',
		});
		handle.draggable = true;
		setIcon(handle, 'grip-vertical');
		this.registerDomEvent(handle, 'click', (event) => event.stopPropagation());
		this.registerDomEvent(handle, 'dragstart', (event) => {
			row.addClass('is-dragging-task');
			if (event.dataTransfer) {
				event.dataTransfer.effectAllowed = 'copyMove';
			}
			onDragStart(event);
		});
		this.registerDomEvent(handle, 'dragend', () => {
			row.removeClass('is-dragging-task');
		});
	}

	private setDailySource(event: DragEvent, task: ProjectBoardTask): void {
		if (indentWidth(task.indent) === 0) {
			event.dataTransfer?.setData(DAILY_SOURCE_MIME, taskSelectionKey(task));
		}
	}

	private renderTaskPin(containerEl: HTMLElement, task: ProjectBoardTask | undefined): void {
		const selected = this.isTaskSelected(task);
		let label = 'Queue';
		if (selected) {
			label = 'Queued';
		}
		const toggleButton = containerEl.createEl('button', {
			cls: 'tavern-project-task-pin tavern-queue-toggle',
			attr: { 'aria-label': `${label} task` },
		});
		if (selected) {
			toggleButton.addClass('is-selected');
		}
		toggleButton.createSpan({ cls: 'tavern-queue-shortcut', text: 'Q' });
		toggleButton.createSpan({ cls: 'tavern-queue-toggle-label', text: label });
		this.registerDomEvent(toggleButton, 'click', (event) => {
			event.stopPropagation();
			void this.toggleTaskSelection(task);
		});
	}

	private renderEditableTaskText(
		containerEl: HTMLElement,
		text: string,
		options: TaskTextEditorOptions,
	): void {
		const label = containerEl.createSpan('tavern-project-task-text tavern-editable-task-text');
		const row = containerEl.closest<HTMLElement>('.tavern-project-task')!;
		const depth = options.depth ?? taskNestingDepth(options.task?.indent ?? '');
		const editor = createTaskTextEditor({
			containerEl: label,
			rowEl: row,
			text,
			depth,
			renderText: (container, value) =>
				this.renderInlineTaskMarkdown(container, value || 'Untitled task'),
			getSubtreeEnd: () => this.taskSubtreeEnd(row, depth),
			createDraftRow: (after, nextDepth) => this.createTaskDraftRow(after, nextDepth),
			onCommit: (plan) =>
				this.commitTaskEdit(plan, async () => {
					if (options.onSave) {
						await options.onSave(plan);
					} else {
						await this.editTask(options.task, plan);
					}
				}),
			onEditingChange: (editing) => this.taskEditingChanged(editor, editing),
		});
		this.register(() => editor.dispose());
	}

	private taskSubtreeEnd(row: HTMLElement, depth: number): HTMLElement {
		let end = row;
		let next = row.nextElementSibling as HTMLElement | null;
		while (
			next?.hasClass('tavern-project-task') &&
			Number(next.style.getPropertyValue('--tavern-task-depth')) > depth
		) {
			end = next;
			next = next.nextElementSibling as HTMLElement | null;
		}
		return end;
	}

	private createTaskDraftRow(
		after: HTMLElement,
		depth: number,
	): { rowEl: HTMLElement; containerEl: HTMLElement } {
		const row = after.parentElement!.createDiv('tavern-project-task tavern-task-draft');
		if (after.hasClass('tavern-daily-task') || after.closest('.tavern-daily-content')) {
			row.addClass('tavern-daily-task');
		}
		row.style.setProperty('--tavern-task-depth', String(depth));
		if (depth > 0) {
			row.addClass('is-nested');
		}
		row.createSpan('tavern-task-draft-checkbox');
		const container = row.createSpan('tavern-project-task-text tavern-editable-task-text');
		after.after(row);
		return { rowEl: row, containerEl: container };
	}

	private bindTaskCapture(
		row: HTMLElement,
		input: HTMLInputElement,
		onCommit: (plan: TaskEditPlan) => Promise<void>,
	): TaskTextEditor {
		const editor = createTaskTextEditor({
			containerEl: input.parentElement!,
			rowEl: row,
			text: '',
			inputEl: input,
			isNew: true,
			renderText: () => {},
			createDraftRow: (after, depth) => this.createTaskDraftRow(after, depth),
			onCommit: (plan) => this.commitTaskEdit(plan, () => onCommit(plan)),
			onEditingChange: (editing) => this.taskEditingChanged(editor, editing),
		});
		this.registerDomEvent(input, 'focus', () => editor.open());
		this.registerDomEvent(input, 'input', () => editor.open());
		this.register(() => editor.dispose());
		return editor;
	}

	private async commitTaskEdit(plan: TaskEditPlan, save: () => Promise<void>): Promise<void> {
		try {
			await save();
		} catch (error) {
			if (this.closed) {
				showTaskEditRecovery(this.app, plan);
			}
			throw error;
		}
	}

	private taskEditingChanged(editor: TaskTextEditor, editing: boolean): void {
		if (editing) {
			this.activeEditors.add(editor);
			if (!this.editingScope) {
				const scope = new Scope(this.overlayScope ?? this.app.scope);
				const handle = (event: KeyboardEvent) => {
					for (const active of this.activeEditors) {
						if (active.handleKeydown(event)) {
							return false;
						}
					}
					return undefined;
				};
				scope.register(null, 'Enter', handle);
				scope.register(null, 'Escape', handle);
				this.app.keymap.pushScope(scope);
				this.editingScope = scope;
			}
		} else {
			this.activeEditors.delete(editor);
			if (this.activeEditors.size === 0) {
				this.popTaskEditingScope();
			}
			if (!this.closed && this.activeEditors.size === 0) {
				void this.refreshProjects();
			}
		}
	}

	private popTaskEditingScope(): void {
		if (this.editingScope) {
			this.app.keymap.popScope(this.editingScope);
			this.editingScope = null;
		}
	}

	private async finishTaskEditing(): Promise<void> {
		await Promise.all([...this.activeEditors].map((editor) => editor.commit()));
	}

	private renderInlineTaskMarkdown(containerEl: HTMLElement, text: string): void {
		const segments = inlineMarkdownLinkSegments(text);
		if (segments.length === 0) {
			containerEl.createSpan({ text });
			return;
		}

		for (const segment of segments) {
			if (segment.type === 'text') {
				containerEl.createSpan({ text: unescapeInlineMarkdownText(segment.text) });
			} else {
				const link = containerEl.createEl('a', {
					attr: {
						href: segment.href,
						rel: 'noopener noreferrer',
						target: '_blank',
					},
					cls: 'tavern-task-link',
					text: unescapeInlineMarkdownText(segment.text),
				});
				link.addEventListener('click', (event) => event.stopPropagation());
			}
		}
	}

	private showTaskContextMenu(event: MouseEvent, task: ProjectBoardTask | undefined): void {
		event.preventDefault();
		event.stopPropagation();

		const menu = new Menu();
		menu.addItem((item) => {
			item
				.setTitle('Delete task')
				.setIcon('trash')
				.onClick(() => {
					void this.deleteTask(task);
				});
		});
		if (this.isTaskSelected(task)) {
			menu.addItem((item) => {
				item
					.setTitle('Remove from global queue')
					.setIcon('pin-off')
					.onClick(() => {
						void this.removeTaskSelection(task);
					});
			});
		} else {
			menu.addItem((item) => {
				item
					.setTitle('Add to global queue')
					.setIcon('pin')
					.onClick(() => {
						void this.addTaskSelection(task);
					});
			});
		}
		menu.showAtMouseEvent(event);
	}

	private renderReorderButton(
		containerEl: HTMLElement,
		task: ProjectBoardTask | undefined,
		direction: 'down' | 'up',
	): void {
		const button = containerEl.createEl('button', {
			cls: 'tavern-project-task-reorder-btn',
			attr: { 'aria-label': `Move task ${direction}` },
		});
		setIcon(button, this.reorderIcon(direction));
		this.registerDomEvent(button, 'click', (event) => {
			event.stopPropagation();
			void this.reorderTask(task, direction);
		});
	}

	private reorderIcon(direction: 'down' | 'up'): string {
		if (direction === 'up') {
			return 'chevron-up';
		}

		return 'chevron-down';
	}

	private findBoardTask(projectPath: string, taskId: string): ProjectBoardTask | undefined {
		return projectTasks(this.library).find(
			(task) => task.projectPath === projectPath && task.id === taskId,
		);
	}

	private async completeTask(task: ProjectBoardTask | undefined): Promise<void> {
		if (task && this.deps.dailyLogs?.isLinked?.(task)) {
			await this.setLinkedTaskChecked(task, true);
			return;
		}
		const exit = await Effect.runPromiseExit(completeVaultProjectTask(this.deps.vault, task));
		if (Exit.isFailure(exit)) {
			new Notice('Tavern could not complete the task.');
			/* c8 ignore next -- failure branch + refresh for VaultActionError (added for race/ghost fix); not all failure paths fully branch-covered in unit */
			// Always refresh on VaultActionError (incl. not-found, races) so any ghosts from TOCTOU (RMW between snapshot and op) are cleared. See updateProjectSource.
			await this.refreshProjects();
			return;
		}
		await this.removeTaskSelection(task);
		await this.refreshProjects();
	}

	private async setLinkedTaskChecked(task: ProjectBoardTask, checked: boolean): Promise<void> {
		try {
			await this.deps.dailyLogs?.setProjectTaskChecked?.(task, checked);
			if (checked) {
				await this.removeTaskSelection(task);
			}
		} catch (error) {
			new Notice(`Tavern: ${String(error)}`);
		}
		await this.refreshProjects();
	}

	private async deleteTask(task: ProjectBoardTask | undefined): Promise<void> {
		const exit = await Effect.runPromiseExit(deleteVaultProjectTask(this.deps.vault, task));
		if (Exit.isFailure(exit)) {
			new Notice('Tavern could not delete the task.');
			// Always refresh on VaultActionError (incl. not-found, races) so any ghosts from TOCTOU (RMW between snapshot and op) are cleared. See updateProjectSource.
			await this.refreshProjects();
			return;
		}
		const keys = this.taskTreeSelectionKeys(task);
		if (keys.some((key) => this.deps.settings.boardTaskKeys.includes(key))) {
			this.deps.settings.boardTaskKeys = this.deps.settings.boardTaskKeys.filter(
				(key) => !keys.includes(key),
			);
			await this.deps.saveSettings();
		}
		await this.refreshProjects();
	}

	private async editTask(task: ProjectBoardTask | undefined, plan: TaskEditPlan): Promise<void> {
		try {
			if (task && this.deps.dailyLogs?.editProjectTaskPlan) {
				await this.deps.dailyLogs.editProjectTaskPlan(task, plan);
			} else {
				const mapping = await Effect.runPromise(
					editVaultProjectTaskPlan(this.deps.vault, task, plan),
				);
				await this.remapEditedTaskKeys(task!.projectPath, mapping);
			}
		} catch (error) {
			if (!this.closed) {
				new Notice('Tavern could not edit the task.');
			}
			throw error;
		}
	}

	private async remapEditedTaskKeys(path: string, mapping: Map<string, string>): Promise<void> {
		const prefix = `${path}::`;
		const keys = this.deps.settings.boardTaskKeys.flatMap((key) => {
			if (!key.startsWith(prefix)) {
				return [key];
			}
			const id = mapping.get(key.slice(prefix.length));
			if (id === '') {
				return [];
			}
			return [`${prefix}${id ?? key.slice(prefix.length)}`];
		});
		await this.updateBoardTaskKeys(keys);
	}

	private async moveTask(task: ProjectBoardTask, targetSectionName: string): Promise<void> {
		if (task.sectionName === targetSectionName) {
			return;
		}

		const exit = await Effect.runPromiseExit(
			moveVaultProjectTask(this.deps.vault, task, targetSectionName),
		);
		if (Exit.isFailure(exit)) {
			new Notice('Tavern could not move the task.');
			// Always refresh on VaultActionError (incl. not-found, races) so any ghosts from TOCTOU (RMW between snapshot and op) are cleared. See updateProjectSource.
			await this.refreshProjects();
			return;
		}
		await this.refreshProjects();
	}

	private async moveTaskToPosition(
		sourceTask: ProjectBoardTask,
		targetTask: ProjectBoardTask | undefined,
		placement: 'after' | 'before' | 'child',
	): Promise<void> {
		if (sourceTask.id === targetTask?.id || sourceTask.projectPath !== targetTask?.projectPath) {
			return;
		}

		const exit = await Effect.runPromiseExit(
			moveVaultProjectTaskToPosition({
				placement,
				sourceTask,
				targetTask,
				vault: this.deps.vault,
			}),
		);
		if (Exit.isFailure(exit)) {
			new Notice('Tavern could not move the task.');
			// Always refresh on VaultActionError (incl. not-found, races) so any ghosts from TOCTOU (RMW between snapshot and op) are cleared. See updateProjectSource.
			await this.refreshProjects();
			return;
		}
		await this.refreshProjects();
	}

	private async reorderTask(
		task: ProjectBoardTask | undefined,
		direction: 'down' | 'up',
	): Promise<void> {
		const exit = await Effect.runPromiseExit(
			reorderVaultProjectTask(this.deps.vault, task, direction),
		);
		if (Exit.isFailure(exit)) {
			new Notice('Tavern could not reorder the task.');
			// Always refresh on VaultActionError (incl. not-found, races) so any ghosts from TOCTOU (RMW between snapshot and op) are cleared. See updateProjectSource.
			await this.refreshProjects();
			return;
		}
		await this.refreshProjects();
	}

	private renderFocusQueue(containerEl: HTMLElement): void {
		const selectedTasks = filterTasks(this.boardModel().focusTasks, this.globalTaskQuery);
		const queue = containerEl.createDiv('tavern-focus-queue');
		this.registerDomEvent(queue, 'dragover', (event) => {
			this.markDropTarget(event, queue);
		});
		this.registerDomEvent(queue, 'dragleave', () => {
			this.clearDropTarget(queue);
		});
		this.registerDomEvent(queue, 'drop', (event) => {
			event.preventDefault();
			this.clearDropTarget(queue);
			const draggedQueueKey = event.dataTransfer?.getData(QUEUE_KEY_MIME) ?? '';
			if (draggedQueueKey.length === 0) {
				void this.addTaskSelection(this.taskFromDrop(event));
			}
		});
		const header = queue.createEl('button', {
			cls: 'tavern-focus-queue-header',
			attr: {
				'aria-label': 'Toggle focus queue',
				'aria-expanded': String(!this.focusQueueCollapsed),
			},
		});
		const heading = header.createSpan('tavern-focus-queue-heading');
		let focusIcon = 'chevron-down';
		if (this.focusQueueCollapsed) {
			focusIcon = 'chevron-right';
		}
		setIcon(heading.createSpan('tavern-focus-queue-chevron'), focusIcon);
		heading.createSpan({ cls: 'tavern-focus-queue-title', text: 'Focus queue' });
		header.createSpan({ cls: 'tavern-meta-item', text: `${selectedTasks.length} tasks` });
		this.registerDomEvent(header, 'click', () => {
			this.focusQueueCollapsed = !this.focusQueueCollapsed;
			this.renderShell();
		});
		if (this.focusQueueCollapsed) {
			return;
		}
		const body = queue.createDiv('tavern-focus-queue-body');

		if (selectedTasks.length === 0) {
			const empty = body.createDiv('tavern-focus-empty');
			setIcon(empty.createSpan('tavern-focus-empty-icon'), 'pin');
			empty.createSpan({ text: 'Pin tasks to build your working list' });
			return;
		}

		for (const task of selectedTasks) {
			const row = body.createDiv('tavern-focus-task');
			this.applyTaskNesting(row, task);
			/* c8 ignore next -- focus queue done de-emphasize (similar covered in project sections test; branch listed) */
			if (task.checked) {
				row.addClass('is-done');
			}
			this.renderTaskDragHandle(row, task.text, (event) => {
				event.dataTransfer?.setData(QUEUE_KEY_MIME, taskSelectionKey(task));
				this.setDailySource(event, task);
			});
			this.registerDomEvent(row, 'dragover', (event) => {
				this.markReorderTarget(event, row);
			});
			this.registerDomEvent(row, 'dragleave', () => {
				this.clearReorderTarget(row);
			});
			this.registerDomEvent(row, 'drop', (event) => {
				event.preventDefault();
				this.clearReorderTarget(row);
				const sourceKey = event.dataTransfer?.getData(QUEUE_KEY_MIME) ?? '';
				void this.reorderTaskSelection(sourceKey, taskSelectionKey(task));
			});
			const checkbox = row.createEl('input', {
				attr: { 'aria-label': `Complete ${task.text}` },
				type: 'checkbox',
			});
			checkbox.checked = task.checked;
			this.registerDomEvent(checkbox, 'change', () => {
				if (checkbox.checked) {
					void this.completeTask(task);
				}
			});
			const content = row.createSpan('tavern-focus-task-content');
			this.renderEditableTaskText(content, task.text, { task });
			content.createSpan({ cls: 'tavern-focus-task-project', text: task.projectTitle });
			const removeButton = row.createEl('button', {
				cls: 'tavern-project-task-pin tavern-queue-toggle tavern-queue-toggle-remove',
				attr: { 'aria-label': 'Remove from focus queue' },
			});
			setIcon(removeButton, 'x');
			removeButton.createSpan({ cls: 'tavern-queue-toggle-label', text: 'Remove' });
			this.registerDomEvent(removeButton, 'click', () => {
				void this.removeTaskSelection(task);
			});
		}
	}

	private isTaskSelected(task: ProjectBoardTask | undefined): boolean {
		const key = taskSelectionKey(task);
		return key.length > 0 && this.deps.settings.boardTaskKeys.includes(key);
	}

	private async toggleTaskSelection(task: ProjectBoardTask | undefined): Promise<void> {
		const keys = this.taskTreeSelectionKeys(task);
		if (keys.length === 0) {
			return;
		}

		if (keys.some((key) => this.deps.settings.boardTaskKeys.includes(key))) {
			this.deps.settings.boardTaskKeys = this.deps.settings.boardTaskKeys.filter(
				(key) => !keys.includes(key),
			);
		} else {
			this.deps.settings.boardTaskKeys = keys.reduce(
				(boardTaskKeys, key) => addTaskToFocusQueue(boardTaskKeys, key),
				this.deps.settings.boardTaskKeys,
			);
		}
		await this.deps.saveSettings();
		this.renderShell();
	}

	private async addTaskSelection(task: ProjectBoardTask | undefined): Promise<void> {
		const keys = this.taskTreeSelectionKeys(task);
		const nextKeys = keys.filter((key) => !this.deps.settings.boardTaskKeys.includes(key));
		if (nextKeys.length === 0) {
			return;
		}

		this.deps.settings.boardTaskKeys = nextKeys.reduce(
			(boardTaskKeys, key) => addTaskToFocusQueue(boardTaskKeys, key),
			this.deps.settings.boardTaskKeys,
		);
		await this.deps.saveSettings();
		this.renderShell();
	}

	private async removeTaskSelection(task: ProjectBoardTask | undefined): Promise<void> {
		const keys = this.taskTreeSelectionKeys(task);
		if (keys.length === 0) {
			return;
		}

		this.deps.settings.boardTaskKeys = this.deps.settings.boardTaskKeys.filter(
			(key) => !keys.includes(key),
		);
		await this.deps.saveSettings();
		this.renderShell();
	}

	private async reorderTaskSelection(sourceKey: string, targetKey: string): Promise<void> {
		if (sourceKey.length === 0 || targetKey.length === 0 || sourceKey === targetKey) {
			return;
		}

		const sourceTask = this.taskFromSelectionKey(sourceKey);
		const sourceKeys = this.taskTreeSelectionKeys(sourceTask).filter((key) =>
			this.deps.settings.boardTaskKeys.includes(key),
		);
		if (sourceKeys.length === 0 || sourceKeys.includes(targetKey)) {
			return;
		}

		const keys = this.deps.settings.boardTaskKeys.filter((key) => !sourceKeys.includes(key));
		const targetIndex = keys.indexOf(targetKey);
		if (targetIndex < 0) {
			return;
		}

		keys.splice(targetIndex, 0, ...sourceKeys);
		this.deps.settings.boardTaskKeys = keys;
		await this.deps.saveSettings();
		this.renderShell();
	}

	private taskTreeSelectionKeys(task: ProjectBoardTask | undefined): string[] {
		if (!task) {
			return [];
		}

		return taskTreeKeys(projectTasks(this.library), task);
	}

	private taskFromSelectionKey(key: string): ProjectBoardTask | undefined {
		return projectTasks(this.library).find((task) => taskSelectionKey(task) === key);
	}

	private taskFromDrop(event: DragEvent): ProjectBoardTask | undefined {
		const key = event.dataTransfer?.getData(TASK_QUEUE_KEY_MIME) ?? '';
		return projectTasks(this.library).find((task) => taskSelectionKey(task) === key);
	}

	private projectTaskFromDrop(projectPath: string, event: DragEvent): ProjectBoardTask | undefined {
		const taskId = event.dataTransfer?.getData(TASK_ID_MIME) ?? '';
		return projectTasks(this.library).find(
			(item) => item.projectPath === projectPath && item.id === taskId,
		);
	}

	private markDropTarget(event: DragEvent, target: HTMLElement): void {
		event.preventDefault();
		target.addClass('is-drop-target');
	}

	private clearDropTarget(target: HTMLElement): void {
		target.removeClass('is-drop-target');
	}

	private markTaskDropTarget(event: DragEvent, target: HTMLElement): void {
		event.preventDefault();
		target.removeClass('is-drop-before');
		target.removeClass('is-drop-after');
		target.removeClass('is-drop-child');
		target.addClass(`is-drop-${taskDropPlacement(target, event)}`);
	}

	private clearTaskDropTarget(target: HTMLElement): void {
		target.removeClass('is-drop-before');
		target.removeClass('is-drop-after');
		target.removeClass('is-drop-child');
	}

	private markReorderTarget(event: DragEvent, target: HTMLElement): void {
		event.preventDefault();
		target.addClass('is-drop-before');
	}

	private clearReorderTarget(target: HTMLElement): void {
		target.removeClass('is-drop-before');
	}

	private boardModel() {
		return createProjectBoardModel({
			boardTaskKeys: this.deps.settings.boardTaskKeys,
			library: this.library,
			query: '',
			selectedPath: this.selectedPath,
		});
	}

	private createResizeHandle(
		container: HTMLElement,
		panel: HTMLElement,
		config: ResizeConfig,
	): HTMLElement {
		const handle = container.createDiv('tavern-resize-handle');
		let startX = 0;
		let startWidth = 0;
		let isResizing = false;

		const onMouseMove = (event: MouseEvent) => {
			/* c8 ignore next -- early return guard for inactive resize; covered by the active drag path in test */
			if (!isResizing) {
				return;
			}
			const width = Math.min(
				config.max,
				Math.max(config.min, startWidth + (event.clientX - startX)),
			);
			container.style.setProperty(config.cssVar, `${width}px`);
		};

		this.registerDomEvent(handle, 'mousedown', (event: MouseEvent) => {
			event.preventDefault();
			this.dragCleanup?.();
			startX = event.clientX;
			startWidth = parseInt(container.style.getPropertyValue(config.cssVar)) || panel.offsetWidth;
			handle.addClass('is-dragging');
			isResizing = true;
			const dragEvents = this.addChild(new Component());
			const stopResize = () => {
				isResizing = false;
				handle.removeClass('is-dragging');
				this.removeChild(dragEvents);
				this.dragCleanup = null;
			};
			dragEvents.registerDomEvent(container.ownerDocument, 'mousemove', onMouseMove);
			dragEvents.registerDomEvent(container.ownerDocument, 'mouseup', stopResize);
			this.dragCleanup = stopResize;
		});

		return handle;
	}
}

const sidebarProjectSections = (projects: ProjectSummary[]): SidebarProjectSection[] => {
	const sections = new Map<string, ProjectSummary[]>();
	for (const project of projects) {
		sections.set(project.folderName, [...(sections.get(project.folderName) ?? []), project]);
	}

	return [...sections.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([title, sectionProjects]) => ({ projects: sectionProjects, title }));
};

type InlineMarkdownSegment =
	| {
			text: string;
			type: 'text';
	  }
	| {
			href: string;
			text: string;
			type: 'link';
	  };

const MARKDOWN_LINK_PATTERN = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
const INLINE_MARKDOWN_ESCAPE_PATTERN = /\\([\\`*_[\]{}()#+\-.!|>])/g;

const unescapeInlineMarkdownText = (text: string): string =>
	text.replace(INLINE_MARKDOWN_ESCAPE_PATTERN, '$1');

const inlineMarkdownLinkSegments = (text: string): InlineMarkdownSegment[] => {
	const segments: InlineMarkdownSegment[] = [];
	let cursor = 0;

	for (const match of text.matchAll(MARKDOWN_LINK_PATTERN)) {
		const [raw, label, href] = match;
		if (label && href) {
			const index = match.index ?? 0;
			if (index > cursor) {
				segments.push({ text: text.slice(cursor, index), type: 'text' });
			}
			segments.push({ href, text: label, type: 'link' });
			cursor = index + raw.length;
		}
	}

	if (segments.length === 0) {
		return [];
	}
	if (cursor < text.length) {
		segments.push({ text: text.slice(cursor), type: 'text' });
	}

	return segments;
};

export { TAVERN_VIEW_TYPE, TavernView };
