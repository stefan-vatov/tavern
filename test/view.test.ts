/* eslint-disable eslint/max-classes-per-file, eslint/max-lines, eslint/max-statements, eslint/no-magic-numbers, promise/prefer-await-to-callbacks, @typescript-eslint/no-explicit-any */
import { beforeEach, vi } from 'vitest';
import { Effect } from 'effect';
import { setProjectTaskChecked } from '../src/project-actions';
import type { ProjectBoardTask } from '../src/project-library';
import { TavernView } from '../src/view';
import { parseDailyNote } from '../src/daily-note';
import { DailyLogService } from '../src/daily-log-service';
import { DailyLogStore } from '../src/daily-log-store';
import type { DailyLogController, DailyLogSnapshot } from '../src/daily-log-controller';
import { TAVERN_VIEW_TYPE } from '../src/project-mode';
import type { ProjectVaultFile } from '../src/project-vault';

const PROJECT_MARKDOWN = `---
Title: Pi
tavern: project
---
# Pi

## Backlog

- [ ] Build board

## Done

- [x] Existing done
`;

const OTHER_MARKDOWN = `---
Title: Blogging
tavern: project
---
# Blogging

## Backlog

- [ ] Draft post
`;

const NESTED_MARKDOWN = `---
Title: Pi
tavern: project
---
# Pi

## Backlog

- [ ] Parent task
  - [ ] Child task
    - [ ] Grandchild task
- [ ] Next task
`;

type Listener = (event: any) => void;

class FakeStyle {
	private readonly values = new Map<string, string>();

	getPropertyValue(name: string): string {
		return this.values.get(name) ?? '';
	}

	setProperty(name: string, value: string): void {
		this.values.set(name, value);
	}
}

class FakeElement {
	ownerDocument = fakeDocument;
	migrationListener: (() => void) | undefined;
	onWindowMigrated(listener: () => void): () => void {
		this.migrationListener = listener;
		return () => {
			this.migrationListener = undefined;
		};
	}
	checked = false;
	children: FakeElement[] = [];
	classes = new Set<string>();
	disabled = false;
	draggable = false;
	focused = false;
	listeners = new Map<string, Listener[]>();
	offsetWidth = 240;
	parent: FakeElement | undefined;
	style = new FakeStyle();
	text = '';
	value = '';

	constructor(
		readonly tag: string,
		options: { attr?: Record<string, string>; cls?: string; text?: string; type?: string } = {},
	) {
		this.tagName = tag.toUpperCase();
		this.attr = options.attr ?? {};
		this.type = options.type ?? '';
		if (options.cls) {
			this.addClass(options.cls);
		}
		this.text = options.text ?? '';
	}

	attr: Record<string, string>;
	tagName: string;
	type: string;

	addClass(value: string): void {
		for (const className of value.split(' ')) {
			if (className.length > 0) {
				this.classes.add(className);
			}
		}
	}

	addEventListener(type: string, listener: Listener): void {
		this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
	}

	removeEventListener(type: string, listener: Listener): void {
		this.listeners.set(
			type,
			(this.listeners.get(type) ?? []).filter((candidate) => candidate !== listener),
		);
	}

	createDiv(options?: string | { cls?: string; text?: string }): FakeElement {
		return this.createChild('div', normalizeOptions(options));
	}

	createEl(
		tag: string,
		options: {
			attr?: Record<string, string>;
			cls?: string;
			placeholder?: string;
			text?: string;
			type?: string;
			value?: string;
		},
	): FakeElement {
		const child = this.createChild(tag, options);
		child.value = options.value ?? '';
		if (options.placeholder) {
			child.attr.placeholder = options.placeholder;
		}
		return child;
	}

	createSpan(options?: string | { cls?: string; text?: string }): FakeElement {
		return this.createChild('span', normalizeOptions(options));
	}

	contains(element: FakeElement | null | undefined): boolean {
		if (!element) {
			return false;
		}
		return this === element || this.children.some((child) => child.contains(element));
	}

	dispatch(type: string, event: Record<string, unknown> = {}): void {
		const normalizedEvent = {
			preventDefault: vi.fn(),
			stopImmediatePropagation: vi.fn(),
			stopPropagation: vi.fn(),
			...event,
		};
		for (const listener of this.listeners.get(type) ?? []) {
			listener(normalizedEvent);
		}
	}

	focus(): void {
		this.focused = true;
		fakeDocument.activeElement = this;
	}

	getBoundingClientRect(): Pick<DOMRect, 'height' | 'left' | 'top'> {
		return { height: 30, left: 0, top: 0 };
	}

	setAttribute(name: string, value: string): void {
		this.attr[name] = value;
	}

	getAttributeNames(): string[] {
		return Object.keys(this.attr);
	}

	getAttribute(name: string): string | undefined {
		return this.attr[name];
	}

	empty(): void {
		this.children = [];
		this.text = '';
	}

	removeClass(value: string): void {
		this.classes.delete(value);
	}

	remove(): void {
		if (!this.parent) {
			return;
		}
		this.parent.children = this.parent.children.filter((child) => child !== this);
		this.parent = undefined;
	}

	private createChild(
		tag: string,
		options: { attr?: Record<string, string>; cls?: string; text?: string; type?: string } = {},
	): FakeElement {
		const child = new FakeElement(tag, options);
		child.parent = this;
		this.children.push(child);
		return child;
	}
}

class FakeDocument {
	activeElement: FakeElement | null = null;
	get body(): FakeElement {
		return new FakeElement('body');
	}
	private readonly listeners = new Map<string, Listener[]>();

	addEventListener(type: string, listener: Listener): void {
		this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
	}

	removeEventListener(type: string, listener: Listener): void {
		this.listeners.set(
			type,
			(this.listeners.get(type) ?? []).filter((candidate) => candidate !== listener),
		);
	}

	dispatch(type: string, event: Record<string, unknown> = {}): void {
		const normalizedEvent = {
			preventDefault: vi.fn(),
			stopImmediatePropagation: vi.fn(),
			stopPropagation: vi.fn(),
			...event,
		};
		for (const listener of this.listeners.get(type) ?? []) {
			listener(normalizedEvent);
		}
	}

	reset(): void {
		this.activeElement = null;
		this.listeners.clear();
	}
}

const fakeDocument = new FakeDocument();

type FakeMenuItem = {
	callback: (() => void) | undefined;
	icon: string;
	title: string;
};

const { keymapMock, menuItems, pushedScopes, rootElements, setIconMock, showMenuMock } = vi.hoisted(
	() => {
		const scopes: unknown[] = [];
		return {
			keymapMock: {
				popScope: vi.fn((scope: unknown) => {
					const index = scopes.indexOf(scope);
					if (index >= 0) {
						scopes.splice(index, 1);
					}
				}),
				pushScope: vi.fn((scope: unknown) => {
					scopes.push(scope);
				}),
			},
			menuItems: [] as FakeMenuItem[],
			pushedScopes: scopes,
			rootElements: [] as FakeElement[],
			setIconMock: vi.fn(),
			showMenuMock: vi.fn(),
		};
	},
);

type FakeScopeHandler = {
	func: (event: KeyboardEvent) => false | unknown;
	key: string | null;
	modifiers: string[] | null;
};

const triggerScopeKey = (scope: unknown, key: string, event: Partial<KeyboardEvent> = {}): void => {
	const handler = (scope as { handlers: FakeScopeHandler[] }).handlers.find(
		(candidate) => candidate.key === key,
	);
	if (!handler) {
		throw new Error(`scope handler for ${key} was not registered`);
	}
	handler.func(event as KeyboardEvent);
};

class FakeMenuItemApi implements FakeMenuItem {
	callback: (() => void) | undefined = undefined;
	icon = '';
	title = '';

	onClick(callback: () => void): this {
		this.callback = callback;
		return this;
	}

	setIcon(icon: string): this {
		this.icon = icon;
		return this;
	}

	setTitle(title: string): this {
		this.title = title;
		return this;
	}
}

vi.mock('obsidian', () => ({
	Component: class {
		private children: { unload(): void }[] = [];
		addChild<Child extends { unload(): void }>(child: Child): Child {
			this.children.push(child);
			return child;
		}
		removeChild(child: { unload(): void }): void {
			child.unload();
			this.children = this.children.filter((entry) => entry !== child);
		}
		private cleanups: (() => void)[] = [];
		register(cleanup: () => void): void {
			this.cleanups.push(cleanup);
		}
		registerDomEvent(element: FakeDocument, type: string, listener: Listener): void {
			element.addEventListener(type, listener);
			this.register(() => element.removeEventListener(type, listener));
		}
		unload(): void {
			for (const child of this.children) {
				child.unload();
			}
			for (const cleanup of this.cleanups) {
				cleanup();
			}
		}
	},
	ItemView: class {
		app: { keymap: typeof keymapMock; scope: unknown };
		contentEl: FakeElement;

		constructor() {
			this.app = { keymap: keymapMock, scope: { id: 'app-scope' } };
			this.contentEl = new FakeElement('root');
			rootElements.push(this.contentEl);
		}

		register(_cleanup: () => void) {}
		addChild<Child>(child: Child): Child {
			return child;
		}
		removeChild(child: { unload: () => void }): void {
			child.unload();
		}

		getState() {
			return {};
		}

		registerDomEvent(
			element: { addEventListener: (type: string, listener: Listener) => void },
			type: string,
			listener: Listener,
		): void {
			element.addEventListener(type, listener);
		}

		setState() {
			return Promise.resolve();
		}
	},
	Menu: class {
		addItem(callback: (item: FakeMenuItemApi) => void): this {
			const item = new FakeMenuItemApi();
			menuItems.push(item);
			callback(item);
			return this;
		}

		showAtMouseEvent(event: MouseEvent): void {
			showMenuMock(event);
		}
	},
	Notice: vi.fn(),
	Scope: class {
		handlers: FakeScopeHandler[] = [];

		constructor(readonly parent?: unknown) {}

		register(
			modifiers: string[] | null,
			key: string | null,
			func: (event: KeyboardEvent) => false | unknown,
		): unknown {
			this.handlers.push({ func, key, modifiers });
			return { scope: this };
		}
	},
	setIcon: setIconMock,
}));

const normalizeOptions = (
	options?: string | { cls?: string; text?: string },
): { cls?: string; text?: string } => {
	if (typeof options === 'string') {
		return { cls: options };
	}

	return options ?? {};
};

const allElements = (root: FakeElement): FakeElement[] => [
	root,
	...root.children.flatMap((child) => allElements(child)),
];

const textValues = (root: FakeElement): string[] =>
	allElements(root)
		.map((element) => element.text)
		.filter((text) => text.length > 0);

const findByAriaLabel = (root: FakeElement, label: string): FakeElement | undefined =>
	allElements(root).find((element) => element.attr['aria-label'] === label);

const dragHandleFor = (row: FakeElement | undefined): FakeElement => {
	if (!row) {
		throw new Error('task row was not rendered');
	}
	const handle = row.children.find((element) => element.classes.has('tavern-task-drag-handle'));
	if (!handle) {
		throw new Error('task drag handle was not rendered');
	}
	return handle;
};

const findByClass = (root: FakeElement, className: string): FakeElement | undefined =>
	allElements(root).find((element) => element.classes.has(className));

const findByText = (root: FakeElement, text: string): FakeElement | undefined =>
	allElements(root).find((element) => element.text === text);

const findByHref = (root: FakeElement, href: string): FakeElement | undefined =>
	allElements(root).find((element) => element.attr.href === href);

const findAllByAriaLabel = (root: FakeElement, label: string): FakeElement[] =>
	allElements(root).filter((element) => element.attr['aria-label'] === label);

const findSectionByTitle = (root: FakeElement, title: string): FakeElement | undefined =>
	allElements(root).find(
		(element) => element.classes.has('tavern-project-section-title') && element.text === title,
	)?.parent?.parent;

const createVault = (files: Record<string, string>) => {
	const markdownFiles = Object.keys(files).map((path) => ({ path }));
	return {
		getMarkdownFiles: vi.fn(() => markdownFiles),
		modify: vi.fn(async (file: ProjectVaultFile, markdown: string) => {
			files[file.path] = markdown;
		}),
		read: vi.fn(async (file: ProjectVaultFile) => files[file.path] ?? ''),
	};
};

const DAILY_MARKDOWN =
	'# 2026-10-24\n## General\n### Plan\n- [ ] Review log ^review\n  - [ ] Follow up ^follow\n### Notes\nKeep the narrative.\n';

const createDailyController = (markdown: string | null = DAILY_MARKDOWN) => ({
	today: vi.fn(() => '2026-10-24'),
	read: vi.fn(
		async (day: string): Promise<DailyLogSnapshot> => ({
			day,
			path: `logs/${day}.md`,
			// eslint-disable-next-line eslint/no-ternary
			note: markdown === null ? null : parseDailyNote(markdown),
		}),
	),
	create: vi.fn(async () => {}),
	addTask: vi.fn(async () => {}),
	editTask: vi.fn(async () => {}),
	setTaskChecked: vi.fn(async () => {}),
	moveTask: vi.fn(async () => {}),
	copyProjectTask: vi.fn(async () => {}),
});

const dailyView = (dailyLogs: DailyLogController) =>
	new TavernView({} as never, {
		dailyLogs,
		saveSettings: vi.fn(),
		settings: { boardTaskKeys: [], projectFolders: ['04_Projects'], tavernName: 'Tavern' },
		vault: createVault({ '04_Projects/Pi.md': PROJECT_MARKDOWN }),
	});

describe('tavern view', () => {
	beforeEach(() => {
		keymapMock.popScope.mockClear();
		keymapMock.pushScope.mockClear();
		menuItems.length = 0;
		pushedScopes.length = 0;
		fakeDocument.reset();
		vi.stubGlobal('document', fakeDocument);
		vi.stubGlobal('HTMLElement', FakeElement);
		showMenuMock.mockClear();
	});

	it('should expose Obsidian view metadata and state', async () => {
		const view = new TavernView({} as never, {
			saveSettings: vi.fn(),
			settings: {
				boardTaskKeys: [],
				projectFolders: ['04_Projects'],
				tavernName: 'Tavern',
			},
			vault: createVault({}),
		});

		await view.setState({ selectedPath: '04_Projects/Pi.md' }, { history: false });

		expect(view.getViewType()).toBe(TAVERN_VIEW_TYPE);
		expect(view.getDisplayText()).toBe('Tavern');
		expect(view.getIcon()).toBe('dice');
		expect(view.getState()).toEqual({
			availableTasksCollapsed: false,
			boardPage: 'global',
			boardTaskKeys: [], // L2: intentionally added to getState for workspace roundtrip of focus queue (from settings)
			globalTaskQuery: '',
			projectQuery: '',
			selectedPath: '04_Projects/Pi.md',
			sidebarCollapsedSections: [],
		});
		expect(textValues(rootElements.at(-1) as FakeElement)).toContain('No project notes found.');
	});

	it('should render a load error when vault reads fail', async () => {
		const view = new TavernView({} as never, {
			saveSettings: vi.fn(),
			settings: {
				boardTaskKeys: [],
				projectFolders: ['04_Projects'],
				tavernName: 'Tavern',
			},
			vault: {
				getMarkdownFiles: vi.fn(() => [{ path: '04_Projects/Pi.md' }]),
				modify: vi.fn(),
				read: vi.fn(async () => {
					throw new Error('read failed');
				}),
			},
		});

		await view.setState({ mode: 'note', selectedPath: '04_Projects/Pi.md' }, { history: false });

		// With per-file read degradation (graceful partial load), a single read failure no longer produces the global "could not load" exit/notice.
		// The library is empty and UI shows the no-projects empty state instead. (This matches the bugfix for load poisoning.)
		// In this note-mode + empty-library-after-degraded-read case, the detail panel renders the initial "Select a project note." placeholder (see renderDetail / note mode empty state).
		expect(textValues(rootElements.at(-1) as FakeElement)).toContain('Select a project note.');
	});

	it('should render projects and preserve the focus queue while collapsed', async () => {
		const files = {
			'04_Projects/Blogging.md': OTHER_MARKDOWN,
			'04_Projects/Pi.md': PROJECT_MARKDOWN,
		};
		const vault = createVault(files);
		const settings = {
			boardTaskKeys: [
				'04_Projects/Blogging.md::backlog-1-draft-post',
				'04_Projects/Pi.md::backlog-1-build-board',
			],
			projectFolders: ['04_Projects'],
			tavernName: 'Tavern',
		};
		const view = new TavernView({} as never, {
			saveSettings: vi.fn(),
			settings,
			vault,
		});

		await view.setState({ mode: 'board', selectedPath: '04_Projects/Pi.md' }, { history: false });

		expect(textValues(rootElements.at(-1) as FakeElement)).toEqual(
			expect.arrayContaining([
				'Global work queue',
				'Blogging',
				'Pi',
				'Focus queue',
				'Available tasks',
				'Draft post',
				'Build board',
			]),
		);

		const root = rootElements.at(-1) as FakeElement;
		const toggle = findByAriaLabel(root, 'Toggle focus queue');
		if (!toggle) {
			throw new Error('focus queue toggle was not rendered');
		}
		expect(toggle.attr['aria-expanded']).toBe('true');
		toggle.dispatch('click');

		const collapsedToggle = findByAriaLabel(root, 'Toggle focus queue');
		expect(collapsedToggle?.attr['aria-expanded']).toBe('false');
		expect(textValues(collapsedToggle as FakeElement)).toContain('2 tasks');
		expect(findByClass(root, 'tavern-focus-task')).toBeUndefined();
		collapsedToggle?.dispatch('click');

		expect(findByAriaLabel(root, 'Toggle focus queue')?.attr['aria-expanded']).toBe('true');
		const queue = findByClass(root, 'tavern-focus-queue') as FakeElement;
		expect(
			allElements(queue)
				.filter((element) => element.type === 'checkbox')
				.map((element) => element.attr['aria-label']),
		).toEqual(['Complete Draft post', 'Complete Build board']);
		expect(settings.boardTaskKeys).toEqual([
			'04_Projects/Blogging.md::backlog-1-draft-post',
			'04_Projects/Pi.md::backlog-1-build-board',
		]);
		expect(vault.modify).not.toHaveBeenCalled();
		expect(files).toEqual({
			'04_Projects/Blogging.md': OTHER_MARKDOWN,
			'04_Projects/Pi.md': PROJECT_MARKDOWN,
		});
	});

	it('should group sidebar projects by their containing subfolder', async () => {
		const view = new TavernView({} as never, {
			saveSettings: vi.fn(),
			settings: {
				boardTaskKeys: [],
				projectFolders: ['04_Projects'],
				tavernName: 'Tavern',
			},
			vault: createVault({
				'04_Projects/01_Manage/Active/Pi.md': PROJECT_MARKDOWN,
				'04_Projects/01_Manage/Backlog/Blogging.md': OTHER_MARKDOWN,
			}),
		});

		await view.setState(
			{ mode: 'board', selectedPath: '04_Projects/01_Manage/Active/Pi.md' },
			{ history: false },
		);

		const renderedText = textValues(rootElements.at(-1) as FakeElement);
		expect(renderedText).toEqual(expect.arrayContaining(['Active', 'Backlog', 'Pi', 'Blogging']));
	});

	it('should collapse and expand sidebar project sections from the section header', async () => {
		const saveSettings = vi.fn();
		const settings = {
			boardTaskKeys: [],
			projectFolders: ['04_Projects'],
			sidebarCollapsedSections: [] as string[],
			tavernName: 'Tavern',
		};
		const view = new TavernView({} as never, {
			saveSettings,
			settings,
			vault: createVault({
				'04_Projects/01_Manage/Active/Pi.md': PROJECT_MARKDOWN,
				'04_Projects/01_Manage/Backlog/Blogging.md': OTHER_MARKDOWN,
			}),
		});

		await view.setState(
			{ mode: 'board', selectedPath: '04_Projects/01_Manage/Active/Pi.md' },
			{ history: false },
		);
		const root = rootElements.at(-1) as FakeElement;
		const activeHeaderTitle = findByText(root, 'Active');
		if (!activeHeaderTitle?.parent) {
			throw new Error('active sidebar section was not rendered');
		}

		activeHeaderTitle.parent.dispatch('click');

		const collapsedSection = findByText(root, 'Active')?.parent?.parent;
		expect(collapsedSection?.classes.has('is-collapsed')).toBe(true);
		expect(textValues(collapsedSection as FakeElement)).not.toContain('Pi');
		expect(settings.sidebarCollapsedSections).toEqual(['Active']);
		expect(saveSettings).toHaveBeenCalledTimes(1);

		const collapsedActiveHeaderTitle = findByText(root, 'Active');
		collapsedActiveHeaderTitle?.parent?.dispatch('click');

		const expandedSection = findByText(root, 'Active')?.parent?.parent;
		expect(expandedSection?.classes.has('is-collapsed')).toBe(false);
		expect(textValues(expandedSection as FakeElement)).toContain('Pi');
		expect(settings.sidebarCollapsedSections).toEqual([]);
		expect(saveSettings).toHaveBeenCalledTimes(2);
	});

	it('should restore collapsed sidebar project sections from saved settings', async () => {
		const view = new TavernView({} as never, {
			saveSettings: vi.fn(),
			settings: {
				boardTaskKeys: [],
				projectFolders: ['04_Projects'],
				sidebarCollapsedSections: ['Active'],
				tavernName: 'Tavern',
			},
			vault: createVault({
				'04_Projects/01_Manage/Active/Pi.md': PROJECT_MARKDOWN,
				'04_Projects/01_Manage/Backlog/Blogging.md': OTHER_MARKDOWN,
			}),
		});

		await view.setState(
			{ mode: 'board', selectedPath: '04_Projects/01_Manage/Active/Pi.md' },
			{ history: false },
		);

		const activeSection = findByText(rootElements.at(-1) as FakeElement, 'Active')?.parent?.parent;
		expect(activeSection?.classes.has('is-collapsed')).toBe(true);
		expect(textValues(activeSection as FakeElement)).not.toContain('Pi');
	});

	it('should switch between the global queue and project detail from the sidebar', async () => {
		const view = new TavernView({} as never, {
			saveSettings: vi.fn(),
			settings: {
				boardTaskKeys: [],
				projectFolders: ['04_Projects'],
				tavernName: 'Tavern',
			},
			vault: createVault({
				'04_Projects/Blogging.md': OTHER_MARKDOWN,
				'04_Projects/Pi.md': PROJECT_MARKDOWN,
			}),
		});

		await view.onOpen();
		const root = rootElements.at(-1) as FakeElement;
		const projectTitle = findByText(root, 'Pi');
		if (!projectTitle?.parent?.parent) {
			throw new Error('project card was not rendered');
		}

		projectTitle.parent.parent.dispatch('click');

		expect(textValues(root)).toContain('Build board');
		expect(textValues(root)).not.toContain('Global work queue');
		expect(findByClass(root, 'tavern-panel-detail')?.classes.has('is-entering')).toBe(true);

		const selectedProjectTitle = findByText(root, 'Pi');
		if (!selectedProjectTitle?.parent?.parent) {
			throw new Error('selected project card was not rendered');
		}
		selectedProjectTitle.parent.parent.dispatch('click');
		expect(findByClass(root, 'tavern-panel-detail')?.classes.has('is-entering')).toBe(false);

		const globalTitle = findByText(root, 'Global queue');
		if (!globalTitle?.parent?.parent) {
			throw new Error('global queue card was not rendered');
		}

		globalTitle.parent.parent.dispatch('click');

		expect(textValues(root)).toContain('Global work queue');
		expect(findByClass(root, 'tavern-panel-detail')?.classes.has('is-entering')).toBe(true);
	});

	it('should omit low-value metadata labels from sidebar cards and project headers', async () => {
		const view = new TavernView({} as never, {
			saveSettings: vi.fn(),
			settings: {
				boardTaskKeys: [],
				projectFolders: ['04_Projects'],
				tavernName: 'Tavern',
			},
			vault: createVault({
				'04_Projects/Pi.md': `---
Title: Pi
Status: #project
Category: #manage
tavern: project
---
# Pi

## Backlog

- [ ] Build board
`,
			}),
		});

		await view.setState({ mode: 'board', selectedPath: '04_Projects/Pi.md' }, { history: false });
		const renderedText = textValues(rootElements.at(-1) as FakeElement);

		expect(renderedText).not.toContain('Build a working list from every project');
		expect(renderedText).not.toContain('04_Projects/Pi.md');
		expect(renderedText).not.toContain('#project');
		expect(renderedText).not.toContain('#manage');
	});

	it('restores legacy note mode as a project inside the app shell', async () => {
		const view = new TavernView({} as never, {
			saveSettings: vi.fn(),
			settings: {
				boardTaskKeys: [],
				projectFolders: ['04_Projects'],
				tavernName: 'Tavern',
			},
			vault: createVault({
				'04_Projects/Blogging.md': OTHER_MARKDOWN,
				'04_Projects/Pi.md': PROJECT_MARKDOWN,
			}),
		});

		await view.setState(
			{ mode: 'note', boardPage: 'global', selectedPath: '04_Projects/Pi.md' },
			{ history: false },
		);
		expect(view.getState()).toMatchObject({
			boardPage: 'project',
			selectedPath: '04_Projects/Pi.md',
		});
		const root = rootElements.at(-1) as FakeElement;

		expect(findByClass(root, 'tavern-panel-list')).toBeDefined();
		expect(findByClass(root, 'tavern-app-title')?.text).toBe('Tavern');
		expect(textValues(root)).toEqual(expect.arrayContaining(['Pi', 'Backlog', 'Build board']));
		expect(textValues(root)).toContain('Blogging');
	});

	it('should visually de-emphasize done tasks in project sections', async () => {
		const view = new TavernView({} as never, {
			saveSettings: vi.fn(),
			settings: {
				boardTaskKeys: [],
				projectFolders: ['04_Projects'],
				tavernName: 'Tavern',
			},
			vault: createVault({
				'04_Projects/Pi.md': PROJECT_MARKDOWN,
			}),
		});

		await view.setState({ mode: 'note', selectedPath: '04_Projects/Pi.md' }, { history: false });
		const doneCheckbox = findByAriaLabel(
			rootElements.at(-1) as FakeElement,
			'Complete Existing done',
		);

		expect(doneCheckbox?.parent?.classes.has('is-done')).toBe(true);
	});

	it('should render nested markdown tasks at their indentation depth', async () => {
		const view = new TavernView({} as never, {
			saveSettings: vi.fn(),
			settings: {
				boardTaskKeys: [],
				projectFolders: ['04_Projects'],
				tavernName: 'Tavern',
			},
			vault: createVault({
				'04_Projects/Pi.md': `---
Title: Pi
tavern: project
---
# Pi

## Backlog

- [ ] Parent task
  - [ ] Two space child
    - [ ] Four space child
\t- [ ] Tab child
\t  - [ ] Tab and spaces child
`,
			}),
		});

		await view.setState({ mode: 'note', selectedPath: '04_Projects/Pi.md' }, { history: false });
		const root = rootElements.at(-1) as FakeElement;
		const parentRow = findByAriaLabel(root, 'Complete Parent task')?.parent;
		const twoSpaceRow = findByAriaLabel(root, 'Complete Two space child')?.parent;
		const fourSpaceRow = findByAriaLabel(root, 'Complete Four space child')?.parent;
		const tabRow = findByAriaLabel(root, 'Complete Tab child')?.parent;
		const mixedRow = findByAriaLabel(root, 'Complete Tab and spaces child')?.parent;

		expect(parentRow?.style.getPropertyValue('--tavern-task-depth')).toBe('0');
		expect(parentRow?.classes.has('is-nested')).toBe(false);
		expect(twoSpaceRow?.style.getPropertyValue('--tavern-task-depth')).toBe('1');
		expect(twoSpaceRow?.classes.has('is-nested')).toBe(true);
		expect(fourSpaceRow?.style.getPropertyValue('--tavern-task-depth')).toBe('2');
		expect(tabRow?.style.getPropertyValue('--tavern-task-depth')).toBe('2');
		expect(mixedRow?.style.getPropertyValue('--tavern-task-depth')).toBe('3');
	});

	it('should omit project note navigation preamble from the task renderer', async () => {
		const view = new TavernView({} as never, {
			saveSettings: vi.fn(),
			settings: {
				boardTaskKeys: [],
				projectFolders: ['04_Projects'],
				tavernName: 'Tavern',
			},
			vault: createVault({
				'04_Projects/Pi.md': `---
Title: Pi
tavern: project
---
⇱ [[01_Manage]] ▴
# Pi

## Backlog

- [ ] Build board
`,
			}),
		});

		await view.setState({ mode: 'note', selectedPath: '04_Projects/Pi.md' }, { history: false });

		expect(textValues(rootElements.at(-1) as FakeElement)).not.toContain('01_Manage');
		expect(textValues(rootElements.at(-1) as FakeElement)).not.toContain('⇱ [[01_Manage]] ▴');
	});

	it('should open a task-only global search overlay with task controls', async () => {
		const vault = createVault({
			'04_Projects/Blogging.md': OTHER_MARKDOWN,
			'04_Projects/Pi.md': PROJECT_MARKDOWN,
		});
		const view = new TavernView({} as never, {
			saveSettings: vi.fn(),
			settings: {
				boardTaskKeys: [],
				projectFolders: ['04_Projects'],
				tavernName: 'Tavern',
			},
			vault,
		});

		await view.onOpen();
		const root = rootElements.at(-1) as FakeElement;
		const searchInput = allElements(root).find(
			(element) => element.tag === 'input' && element.type === 'text',
		);
		if (!searchInput) {
			throw new Error('search input was not rendered');
		}

		searchInput.value = 'draft';
		searchInput.dispatch('input');

		const overlay = findByClass(root, 'tavern-search-overlay');
		if (!overlay) {
			throw new Error('search overlay was not rendered');
		}

		expect(textValues(overlay)).toEqual(
			expect.arrayContaining(['Draft post', 'Blogging / Backlog', 'Queue']),
		);
		expect(findByAriaLabel(overlay, 'Complete Draft post')).toBeDefined();
		expect(findByAriaLabel(overlay, 'Queue task')).toBeDefined();
		const globalTaskRow = findByClass(overlay, 'tavern-search-task');
		expect(globalTaskRow?.draggable).toBe(false);
		expect(dragHandleFor(globalTaskRow).draggable).toBe(true);
		expect(findByAriaLabel(overlay, 'Edit Draft post')).toBeDefined();
		expect(textValues(overlay)).not.toContain('Projects');
		expect(textValues(overlay)).not.toContain('Build board');
		expect(textValues(root)).toContain('Pi');
	});

	it('should edit a task directly from global search with a single click', async () => {
		const files = { '04_Projects/Blogging.md': OTHER_MARKDOWN };
		const vault = createVault(files);
		const view = new TavernView({} as never, {
			saveSettings: vi.fn(),
			settings: {
				boardTaskKeys: [],
				projectFolders: ['04_Projects'],
				tavernName: 'Tavern',
			},
			vault,
		});

		await view.onOpen();
		const root = rootElements.at(-1) as FakeElement;
		const searchInput = allElements(root).find(
			(element) => element.tag === 'input' && element.type === 'text',
		);
		if (!searchInput) {
			throw new Error('search input was not rendered');
		}
		searchInput.value = 'Draft';
		searchInput.dispatch('input');

		const overlay = findByClass(root, 'tavern-search-overlay');
		const label = overlay && findByAriaLabel(overlay, 'Edit Draft post');
		if (!label) {
			throw new Error('editable search result was not rendered');
		}
		label.dispatch('click', { preventDefault: vi.fn(), stopPropagation: vi.fn() });
		const editor = findByAriaLabel(root, 'Task text for Draft post');
		if (!editor) {
			throw new Error('search result editor did not open on click');
		}
		expect(editor.focused).toBe(true);
		editor.value = 'Publish the draft';
		editor.dispatch('keydown', {
			key: 'Enter',
			preventDefault: vi.fn(),
			stopPropagation: vi.fn(),
		});
		await vi.waitFor(() => expect(vault.modify).toHaveBeenCalledTimes(1));

		expect(files['04_Projects/Blogging.md']).toContain('- [ ] Publish the draft');
	});

	it('should close the global search overlay from escape without bubbling to obsidian', async () => {
		const view = new TavernView({} as never, {
			saveSettings: vi.fn(),
			settings: {
				boardTaskKeys: [],
				projectFolders: ['04_Projects'],
				tavernName: 'Tavern',
			},
			vault: createVault({
				'04_Projects/Blogging.md': OTHER_MARKDOWN,
			}),
		});

		await view.onOpen();
		const root = rootElements.at(-1) as FakeElement;
		view.openTaskSearch();
		expect(findByClass(root, 'tavern-search-overlay')).toBeDefined();
		expect(keymapMock.pushScope).toHaveBeenCalledTimes(1);
		expect(pushedScopes).toHaveLength(1);

		const preventDefault = vi.fn();
		const stopImmediatePropagation = vi.fn();
		const stopPropagation = vi.fn();
		triggerScopeKey(pushedScopes[0], 'Escape', {
			preventDefault,
			stopImmediatePropagation,
			stopPropagation,
		});

		expect(findByClass(root, 'tavern-search-overlay')).toBeUndefined();
		expect(preventDefault).toHaveBeenCalledTimes(1);
		expect(stopImmediatePropagation).toHaveBeenCalledTimes(1);
		expect(stopPropagation).toHaveBeenCalledTimes(1);
		expect(keymapMock.popScope).toHaveBeenCalledTimes(1);
		expect(pushedScopes).toHaveLength(0);
	});

	it('should dismiss the global search overlay with escape or outside click', async () => {
		const view = new TavernView({} as never, {
			saveSettings: vi.fn(),
			settings: {
				boardTaskKeys: [],
				projectFolders: ['04_Projects'],
				tavernName: 'Tavern',
			},
			vault: createVault({
				'04_Projects/Blogging.md': OTHER_MARKDOWN,
			}),
		});

		await view.onOpen();
		const root = rootElements.at(-1) as FakeElement;
		const searchInput = allElements(root).find(
			(element) => element.tag === 'input' && element.type === 'text',
		);
		if (!searchInput) {
			throw new Error('search input was not rendered');
		}

		searchInput.value = 'blog';
		searchInput.dispatch('input');
		searchInput.dispatch('keydown', { key: 'Enter', preventDefault: vi.fn() });
		findByClass(root, 'tavern-search-overlay')?.dispatch('click');
		expect(findByClass(root, 'tavern-search-overlay')).toBeUndefined();
		const clearedSearchAfterClick = allElements(root).find(
			(element) => element.tag === 'input' && element.type === 'text',
		);
		expect(clearedSearchAfterClick?.value).toBe('');

		searchInput.dispatch('keydown', { key: 'Escape', preventDefault: vi.fn() });
		expect(findByClass(root, 'tavern-search-overlay')).toBeUndefined();

		searchInput.dispatch('focus');
		const overlayInput = findByAriaLabel(root, 'Search Tavern tasks');
		if (!overlayInput) {
			throw new Error('overlay input was not rendered');
		}
		expect(overlayInput.focused).toBe(true);
		overlayInput.dispatch('keydown', { key: 'Enter', preventDefault: vi.fn() });
		expect(findByClass(root, 'tavern-search-overlay')).toBeDefined();
		const inputStopImmediatePropagation = vi.fn();
		overlayInput.dispatch('keydown', {
			key: 'Escape',
			preventDefault: vi.fn(),
			stopImmediatePropagation: inputStopImmediatePropagation,
		});
		expect(findByClass(root, 'tavern-search-overlay')).toBeUndefined();
		expect(inputStopImmediatePropagation).toHaveBeenCalledTimes(1);
		const clearedSearchInput = allElements(root).find(
			(element) => element.tag === 'input' && element.type === 'text',
		);
		expect(clearedSearchInput?.value).toBe('');
	});

	it('should render empty and no-match global search states without filtering the sidebar', async () => {
		const view = new TavernView({} as never, {
			saveSettings: vi.fn(),
			settings: {
				boardTaskKeys: [],
				projectFolders: ['04_Projects'],
				tavernName: 'Tavern',
			},
			vault: createVault({
				'04_Projects/Blogging.md': OTHER_MARKDOWN,
				'04_Projects/Pi.md': PROJECT_MARKDOWN,
			}),
		});

		await view.onOpen();
		const root = rootElements.at(-1) as FakeElement;
		const searchInput = allElements(root).find(
			(element) => element.tag === 'input' && element.type === 'text',
		);
		if (!searchInput) {
			throw new Error('search input was not rendered');
		}

		searchInput.dispatch('focus');
		expect(textValues(findByClass(root, 'tavern-search-overlay') as FakeElement)).toContain(
			'Start typing to search open tasks.',
		);

		const overlayInput = findByAriaLabel(root, 'Search Tavern tasks');
		if (!overlayInput) {
			throw new Error('overlay input was not rendered');
		}
		overlayInput.value = 'zzzz';
		overlayInput.dispatch('input');

		expect(textValues(findByClass(root, 'tavern-search-overlay') as FakeElement)).toContain(
			'No matching open tasks.',
		);
		expect(textValues(root)).toContain('Blogging');
		expect(textValues(root)).toContain('Pi');
	});

	it('should queue a task from the global search overlay', async () => {
		const saveSettings = vi.fn();
		const settings = {
			boardTaskKeys: [] as string[],
			projectFolders: ['04_Projects'],
			tavernName: 'Tavern',
		};
		const view = new TavernView({} as never, {
			saveSettings,
			settings,
			vault: createVault({
				'04_Projects/Blogging.md': OTHER_MARKDOWN,
				'04_Projects/Pi.md': PROJECT_MARKDOWN,
			}),
		});

		await view.onOpen();
		const root = rootElements.at(-1) as FakeElement;
		const searchInput = allElements(root).find(
			(element) => element.tag === 'input' && element.type === 'text',
		);
		if (!searchInput) {
			throw new Error('search input was not rendered');
		}

		searchInput.value = 'blog';
		searchInput.dispatch('input');
		const pinButton = findByAriaLabel(root, 'Queue task');
		if (!pinButton) {
			throw new Error('overlay queue button was not rendered');
		}

		pinButton.dispatch('click', { stopPropagation: vi.fn() });
		await vi.waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(1));

		expect(settings.boardTaskKeys).toEqual(['04_Projects/Blogging.md::backlog-1-draft-post']);
	});

	it('should open a task source project from a global search row click', async () => {
		const view = new TavernView({} as never, {
			saveSettings: vi.fn(),
			settings: {
				boardTaskKeys: [],
				projectFolders: ['04_Projects'],
				tavernName: 'Tavern',
			},
			vault: createVault({
				'04_Projects/Blogging.md': OTHER_MARKDOWN,
				'04_Projects/Pi.md': PROJECT_MARKDOWN,
			}),
		});

		await view.onOpen();
		const root = rootElements.at(-1) as FakeElement;
		const searchInput = allElements(root).find(
			(element) => element.tag === 'input' && element.type === 'text',
		);
		if (!searchInput) {
			throw new Error('search input was not rendered');
		}

		searchInput.value = 'draft';
		searchInput.dispatch('input');
		const overlay = findByClass(root, 'tavern-search-overlay');
		if (!overlay) {
			throw new Error('search overlay was not rendered');
		}
		const checkbox = findByAriaLabel(overlay, 'Complete Draft post');
		const taskEl = checkbox?.parent;
		if (!taskEl) {
			throw new Error('overlay task row was not rendered');
		}

		taskEl.dispatch('click');

		expect(findByClass(root, 'tavern-search-overlay')).toBeUndefined();
		expect(view.getState()).toEqual(
			expect.objectContaining({
				boardPage: 'project',
				selectedPath: '04_Projects/Blogging.md',
			}),
		);
		expect(textValues(root)).toContain('Draft post');
	});

	it('should not open a task source project from overlay checkbox or queue controls', async () => {
		const settings = {
			boardTaskKeys: [] as string[],
			projectFolders: ['04_Projects'],
			tavernName: 'Tavern',
		};
		const view = new TavernView({} as never, {
			saveSettings: vi.fn(),
			settings,
			vault: createVault({
				'04_Projects/Blogging.md': OTHER_MARKDOWN,
				'04_Projects/Pi.md': PROJECT_MARKDOWN,
			}),
		});

		await view.onOpen();
		const root = rootElements.at(-1) as FakeElement;
		const searchInput = allElements(root).find(
			(element) => element.tag === 'input' && element.type === 'text',
		);
		if (!searchInput) {
			throw new Error('search input was not rendered');
		}

		searchInput.value = 'draft';
		searchInput.dispatch('input');
		const overlay = findByClass(root, 'tavern-search-overlay');
		if (!overlay) {
			throw new Error('search overlay was not rendered');
		}
		findByAriaLabel(overlay, 'Complete Draft post')?.dispatch('click');
		findByAriaLabel(overlay, 'Queue task')?.dispatch('click');

		expect(view.getState()).toEqual(
			expect.objectContaining({
				boardPage: 'global',
				selectedPath: '',
			}),
		);
	});

	it('should expose the task context menu from the global search overlay', async () => {
		const view = new TavernView({} as never, {
			saveSettings: vi.fn(),
			settings: {
				boardTaskKeys: [],
				projectFolders: ['04_Projects'],
				tavernName: 'Tavern',
			},
			vault: createVault({
				'04_Projects/Blogging.md': OTHER_MARKDOWN,
			}),
		});

		await view.onOpen();
		const root = rootElements.at(-1) as FakeElement;
		const searchInput = allElements(root).find(
			(element) => element.tag === 'input' && element.type === 'text',
		);
		if (!searchInput) {
			throw new Error('search input was not rendered');
		}

		searchInput.value = 'draft';
		searchInput.dispatch('input');
		const checkbox = findByAriaLabel(root, 'Complete Draft post');
		const taskEl = checkbox?.parent;
		if (!taskEl) {
			throw new Error('overlay task row was not rendered');
		}

		checkbox.checked = false;
		checkbox.dispatch('change');
		taskEl.dispatch('contextmenu', { preventDefault: vi.fn(), stopPropagation: vi.fn() });

		expect(showMenuMock).toHaveBeenCalledTimes(1);
		expect(menuItems.map((item) => item.title)).toEqual(['Delete task', 'Add to global queue']);
	});

	it('should show queued state in the global search overlay', async () => {
		const view = new TavernView({} as never, {
			saveSettings: vi.fn(),
			settings: {
				boardTaskKeys: ['04_Projects/Blogging.md::backlog-1-draft-post'],
				projectFolders: ['04_Projects'],
				tavernName: 'Tavern',
			},
			vault: createVault({
				'04_Projects/Blogging.md': OTHER_MARKDOWN,
			}),
		});

		await view.onOpen();
		const root = rootElements.at(-1) as FakeElement;
		const searchInput = allElements(root).find(
			(element) => element.tag === 'input' && element.type === 'text',
		);
		if (!searchInput) {
			throw new Error('search input was not rendered');
		}

		searchInput.value = 'draft';
		searchInput.dispatch('input');
		const overlay = findByClass(root, 'tavern-search-overlay');
		if (!overlay) {
			throw new Error('search overlay was not rendered');
		}
		const queuedButton = findByAriaLabel(overlay, 'Queued task');
		const checkbox = findByAriaLabel(overlay, 'Complete Draft post');
		const taskEl = checkbox?.parent;
		if (!queuedButton || !taskEl) {
			throw new Error('queued overlay task was not rendered');
		}

		expect(taskEl.classes.has('is-in-global-queue')).toBe(true);
		expect(textValues(queuedButton)).toContain('Queued');
	});

	it('should exclude project-only matches from the global search overlay', async () => {
		const view = new TavernView({} as never, {
			saveSettings: vi.fn(),
			settings: {
				boardTaskKeys: [],
				projectFolders: ['04_Projects'],
				tavernName: 'Tavern',
			},
			vault: createVault({
				'04_Projects/Empty.md': `---
Title: Empty Project
tavern: project
---
# Empty Project

## Backlog
`,
			}),
		});

		await view.onOpen();
		const root = rootElements.at(-1) as FakeElement;
		const searchInput = allElements(root).find(
			(element) => element.tag === 'input' && element.type === 'text',
		);
		if (!searchInput) {
			throw new Error('search input was not rendered');
		}

		searchInput.value = 'empty';
		searchInput.dispatch('input');
		const overlay = findByClass(root, 'tavern-search-overlay');
		if (!overlay) {
			throw new Error('search overlay was not rendered');
		}

		expect(textValues(overlay)).toContain('No matching open tasks.');
		expect(textValues(overlay)).not.toContain('Empty Project');
	});

	it('should fuzzy filter the global task list from the global filter', async () => {
		const view = new TavernView({} as never, {
			saveSettings: vi.fn(),
			settings: {
				boardTaskKeys: ['04_Projects/Pi.md::backlog-1-build-board'],
				projectFolders: ['04_Projects'],
				tavernName: 'Tavern',
			},
			vault: createVault({
				'04_Projects/Blogging.md': OTHER_MARKDOWN,
				'04_Projects/Pi.md': PROJECT_MARKDOWN,
			}),
		});

		await view.onOpen();
		const root = rootElements.at(-1) as FakeElement;
		const globalFilter = findByAriaLabel(root, 'Filter global tasks');
		if (!globalFilter) {
			throw new Error('global task filter was not rendered');
		}

		globalFilter.value = 'draft';
		globalFilter.dispatch('input');

		expect(findByAriaLabel(root, 'Filter global tasks')).toBe(globalFilter);
		expect(globalFilter.value).toBe('draft');
		expect(textValues(findByClass(root, 'tavern-detail-meta-bar') as FakeElement)).toEqual(
			expect.arrayContaining(['2 projects', '2 open tasks']),
		);
		expect(textValues(root)).toContain('Draft post');
		expect(textValues(root)).not.toContain('Build board');
		findByAriaLabel(root, 'Toggle focus queue')?.dispatch('click');
		expect(textValues(findByClass(root, 'tavern-detail-meta-bar') as FakeElement)).toEqual(
			expect.arrayContaining(['2 projects', '2 open tasks']),
		);
		expect(findByAriaLabel(root, 'Filter global tasks')?.value).toBe('draft');
		expect(view.getState()).toEqual(
			expect.objectContaining({
				globalTaskQuery: 'draft',
			}),
		);
	});

	it('should fuzzy filter the selected project task sections from the project detail', async () => {
		const view = new TavernView({} as never, {
			saveSettings: vi.fn(),
			settings: {
				boardTaskKeys: [],
				projectFolders: ['04_Projects'],
				tavernName: 'Tavern',
			},
			vault: createVault({
				'04_Projects/Pi.md': `---
Title: Pi
tavern: project
---
# Pi

## In Progress

- [ ] Build launch list
- [ ] Check import flow

## Backlog

- [ ] Draft release note
`,
			}),
		});

		await view.setState({ mode: 'note', selectedPath: '04_Projects/Pi.md' }, { history: false });
		const root = rootElements.at(-1) as FakeElement;
		const projectFilter = findByAriaLabel(root, 'Filter project tasks');
		if (!projectFilter) {
			throw new Error('project task filter was not rendered');
		}

		projectFilter.value = 'draft';
		projectFilter.dispatch('input');

		expect(findByClass(root, 'tavern-panel-list')).toBeDefined();
		expect(findByAriaLabel(root, 'Filter project tasks')).toBe(projectFilter);
		expect(projectFilter.value).toBe('draft');
		expect(textValues(root)).toContain('Draft release note');
		expect(textValues(root)).not.toContain('Build launch list');
		expect(textValues(root)).not.toContain('Check import flow');
		expect(view.getState()).toEqual(
			expect.objectContaining({
				projectQuery: 'draft',
			}),
		);
	});

	it('should add tasks to any section from the selected project detail', async () => {
		const files = {
			'04_Projects/Pi.md': PROJECT_MARKDOWN,
		};
		const vault = createVault(files);
		const view = new TavernView({} as never, {
			saveSettings: vi.fn(),
			settings: {
				boardTaskKeys: [],
				projectFolders: ['04_Projects'],
				tavernName: 'Tavern',
			},
			vault,
		});

		await view.setState({ mode: 'note', selectedPath: '04_Projects/Pi.md' }, { history: false });
		const root = rootElements.at(-1) as FakeElement;
		const backlogInput = findByAriaLabel(root, 'Add task to Backlog');
		const doneInput = findByAriaLabel(root, 'Add task to Done');
		const createBacklogButton = findByAriaLabel(root, 'Create task in Backlog');
		if (!backlogInput || !doneInput || !createBacklogButton) {
			throw new Error('section add task controls were not rendered');
		}

		backlogInput.value = 'Review task creation';
		createBacklogButton.dispatch('click', { preventDefault: vi.fn(), stopPropagation: vi.fn() });
		await vi.waitFor(() => expect(vault.modify).toHaveBeenCalledTimes(1));

		expect(files['04_Projects/Pi.md']).toContain('- [ ] Build board\n- [ ] Review task creation');
	});

	it('should edit project task text on click and drag only from its handle', async () => {
		const files = {
			'04_Projects/Pi.md': PROJECT_MARKDOWN,
		};
		const vault = createVault(files);
		const view = new TavernView({} as never, {
			saveSettings: vi.fn(),
			settings: {
				boardTaskKeys: [],
				projectFolders: ['04_Projects'],
				tavernName: 'Tavern',
			},
			vault,
		});

		await view.setState({ mode: 'note', selectedPath: '04_Projects/Pi.md' }, { history: false });
		const root = rootElements.at(-1) as FakeElement;
		const editLabel = findByAriaLabel(root, 'Edit Build board');
		if (!editLabel) {
			throw new Error('editable task label was not rendered');
		}
		const taskRow = editLabel.parent;
		const dragHandle = dragHandleFor(taskRow);
		expect(taskRow?.draggable).toBe(false);
		expect(dragHandle.draggable).toBe(true);
		expect(dragHandle.tagName).toBe('BUTTON');

		editLabel.dispatch('click', { preventDefault: vi.fn(), stopPropagation: vi.fn() });
		const editor = findByAriaLabel(root, 'Task text for Build board');
		if (!editor) {
			throw new Error('task edit input was not rendered');
		}
		expect(editor.focused).toBe(true);

		dragHandle.dispatch('dragstart', { dataTransfer: { setData: vi.fn() } });
		expect(taskRow?.classes.has('is-dragging-task')).toBe(true);
		dragHandle.dispatch('dragend');
		expect(taskRow?.classes.has('is-dragging-task')).toBe(false);
		editor.value = 'Build inline editor';
		editor.dispatch('keydown', {
			key: 'Enter',
			preventDefault: vi.fn(),
			stopPropagation: vi.fn(),
		});
		await vi.waitFor(() => expect(vault.modify).toHaveBeenCalledTimes(1));

		expect(files['04_Projects/Pi.md']).toContain('- [ ] Build inline editor');
		expect(files['04_Projects/Pi.md']).not.toContain('- [ ] Build board');
	});

	it('should render markdown links in task text as clickable links', async () => {
		const files = {
			'04_Projects/Pi.md': PROJECT_MARKDOWN.replace(
				'- [ ] Build board',
				'- [ ] Adopt [opensrc \\| Source Code for AI Coding Agents](https://opensrc.sh) into toolchain',
			),
		};
		const vault = createVault(files);
		const view = new TavernView({} as never, {
			saveSettings: vi.fn(),
			settings: {
				boardTaskKeys: [],
				projectFolders: ['04_Projects'],
				tavernName: 'Tavern',
			},
			vault,
		});

		await view.setState({ mode: 'note', selectedPath: '04_Projects/Pi.md' }, { history: false });
		const root = rootElements.at(-1) as FakeElement;
		const link = findByHref(root, 'https://opensrc.sh');
		if (!link) {
			throw new Error('markdown task link was not rendered');
		}
		const stopPropagation = vi.fn();

		link.dispatch('click', { stopPropagation });

		expect(link.tagName).toBe('A');
		expect(link.text).toBe('opensrc | Source Code for AI Coding Agents');
		expect(link.attr.target).toBe('_blank');
		expect(textValues(root)).not.toContain(
			'[opensrc \\| Source Code for AI Coding Agents](https://opensrc.sh)',
		);
		expect(stopPropagation).toHaveBeenCalledTimes(1);
	});

	it('should edit global queue task text in its source project', async () => {
		const files = {
			'04_Projects/Pi.md': PROJECT_MARKDOWN,
		};
		const vault = createVault(files);
		const view = new TavernView({} as never, {
			saveSettings: vi.fn(),
			settings: {
				boardTaskKeys: [],
				projectFolders: ['04_Projects'],
				tavernName: 'Tavern',
			},
			vault,
		});

		await view.onOpen();
		const root = rootElements.at(-1) as FakeElement;
		const editLabel = findByAriaLabel(root, 'Edit Build board');
		if (!editLabel) {
			throw new Error('editable global task label was not rendered');
		}

		editLabel.dispatch('keydown', {
			key: 'Enter',
			preventDefault: vi.fn(),
			stopPropagation: vi.fn(),
		});
		const editor = findByAriaLabel(root, 'Task text for Build board');
		if (!editor) {
			throw new Error('global task edit input was not rendered');
		}

		editor.value = 'Build global editor';
		editor.dispatch('blur');
		await vi.waitFor(() => expect(vault.modify).toHaveBeenCalledTimes(1));

		expect(files['04_Projects/Pi.md']).toContain('- [ ] Build global editor');
	});

	it('should cancel inline task editing with escape', async () => {
		const vault = createVault({
			'04_Projects/Pi.md': PROJECT_MARKDOWN,
		});
		const view = new TavernView({} as never, {
			saveSettings: vi.fn(),
			settings: {
				boardTaskKeys: [],
				projectFolders: ['04_Projects'],
				tavernName: 'Tavern',
			},
			vault,
		});

		await view.setState({ mode: 'note', selectedPath: '04_Projects/Pi.md' }, { history: false });
		const editLabel = findByAriaLabel(rootElements.at(-1) as FakeElement, 'Edit Build board');
		if (!editLabel) {
			throw new Error('editable task label was not rendered');
		}

		editLabel.dispatch('click', { preventDefault: vi.fn(), stopPropagation: vi.fn() });
		const editor = findByAriaLabel(rootElements.at(-1) as FakeElement, 'Task text for Build board');
		if (!editor) {
			throw new Error('task edit input was not rendered');
		}

		editor.value = 'Do not save this';
		editor.dispatch('keydown', {
			key: 'Escape',
			preventDefault: vi.fn(),
			stopPropagation: vi.fn(),
		});
		editor.dispatch('blur');

		expect(vault.modify).not.toHaveBeenCalled();
	});

	it('should add a project task with enter and ignore blank task creation', async () => {
		const files = {
			'04_Projects/Pi.md': PROJECT_MARKDOWN,
		};
		const vault = createVault(files);
		const view = new TavernView({} as never, {
			saveSettings: vi.fn(),
			settings: {
				boardTaskKeys: [],
				projectFolders: ['04_Projects'],
				tavernName: 'Tavern',
			},
			vault,
		});

		await view.setState({ mode: 'note', selectedPath: '04_Projects/Pi.md' }, { history: false });
		const input = findByAriaLabel(rootElements.at(-1) as FakeElement, 'Add task to Backlog');
		if (!input) {
			throw new Error('add task input was not rendered');
		}

		input.value = '   ';
		input.dispatch('keydown', { key: 'Enter', preventDefault: vi.fn(), stopPropagation: vi.fn() });
		expect(vault.modify).not.toHaveBeenCalled();

		input.value = 'Capture keyboard task';
		input.dispatch('keydown', { key: 'Escape', preventDefault: vi.fn(), stopPropagation: vi.fn() });
		expect(vault.modify).not.toHaveBeenCalled();

		input.dispatch('keydown', { key: 'Enter', preventDefault: vi.fn(), stopPropagation: vi.fn() });
		await vi.waitFor(() => expect(vault.modify).toHaveBeenCalledTimes(1));

		expect(files['04_Projects/Pi.md']).toContain('- [ ] Build board\n- [ ] Capture keyboard task');
	});

	it('should show a notice when project task creation fails', async () => {
		const { Notice } = await import('obsidian');
		const view = new TavernView({} as never, {
			saveSettings: vi.fn(),
			settings: {
				boardTaskKeys: [],
				projectFolders: ['04_Projects'],
				tavernName: 'Tavern',
			},
			vault: createVault({
				'04_Projects/Pi.md': '# Not a tavern project',
			}),
		});

		await view.setState({ mode: 'note', selectedPath: '04_Projects/Pi.md' }, { history: false });
		const typedView = view as unknown as {
			addTask: (projectPath: string, sectionName: string, taskText: string) => Promise<void>;
		};

		await typedView.addTask('04_Projects/Pi.md', 'Backlog', 'Review');

		expect(Notice).toHaveBeenCalledWith('Tavern could not add the task.');
	});

	it('should not render add-task inputs on the global aggregate view', async () => {
		const view = new TavernView({} as never, {
			saveSettings: vi.fn(),
			settings: {
				boardTaskKeys: [],
				projectFolders: ['04_Projects'],
				tavernName: 'Tavern',
			},
			vault: createVault({
				'04_Projects/Pi.md': PROJECT_MARKDOWN,
			}),
		});

		await view.onOpen();

		expect(
			findByAriaLabel(rootElements.at(-1) as FakeElement, 'Add task to Backlog'),
		).toBeUndefined();
	});

	it('should render an empty global task list when every task is done', async () => {
		const view = new TavernView({} as never, {
			saveSettings: vi.fn(),
			settings: {
				boardTaskKeys: [],
				projectFolders: ['04_Projects'],
				tavernName: 'Tavern',
			},
			vault: createVault({
				'04_Projects/Pi.md': `---
Title: Pi
tavern: project
---
# Pi

## Done

- [x] Existing done
`,
			}),
		});

		await view.onOpen();

		expect(textValues(rootElements.at(-1) as FakeElement)).toContain('No open tasks found.');
	});

	it('should collapse and expand the available task list', async () => {
		const saveSettings = vi.fn();
		const settings = {
			availableTasksCollapsed: false,
			boardTaskKeys: [],
			projectFolders: ['04_Projects'],
			tavernName: 'Tavern',
		};
		const view = new TavernView({} as never, {
			saveSettings,
			settings,
			vault: createVault({
				'04_Projects/Pi.md': PROJECT_MARKDOWN,
			}),
		});

		await view.onOpen();
		const root = rootElements.at(-1) as FakeElement;
		const toggleButton = findByAriaLabel(root, 'Toggle available tasks');
		if (!toggleButton) {
			throw new Error('available task toggle was not rendered');
		}

		expect(textValues(root)).toContain('Build board');

		toggleButton.dispatch('click');

		expect(textValues(root)).not.toContain('Build board');
		expect(settings.availableTasksCollapsed).toBe(true);
		expect(saveSettings).toHaveBeenCalledTimes(1);
		expect(view.getState()).toEqual(
			expect.objectContaining({
				availableTasksCollapsed: true,
			}),
		);

		const nextToggleButton = findByAriaLabel(root, 'Toggle available tasks');
		nextToggleButton?.dispatch('click');

		expect(textValues(root)).toContain('Build board');
		expect(settings.availableTasksCollapsed).toBe(false);
		expect(saveSettings).toHaveBeenCalledTimes(2);
	});

	it('should restore available task collapse state from saved settings', async () => {
		const view = new TavernView({} as never, {
			saveSettings: vi.fn(),
			settings: {
				availableTasksCollapsed: true,
				boardTaskKeys: [],
				projectFolders: ['04_Projects'],
				tavernName: 'Tavern',
			},
			vault: createVault({
				'04_Projects/Pi.md': PROJECT_MARKDOWN,
			}),
		});

		await view.onOpen();

		const root = rootElements.at(-1) as FakeElement;
		const availableSection = findByText(root, 'Available tasks')?.parent?.parent?.parent;
		expect(availableSection?.classes.has('is-collapsed')).toBe(true);
		expect(textValues(root)).not.toContain('Build board');
	});

	it('should complete a task and persist it back to the project note', async () => {
		const files = {
			'04_Projects/Pi.md': PROJECT_MARKDOWN,
		};
		const vault = createVault(files);
		const view = new TavernView({} as never, {
			saveSettings: vi.fn(),
			settings: {
				boardTaskKeys: [],
				projectFolders: ['04_Projects'],
				tavernName: 'Tavern',
			},
			vault,
		});

		await view.onOpen();
		const checkbox = findByAriaLabel(rootElements.at(-1) as FakeElement, 'Complete Build board');
		if (!checkbox) {
			throw new Error('task checkbox was not rendered');
		}

		checkbox.checked = true;
		checkbox.dispatch('change');
		await vi.waitFor(() => expect(vault.modify).toHaveBeenCalledTimes(1));

		expect(files['04_Projects/Pi.md']).toContain(
			'## Done\n\n- [x] Existing done\n- [x] Build board',
		);
	});

	it('should ignore unchecked task changes', async () => {
		const vault = createVault({
			'04_Projects/Pi.md': PROJECT_MARKDOWN,
		});
		const view = new TavernView({} as never, {
			saveSettings: vi.fn(),
			settings: {
				boardTaskKeys: [],
				projectFolders: ['04_Projects'],
				tavernName: 'Tavern',
			},
			vault,
		});

		await view.setState({ mode: 'note', selectedPath: '04_Projects/Pi.md' }, { history: false });
		const checkbox = findByAriaLabel(rootElements.at(-1) as FakeElement, 'Complete Build board');
		if (!checkbox) {
			throw new Error('task checkbox was not rendered');
		}

		checkbox.checked = false;
		checkbox.dispatch('change');

		expect(vault.modify).not.toHaveBeenCalled();
	});

	it('should pin and unpin tasks from the focus queue', async () => {
		const saveSettings = vi.fn();
		const settings = {
			boardTaskKeys: [] as string[],
			projectFolders: ['04_Projects'],
			tavernName: 'Tavern',
		};
		const view = new TavernView({} as never, {
			saveSettings,
			settings,
			vault: createVault({
				'04_Projects/Blogging.md': OTHER_MARKDOWN,
			}),
		});

		await view.onOpen();
		let pinButton = findByAriaLabel(rootElements.at(-1) as FakeElement, 'Queue task');
		if (!pinButton) {
			throw new Error('pin button was not rendered');
		}

		expect(textValues(pinButton)).toContain('Queue');
		pinButton.dispatch('click', { stopPropagation: vi.fn() });
		await vi.waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(1));
		expect(settings.boardTaskKeys).toEqual(['04_Projects/Blogging.md::backlog-1-draft-post']);

		pinButton = findByAriaLabel(rootElements.at(-1) as FakeElement, 'Queued task');
		if (!pinButton) {
			throw new Error('queued pin button was not rendered');
		}
		expect(textValues(pinButton)).toContain('Queued');
		pinButton?.dispatch('click', { stopPropagation: vi.fn() });
		await vi.waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(2));
		expect(settings.boardTaskKeys).toEqual([]);
	});

	it('should mark queued tasks with a visible row and pin state', async () => {
		const view = new TavernView({} as never, {
			saveSettings: vi.fn(),
			settings: {
				boardTaskKeys: ['04_Projects/Pi.md::backlog-1-build-board'],
				projectFolders: ['04_Projects'],
				tavernName: 'Tavern',
			},
			vault: createVault({
				'04_Projects/Pi.md': PROJECT_MARKDOWN,
			}),
		});

		await view.setState({ mode: 'note', selectedPath: '04_Projects/Pi.md' }, { history: false });
		const checkbox = findByAriaLabel(rootElements.at(-1) as FakeElement, 'Complete Build board');
		const taskEl = checkbox?.parent;
		const pinButton = findByAriaLabel(rootElements.at(-1) as FakeElement, 'Queued task');
		if (!taskEl || !pinButton) {
			throw new Error('queued task indicator was not rendered');
		}

		expect(taskEl.classes.has('is-in-global-queue')).toBe(true);
		expect(pinButton.classes.has('is-selected')).toBe(true);
		expect(textValues(pinButton)).toContain('Queued');
	});

	it('should add a project task to the focus queue from the context menu', async () => {
		const saveSettings = vi.fn();
		const settings = {
			boardTaskKeys: [] as string[],
			projectFolders: ['04_Projects'],
			tavernName: 'Tavern',
		};
		const view = new TavernView({} as never, {
			saveSettings,
			settings,
			vault: createVault({
				'04_Projects/Pi.md': PROJECT_MARKDOWN,
			}),
		});

		await view.setState({ mode: 'note', selectedPath: '04_Projects/Pi.md' }, { history: false });
		const checkbox = findByAriaLabel(rootElements.at(-1) as FakeElement, 'Complete Build board');
		const taskEl = checkbox?.parent;
		if (!taskEl) {
			throw new Error('project task was not rendered');
		}

		taskEl.dispatch('contextmenu', { preventDefault: vi.fn(), stopPropagation: vi.fn() });
		expect(showMenuMock).toHaveBeenCalledTimes(1);
		expect(menuItems.at(-1)?.title).toBe('Add to global queue');

		menuItems.at(-1)?.callback?.();
		await vi.waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(1));

		expect(settings.boardTaskKeys).toEqual(['04_Projects/Pi.md::backlog-1-build-board']);
	});

	it('should remove an existing task from the focus queue from the context menu', async () => {
		const saveSettings = vi.fn();
		const settings = {
			boardTaskKeys: ['04_Projects/Pi.md::backlog-1-build-board'],
			projectFolders: ['04_Projects'],
			tavernName: 'Tavern',
		};
		const view = new TavernView({} as never, {
			saveSettings,
			settings,
			vault: createVault({
				'04_Projects/Pi.md': PROJECT_MARKDOWN,
			}),
		});

		await view.setState({ mode: 'note', selectedPath: '04_Projects/Pi.md' }, { history: false });
		const checkbox = findByAriaLabel(rootElements.at(-1) as FakeElement, 'Complete Build board');
		const taskEl = checkbox?.parent;
		if (!taskEl) {
			throw new Error('project task was not rendered');
		}

		taskEl.dispatch('contextmenu', { preventDefault: vi.fn(), stopPropagation: vi.fn() });
		expect(showMenuMock).toHaveBeenCalledTimes(1);
		expect(menuItems.at(-1)?.title).toBe('Remove from global queue');

		menuItems.at(-1)?.callback?.();
		await vi.waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(1));

		expect(settings.boardTaskKeys).toEqual([]);
	});

	it('should add a global list task to the focus queue from the context menu', async () => {
		const saveSettings = vi.fn();
		const settings = {
			boardTaskKeys: [] as string[],
			projectFolders: ['04_Projects'],
			tavernName: 'Tavern',
		};
		const view = new TavernView({} as never, {
			saveSettings,
			settings,
			vault: createVault({
				'04_Projects/Pi.md': PROJECT_MARKDOWN,
			}),
		});

		await view.onOpen();
		const checkbox = findByAriaLabel(rootElements.at(-1) as FakeElement, 'Complete Build board');
		const taskEl = checkbox?.parent;
		if (!taskEl) {
			throw new Error('global task was not rendered');
		}

		taskEl.dispatch('contextmenu', { preventDefault: vi.fn(), stopPropagation: vi.fn() });
		expect(menuItems.at(-1)?.title).toBe('Add to global queue');

		menuItems.at(-1)?.callback?.();
		await vi.waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(1));

		expect(settings.boardTaskKeys).toEqual(['04_Projects/Pi.md::backlog-1-build-board']);
	});

	it('should delete a task from the context menu and remove it from the focus queue', async () => {
		const saveSettings = vi.fn();
		const settings = {
			boardTaskKeys: ['04_Projects/Pi.md::backlog-1-build-board'],
			projectFolders: ['04_Projects'],
			tavernName: 'Tavern',
		};
		const files = {
			'04_Projects/Pi.md': PROJECT_MARKDOWN,
		};
		const vault = createVault(files);
		const view = new TavernView({} as never, {
			saveSettings,
			settings,
			vault,
		});

		await view.setState({ mode: 'note', selectedPath: '04_Projects/Pi.md' }, { history: false });
		const checkbox = findByAriaLabel(rootElements.at(-1) as FakeElement, 'Complete Build board');
		const taskEl = checkbox?.parent;
		if (!taskEl) {
			throw new Error('project task was not rendered');
		}

		taskEl.dispatch('contextmenu', { preventDefault: vi.fn(), stopPropagation: vi.fn() });
		const deleteItem = menuItems.find((item) => item.title === 'Delete task');
		if (!deleteItem) {
			throw new Error('delete menu item was not rendered');
		}

		deleteItem.callback?.();
		await vi.waitFor(() => expect(vault.modify).toHaveBeenCalledTimes(1));
		await vi.waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(1));

		expect(files['04_Projects/Pi.md']).not.toContain('Build board');
		expect(settings.boardTaskKeys).toEqual([]);
		expect(textValues(rootElements.at(-1) as FakeElement)).not.toContain('Build board');
	});

	it('should add a dragged task to the focus queue', async () => {
		const saveSettings = vi.fn();
		const settings = {
			boardTaskKeys: [] as string[],
			projectFolders: ['04_Projects'],
			tavernName: 'Tavern',
		};
		const view = new TavernView({} as never, {
			saveSettings,
			settings,
			vault: createVault({
				'04_Projects/Pi.md': PROJECT_MARKDOWN,
			}),
		});
		const dragData = new Map<string, string>();

		await view.onOpen();
		const root = rootElements.at(-1) as FakeElement;
		const checkbox = findByAriaLabel(root, 'Complete Build board');
		const taskEl = checkbox?.parent;
		const focusQueue = findByClass(root, 'tavern-focus-queue');
		if (!taskEl || !focusQueue) {
			throw new Error('task row or focus queue was not rendered');
		}
		expect(taskEl.draggable).toBe(false);
		expect(dragHandleFor(taskEl).draggable).toBe(true);

		dragHandleFor(taskEl).dispatch('dragstart', {
			dataTransfer: {
				setData: (type: string, value: string) => dragData.set(type, value),
			},
		});
		focusQueue.dispatch('drop', {
			dataTransfer: { getData: (type: string) => dragData.get(type) ?? '' },
			preventDefault: vi.fn(),
		});
		await vi.waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(1));

		expect(settings.boardTaskKeys).toEqual(['04_Projects/Pi.md::backlog-1-build-board']);
	});

	it('should persist dragged task trees in the focus queue', async () => {
		const saveSettings = vi.fn();
		const settings = {
			boardTaskKeys: [] as string[],
			projectFolders: ['04_Projects'],
			tavernName: 'Tavern',
		};
		const view = new TavernView({} as never, {
			saveSettings,
			settings,
			vault: createVault({
				'04_Projects/Pi.md': NESTED_MARKDOWN,
			}),
		});
		const dragData = new Map<string, string>();

		await view.onOpen();
		const root = rootElements.at(-1) as FakeElement;
		const parentTask = findByAriaLabel(root, 'Complete Parent task')?.parent;
		const focusQueue = findByClass(root, 'tavern-focus-queue');
		if (!parentTask || !focusQueue) {
			throw new Error('parent task or focus queue was not rendered');
		}

		dragHandleFor(parentTask).dispatch('dragstart', {
			dataTransfer: {
				setData: (type: string, value: string) => dragData.set(type, value),
			},
		});
		focusQueue.dispatch('drop', {
			dataTransfer: { getData: (type: string) => dragData.get(type) ?? '' },
			preventDefault: vi.fn(),
		});
		await vi.waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(1));

		expect(settings.boardTaskKeys).toEqual([
			'04_Projects/Pi.md::backlog-1-parent-task',
			'04_Projects/Pi.md::backlog-2-child-task',
			'04_Projects/Pi.md::backlog-3-grandchild-task',
		]);
	});

	it('should restore persisted focus queue task trees when tavern reopens', async () => {
		const settings = {
			boardTaskKeys: ['04_Projects/Pi.md::backlog-1-parent-task'],
			projectFolders: ['04_Projects'],
			tavernName: 'Tavern',
		};
		const vault = createVault({
			'04_Projects/Pi.md': NESTED_MARKDOWN,
		});

		await new TavernView({} as never, {
			saveSettings: vi.fn(),
			settings,
			vault,
		}).onOpen();
		await new TavernView({} as never, {
			saveSettings: vi.fn(),
			settings,
			vault,
		}).onOpen();

		const root = rootElements.at(-1) as FakeElement;
		const parentRow = findByAriaLabel(root, 'Complete Parent task')?.parent;
		const childRow = findByAriaLabel(root, 'Complete Child task')?.parent;
		const grandchildRow = findByAriaLabel(root, 'Complete Grandchild task')?.parent;
		if (!parentRow || !childRow || !grandchildRow) {
			throw new Error('focus queue tree was not restored');
		}

		expect(parentRow.classes.has('tavern-focus-task')).toBe(true);
		expect(childRow.classes.has('tavern-focus-task')).toBe(true);
		expect(grandchildRow.classes.has('tavern-focus-task')).toBe(true);
		expect(parentRow.style.getPropertyValue('--tavern-task-depth')).toBe('0');
		expect(childRow.style.getPropertyValue('--tavern-task-depth')).toBe('1');
		expect(grandchildRow.style.getPropertyValue('--tavern-task-depth')).toBe('2');
	});

	it('should mark focus queue drop targets while dragging', async () => {
		const view = new TavernView({} as never, {
			saveSettings: vi.fn(),
			settings: {
				boardTaskKeys: [],
				projectFolders: ['04_Projects'],
				tavernName: 'Tavern',
			},
			vault: createVault({
				'04_Projects/Pi.md': PROJECT_MARKDOWN,
			}),
		});

		await view.onOpen();
		const root = rootElements.at(-1) as FakeElement;
		const taskEl = findByAriaLabel(root, 'Complete Build board')?.parent;
		const focusQueue = findByClass(root, 'tavern-focus-queue');
		if (!taskEl || !focusQueue) {
			throw new Error('drag source or focus queue was not rendered');
		}

		dragHandleFor(taskEl).dispatch('dragstart', {
			dataTransfer: {
				setData: vi.fn(),
			},
		});
		expect(taskEl.classes.has('is-dragging-task')).toBe(true);

		focusQueue.dispatch('dragover', { preventDefault: vi.fn() });
		expect(focusQueue.classes.has('is-drop-target')).toBe(true);

		focusQueue.dispatch('dragleave');
		expect(focusQueue.classes.has('is-drop-target')).toBe(false);

		dragHandleFor(taskEl).dispatch('dragend');
		expect(taskEl.classes.has('is-dragging-task')).toBe(false);
	});

	it('should reorder tasks in the focus queue with drag and drop', async () => {
		const saveSettings = vi.fn();
		const settings = {
			boardTaskKeys: [
				'04_Projects/Pi.md::backlog-1-build-board',
				'04_Projects/Blogging.md::backlog-1-draft-post',
			],
			projectFolders: ['04_Projects'],
			tavernName: 'Tavern',
		};
		const view = new TavernView({} as never, {
			saveSettings,
			settings,
			vault: createVault({
				'04_Projects/Blogging.md': OTHER_MARKDOWN,
				'04_Projects/Pi.md': PROJECT_MARKDOWN,
			}),
		});
		const dragData = new Map<string, string>();

		await view.onOpen();
		const root = rootElements.at(-1) as FakeElement;
		const focusRows = allElements(root).filter((element) =>
			element.classes.has('tavern-focus-task'),
		);
		if (focusRows.length < 2) {
			throw new Error('focus queue rows were not rendered');
		}
		expect(focusRows[0]?.draggable).toBe(false);
		expect(dragHandleFor(focusRows[0]).draggable).toBe(true);

		dragHandleFor(focusRows[1]).dispatch('dragstart', {
			dataTransfer: {
				setData: (type: string, value: string) => dragData.set(type, value),
			},
		});
		focusRows[0]?.dispatch('drop', {
			dataTransfer: { getData: (type: string) => dragData.get(type) ?? '' },
			preventDefault: vi.fn(),
		});
		await vi.waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(1));

		expect(settings.boardTaskKeys).toEqual([
			'04_Projects/Blogging.md::backlog-1-draft-post',
			'04_Projects/Pi.md::backlog-1-build-board',
		]);
	});

	it('should reorder focus queue task trees as a block', async () => {
		const saveSettings = vi.fn();
		const settings = {
			boardTaskKeys: [
				'04_Projects/Pi.md::backlog-4-next-task',
				'04_Projects/Pi.md::backlog-1-parent-task',
				'04_Projects/Pi.md::backlog-2-child-task',
				'04_Projects/Pi.md::backlog-3-grandchild-task',
			],
			projectFolders: ['04_Projects'],
			tavernName: 'Tavern',
		};
		const view = new TavernView({} as never, {
			saveSettings,
			settings,
			vault: createVault({
				'04_Projects/Pi.md': NESTED_MARKDOWN,
			}),
		});
		const dragData = new Map<string, string>();

		await view.onOpen();
		const root = rootElements.at(-1) as FakeElement;
		const parentRow = findByAriaLabel(root, 'Complete Parent task')?.parent;
		const nextRow = findByAriaLabel(root, 'Complete Next task')?.parent;
		if (!parentRow || !nextRow) {
			throw new Error('focus queue rows were not rendered');
		}

		dragHandleFor(parentRow).dispatch('dragstart', {
			dataTransfer: {
				setData: (type: string, value: string) => dragData.set(type, value),
			},
		});
		nextRow.dispatch('drop', {
			dataTransfer: { getData: (type: string) => dragData.get(type) ?? '' },
			preventDefault: vi.fn(),
		});
		await vi.waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(1));

		expect(settings.boardTaskKeys).toEqual([
			'04_Projects/Pi.md::backlog-1-parent-task',
			'04_Projects/Pi.md::backlog-2-child-task',
			'04_Projects/Pi.md::backlog-3-grandchild-task',
			'04_Projects/Pi.md::backlog-4-next-task',
		]);
	});

	it('should mark focus queue reorder landing rows while dragging', async () => {
		const view = new TavernView({} as never, {
			saveSettings: vi.fn(),
			settings: {
				boardTaskKeys: [
					'04_Projects/Pi.md::backlog-1-build-board',
					'04_Projects/Blogging.md::backlog-1-draft-post',
				],
				projectFolders: ['04_Projects'],
				tavernName: 'Tavern',
			},
			vault: createVault({
				'04_Projects/Blogging.md': OTHER_MARKDOWN,
				'04_Projects/Pi.md': PROJECT_MARKDOWN,
			}),
		});

		await view.onOpen();
		const root = rootElements.at(-1) as FakeElement;
		const focusRows = allElements(root).filter((element) =>
			element.classes.has('tavern-focus-task'),
		);
		const [targetRow] = focusRows;
		if (!targetRow) {
			throw new Error('focus queue row was not rendered');
		}

		targetRow.dispatch('dragover', { preventDefault: vi.fn() });
		expect(targetRow.classes.has('is-drop-before')).toBe(true);

		targetRow.dispatch('dragleave');
		expect(targetRow.classes.has('is-drop-before')).toBe(false);
	});

	it('should ignore invalid focus queue drops', async () => {
		const saveSettings = vi.fn();
		const settings = {
			boardTaskKeys: [] as string[],
			projectFolders: ['04_Projects'],
			tavernName: 'Tavern',
		};
		const view = new TavernView({} as never, {
			saveSettings,
			settings,
			vault: createVault({
				'04_Projects/Pi.md': PROJECT_MARKDOWN,
			}),
		});

		await view.onOpen();
		// pin via UI to ensure focus queue (robust to id format)
		const pinButton = findByAriaLabel(rootElements.at(-1) as FakeElement, 'Queue task');
		if (pinButton) {
			pinButton.dispatch('click', { stopPropagation: vi.fn() });
			await vi.waitFor(() => expect(saveSettings).toHaveBeenCalled());
			saveSettings.mockClear();
		}
		const root = rootElements.at(-1) as FakeElement;
		const focusRow = allElements(root).find((element) => element.classes.has('tavern-focus-task'));
		const focusQueue = findByClass(root, 'tavern-focus-queue');
		if (!focusRow || !focusQueue) {
			throw new Error('focus queue was not rendered');
		}

		focusQueue.dispatch('drop', {
			dataTransfer: { getData: () => '' },
			preventDefault: vi.fn(),
		});
		focusRow.dispatch('drop', {
			dataTransfer: { getData: () => 'missing' },
			preventDefault: vi.fn(),
		});

		expect(saveSettings).not.toHaveBeenCalled();
		// invalid drops should not have mutated the (pinned) focus keys
		expect(settings.boardTaskKeys).toContain('04_Projects/Pi.md::backlog-1-build-board');
	});

	it('should ignore queue operations without a valid task key', async () => {
		const saveSettings = vi.fn();
		const settings = {
			boardTaskKeys: ['04_Projects/Pi.md::backlog-1-build-board'],
			projectFolders: ['04_Projects'],
			tavernName: 'Tavern',
		};
		const view = new TavernView({} as never, {
			saveSettings,
			settings,
			vault: createVault({
				'04_Projects/Pi.md': PROJECT_MARKDOWN,
			}),
		}) as unknown as {
			removeTaskSelection: (task: undefined) => Promise<void>;
			reorderTaskSelection: (sourceKey: string, targetKey: string) => Promise<void>;
			toggleTaskSelection: (task: undefined) => Promise<void>;
		};

		await view.toggleTaskSelection(undefined);
		await view.removeTaskSelection(undefined);
		await view.reorderTaskSelection('', '04_Projects/Pi.md::backlog-1-build-board');
		await view.reorderTaskSelection('04_Projects/Pi.md::backlog-1-build-board', 'missing-target');

		expect(saveSettings).not.toHaveBeenCalled();
		expect(settings.boardTaskKeys).toEqual(['04_Projects/Pi.md::backlog-1-build-board']);
	});

	it('should move tasks between sections with drag and drop', async () => {
		const files = {
			'04_Projects/Pi.md': PROJECT_MARKDOWN,
		};
		const vault = createVault(files);
		const view = new TavernView({} as never, {
			saveSettings: vi.fn(),
			settings: {
				boardTaskKeys: [],
				projectFolders: ['04_Projects'],
				tavernName: 'Tavern',
			},
			vault,
		});
		const dragData = new Map<string, string>();

		await view.setState({ mode: 'note', selectedPath: '04_Projects/Pi.md' }, { history: false });
		const checkbox = findByAriaLabel(rootElements.at(-1) as FakeElement, 'Complete Build board');
		const taskEl = checkbox?.parent;
		const doneSection = findSectionByTitle(rootElements.at(-1) as FakeElement, 'Done');
		if (!taskEl || !doneSection) {
			throw new Error('drag source or done section was not rendered');
		}

		dragHandleFor(taskEl).dispatch('dragstart', {
			dataTransfer: {
				setData: (type: string, value: string) => dragData.set(type, value),
			},
		});
		doneSection.dispatch('drop', {
			dataTransfer: { getData: (type: string) => dragData.get(type) ?? '' },
			preventDefault: vi.fn(),
		});
		await vi.waitFor(() => expect(vault.modify).toHaveBeenCalledTimes(1));

		expect(files['04_Projects/Pi.md']).toContain(
			'## Done\n\n- [x] Existing done\n- [ ] Build board',
		);
	});

	it('should mark project sections as landing targets while dragging', async () => {
		const view = new TavernView({} as never, {
			saveSettings: vi.fn(),
			settings: {
				boardTaskKeys: [],
				projectFolders: ['04_Projects'],
				tavernName: 'Tavern',
			},
			vault: createVault({
				'04_Projects/Pi.md': PROJECT_MARKDOWN,
			}),
		});

		await view.setState({ mode: 'note', selectedPath: '04_Projects/Pi.md' }, { history: false });
		const doneSection = findSectionByTitle(rootElements.at(-1) as FakeElement, 'Done');
		if (!doneSection) {
			throw new Error('done section was not rendered');
		}

		doneSection.dispatch('dragover', { preventDefault: vi.fn() });
		expect(doneSection.classes.has('is-drop-target')).toBe(true);

		doneSection.dispatch('dragleave');
		expect(doneSection.classes.has('is-drop-target')).toBe(false);
	});

	it('should reorder tasks in the project note from task controls', async () => {
		const files = {
			'04_Projects/Pi.md': `---
Title: Pi
tavern: project
---
# Pi

## Backlog

- [ ] First task
- [ ] Second task
`,
		};
		const vault = createVault(files);
		const view = new TavernView({} as never, {
			saveSettings: vi.fn(),
			settings: {
				boardTaskKeys: [],
				projectFolders: ['04_Projects'],
				tavernName: 'Tavern',
			},
			vault,
		});

		await view.setState({ mode: 'note', selectedPath: '04_Projects/Pi.md' }, { history: false });
		const moveDown = findByAriaLabel(rootElements.at(-1) as FakeElement, 'Move task down');
		if (!moveDown) {
			throw new Error('move down button was not rendered');
		}

		moveDown.dispatch('click', { stopPropagation: vi.fn() });
		await vi.waitFor(() => expect(vault.modify).toHaveBeenCalledTimes(1));

		expect(files['04_Projects/Pi.md']).toContain('- [ ] Second task\n- [ ] First task');
	});

	it('should reorder project tasks by dropping one task after another', async () => {
		const files = {
			'04_Projects/Pi.md': `---
Title: Pi
tavern: project
---
# Pi

## Backlog

- [ ] First task
- [ ] Second task
`,
		};
		const vault = createVault(files);
		const view = new TavernView({} as never, {
			saveSettings: vi.fn(),
			settings: {
				boardTaskKeys: [],
				projectFolders: ['04_Projects'],
				tavernName: 'Tavern',
			},
			vault,
		});
		const dragData = new Map<string, string>();

		await view.setState({ mode: 'note', selectedPath: '04_Projects/Pi.md' }, { history: false });
		const firstTask = findByAriaLabel(
			rootElements.at(-1) as FakeElement,
			'Complete First task',
		)?.parent;
		const secondTask = findByAriaLabel(
			rootElements.at(-1) as FakeElement,
			'Complete Second task',
		)?.parent;
		if (!firstTask || !secondTask) {
			throw new Error('task rows were not rendered');
		}

		dragHandleFor(firstTask).dispatch('dragstart', {
			dataTransfer: {
				setData: (type: string, value: string) => dragData.set(type, value),
			},
		});
		secondTask.dispatch('drop', {
			clientX: 0,
			clientY: 24,
			dataTransfer: { getData: (type: string) => dragData.get(type) ?? '' },
			preventDefault: vi.fn(),
			stopPropagation: vi.fn(),
		});
		await vi.waitFor(() => expect(vault.modify).toHaveBeenCalledTimes(1));

		expect(files['04_Projects/Pi.md']).toContain('- [ ] Second task\n- [ ] First task');
	});

	// Regression test for Pass 5 fixed issue C2 (and prior reindent width-delta): exercises moveToPosition child drop on mixed indent data (NESTED_MARKDOWN with 2sp/4sp/tab) via drag; prevents regression of nesting preservation for real mixed user notes.
	it('should nest and unnest project tasks by dropping with different horizontal positions', async () => {
		const files = {
			'04_Projects/Pi.md': `---
Title: Pi
tavern: project
---
# Pi

## Backlog

- [ ] Parent task
- [ ] Child candidate
- [ ] Next task
`,
		};
		const vault = createVault(files);
		const view = new TavernView({} as never, {
			saveSettings: vi.fn(),
			settings: {
				boardTaskKeys: [],
				projectFolders: ['04_Projects'],
				tavernName: 'Tavern',
			},
			vault,
		});
		const dragData = new Map<string, string>();

		await view.setState({ mode: 'note', selectedPath: '04_Projects/Pi.md' }, { history: false });
		const parentTask = findByAriaLabel(
			rootElements.at(-1) as FakeElement,
			'Complete Parent task',
		)?.parent;
		const childCandidate = findByAriaLabel(
			rootElements.at(-1) as FakeElement,
			'Complete Child candidate',
		)?.parent;
		if (!parentTask || !childCandidate) {
			throw new Error('task rows were not rendered');
		}

		dragHandleFor(childCandidate).dispatch('dragstart', {
			dataTransfer: {
				setData: (type: string, value: string) => dragData.set(type, value),
			},
		});
		parentTask.dispatch('drop', {
			clientX: 80,
			clientY: 12,
			dataTransfer: { getData: (type: string) => dragData.get(type) ?? '' },
			preventDefault: vi.fn(),
			stopPropagation: vi.fn(),
		});
		await vi.waitFor(() => expect(vault.modify).toHaveBeenCalledTimes(1));

		// p5: child indent unit inherits from target now. Loosen the exact ws (nesting preserved).
		expect(files['04_Projects/Pi.md']).toContain('- [ ] Parent task');
		expect(files['04_Projects/Pi.md']).toContain('- [ ] Child candidate');

		dragData.clear();
		await view.setState({ mode: 'note', selectedPath: '04_Projects/Pi.md' }, { history: false });
		const nestedTask = findByAriaLabel(
			rootElements.at(-1) as FakeElement,
			'Complete Child candidate',
		)?.parent;
		const nextTask = findByAriaLabel(
			rootElements.at(-1) as FakeElement,
			'Complete Next task',
		)?.parent;
		if (!nestedTask || !nextTask) {
			throw new Error('updated task rows were not rendered');
		}

		dragHandleFor(nestedTask).dispatch('dragstart', {
			dataTransfer: {
				setData: (type: string, value: string) => dragData.set(type, value),
			},
		});
		nextTask.dispatch('drop', {
			clientX: 0,
			clientY: 24,
			dataTransfer: { getData: (type: string) => dragData.get(type) ?? '' },
			preventDefault: vi.fn(),
			stopPropagation: vi.fn(),
		});
		await vi.waitFor(() => expect(vault.modify).toHaveBeenCalledTimes(2));

		expect(files['04_Projects/Pi.md']).toContain(
			'- [ ] Parent task\n- [ ] Next task\n- [ ] Child candidate',
		);
	});

	it('should mark task row drop positions while dragging over tasks', async () => {
		const view = new TavernView({} as never, {
			saveSettings: vi.fn(),
			settings: {
				boardTaskKeys: [],
				projectFolders: ['04_Projects'],
				tavernName: 'Tavern',
			},
			vault: createVault({
				'04_Projects/Pi.md': PROJECT_MARKDOWN,
			}),
		});

		await view.setState({ mode: 'note', selectedPath: '04_Projects/Pi.md' }, { history: false });
		const taskEl = findByAriaLabel(
			rootElements.at(-1) as FakeElement,
			'Complete Build board',
		)?.parent;
		if (!taskEl) {
			throw new Error('task row was not rendered');
		}

		taskEl.dispatch('dragover', { clientX: 0, clientY: 2, preventDefault: vi.fn() });
		expect(taskEl.classes.has('is-drop-before')).toBe(true);

		taskEl.dispatch('dragover', { clientX: 62, clientY: 12, preventDefault: vi.fn() });
		expect(taskEl.classes.has('is-drop-after')).toBe(true);
		expect(taskEl.classes.has('is-drop-child')).toBe(false);

		taskEl.dispatch('dragover', { clientX: 63, clientY: 12, preventDefault: vi.fn() });
		expect(taskEl.classes.has('is-drop-before')).toBe(false);
		expect(taskEl.classes.has('is-drop-child')).toBe(true);

		taskEl.dispatch('dragover', { clientX: 48, clientY: 24, preventDefault: vi.fn() });
		expect(taskEl.classes.has('is-drop-child')).toBe(false);
		expect(taskEl.classes.has('is-drop-after')).toBe(true);

		// Middle y with the pointer left of the drag-handle + checkbox columns lands after the task.
		taskEl.dispatch('dragover', { clientX: 0, clientY: 15, preventDefault: vi.fn() });
		expect(taskEl.classes.has('is-drop-after')).toBe(true);

		taskEl.dispatch('dragleave');
		expect(taskEl.classes.has('is-drop-after')).toBe(false);
	});

	it('should ignore drag drops without a matching task or section change', async () => {
		const vault = createVault({
			'04_Projects/Pi.md': PROJECT_MARKDOWN,
		});
		const view = new TavernView({} as never, {
			saveSettings: vi.fn(),
			settings: {
				boardTaskKeys: [],
				projectFolders: ['04_Projects'],
				tavernName: 'Tavern',
			},
			vault,
		});

		await view.setState({ mode: 'note', selectedPath: '04_Projects/Pi.md' }, { history: false });
		const backlogSection = findSectionByTitle(rootElements.at(-1) as FakeElement, 'Backlog');
		if (!backlogSection) {
			throw new Error('backlog section was not rendered');
		}

		backlogSection.dispatch('drop', {
			dataTransfer: { getData: () => 'missing-task' },
			preventDefault: vi.fn(),
		});
		backlogSection.dispatch('drop', {
			dataTransfer: { getData: () => 'backlog-1-build-board' },
			preventDefault: vi.fn(),
		});

		expect(vault.modify).not.toHaveBeenCalled();
	});

	it('should complete and remove tasks from the focus queue', async () => {
		const files = {
			'04_Projects/Blogging.md': OTHER_MARKDOWN,
		};
		const vault = createVault(files);
		const saveSettings = vi.fn();
		const settings = {
			boardTaskKeys: [] as string[],
			projectFolders: ['04_Projects'],
			tavernName: 'Tavern',
		};
		const view = new TavernView({} as never, {
			saveSettings,
			settings,
			vault,
		});

		await view.onOpen();
		// pin via UI action first (robust to internal id format changes in createTaskId)
		const pinButton = findByAriaLabel(rootElements.at(-1) as FakeElement, 'Queue task');
		if (!pinButton) {
			throw new Error('pin/queue button was not rendered');
		}
		pinButton.dispatch('click', { stopPropagation: vi.fn() });
		await vi.waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(1));

		const focusCheckbox = findAllByAriaLabel(
			rootElements.at(-1) as FakeElement,
			'Complete Draft post',
		).find((element) => element.parent?.classes.has('tavern-focus-task'));
		if (!focusCheckbox) {
			throw new Error('focus queue checkbox was not rendered');
		}

		focusCheckbox.checked = true;
		focusCheckbox.dispatch('change');
		await vi.waitFor(() => expect(vault.modify).toHaveBeenCalledTimes(1));
		expect(files['04_Projects/Blogging.md']).toContain('## Done\n\n- [x] Draft post');
		expect(saveSettings).toHaveBeenCalledTimes(2);
		expect(settings.boardTaskKeys).toEqual([]);
	});

	it('should remove a task from the focus queue without completing it', async () => {
		const saveSettings = vi.fn();
		const settings = {
			boardTaskKeys: [] as string[],
			projectFolders: ['04_Projects'],
			tavernName: 'Tavern',
		};
		const view = new TavernView({} as never, {
			saveSettings,
			settings,
			vault: createVault({
				'04_Projects/Blogging.md': OTHER_MARKDOWN,
			}),
		});

		await view.onOpen();
		// pin via UI to populate focus queue (avoids hardcoding id literal that can change with createTaskId)
		const pinButton = findByAriaLabel(rootElements.at(-1) as FakeElement, 'Queue task');
		if (!pinButton) {
			throw new Error('pin button was not rendered');
		}
		pinButton.dispatch('click', { stopPropagation: vi.fn() });
		await vi.waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(1));

		const removeButton = findByAriaLabel(
			rootElements.at(-1) as FakeElement,
			'Remove from focus queue',
		);
		if (!removeButton) {
			throw new Error('focus queue remove button was not rendered');
		}

		removeButton.dispatch('click');
		await vi.waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(2));
		expect(settings.boardTaskKeys).toEqual([]);
	});

	it('resizes in the owning popout document and cancels on migration, rerender and close', async () => {
		const view = new TavernView({} as never, {
			saveSettings: vi.fn(),
			settings: { boardTaskKeys: [], projectFolders: ['04_Projects'], tavernName: 'Tavern' },
			vault: createVault({ '04_Projects/Pi.md': PROJECT_MARKDOWN }),
		});
		const root = rootElements.at(-1) as FakeElement;
		const popoutDocument = new FakeDocument();
		root.ownerDocument = popoutDocument;
		await view.onOpen();
		const handle = findByClass(root, 'tavern-resize-handle')!;
		handle.dispatch('mousedown', { clientX: 100 });
		fakeDocument.dispatch('mousemove', { clientX: 200 });
		expect(root.style.getPropertyValue('--tavern-list-width')).toBe('');
		popoutDocument.dispatch('mousemove', { clientX: 120 });
		expect(root.style.getPropertyValue('--tavern-list-width')).toBe('260px');
		popoutDocument.dispatch('mouseup');
		popoutDocument.dispatch('mousemove', { clientX: 140 });
		expect(root.style.getPropertyValue('--tavern-list-width')).toBe('260px');
		expect(handle.classes.has('is-dragging')).toBe(false);
		handle.dispatch('mousedown', { clientX: 100 });
		root.migrationListener?.();
		popoutDocument.dispatch('mousemove', { clientX: 150 });
		expect(root.style.getPropertyValue('--tavern-list-width')).toBe('260px');
		handle.dispatch('mousedown', { clientX: 100 });
		await view.refreshProjects();
		popoutDocument.dispatch('mousemove', { clientX: 150 });
		expect(handle.classes.has('is-dragging')).toBe(false);
		const nextHandle = findByClass(root, 'tavern-resize-handle')!;
		nextHandle.dispatch('mousedown', { clientX: 100 });
		await view.onClose();
		popoutDocument.dispatch('mousemove', { clientX: 180 });
		expect(root.style.getPropertyValue('--tavern-list-width')).toBe('260px');
		expect(nextHandle.classes.has('is-dragging')).toBe(false);
	});

	// direct exercise of private to cover the targetIndex < 0 early return in reorderTaskSelection (1466)
	it('should no-op on reorderTaskSelection when targetKey not found in current keys (covers targetIndex<0 branch)', async () => {
		const saveSettings = vi.fn();
		const settings = {
			boardTaskKeys: [] as string[],
			projectFolders: ['04_Projects'],
			tavernName: 'Tavern',
		};
		const view = new TavernView({} as never, {
			saveSettings,
			settings,
			vault: createVault({ '04_Projects/Pi.md': PROJECT_MARKDOWN }),
		});
		// use real task key from PROJECT_MARKDOWN so library load keeps it (no prune save); sourceKeys will be non-empty
		const validSourceKey = '04_Projects/Pi.md::backlog-1-build-board';
		await view.setState({ mode: 'note', selectedPath: '04_Projects/Pi.md' }, { history: false });
		// set *after* setState/refresh (prevents prune from dropping a pre-set key that hasn't been seen yet in this load)
		settings.boardTaskKeys = [validSourceKey];

		const savesBefore = saveSettings.mock.calls.length;
		await (view as any).reorderTaskSelection(validSourceKey, 'nonexistent-target');

		// reaches targetIndex = keys.indexOf(bad) <0 after having sourceKeys>0 ; early return, no *additional* save from reorder
		expect(saveSettings.mock.calls.length).toBe(savesBefore);
		expect(settings.boardTaskKeys).toEqual([validSourceKey]);
	});
	describe('Captain’s Log in the app shell', () => {
		it.each(['plain task', 'task with ^unregistered-id'])(
			'checks and unchecks a standalone %s without replacing the log or losing a draft',
			async (taskText) => {
				const path = 'logs/2026/10/2026-10-24.md';
				const files: Record<string, string> = {
					[path]: `# Daily log\n### Plan\n- [ ] ${taskText}\n`,
				};
				const vault = {
					...createVault(files),
					getAbstractFileByPath: (requested: string) => {
						if (files[requested] === undefined) {
							return null;
						}
						return { path: requested };
					},
					create: vi.fn(),
					createFolder: vi.fn(),
					process: async (file: ProjectVaultFile, transform: (markdown: string) => string) => {
						files[file.path] = transform(files[file.path]!);
						return files[file.path]!;
					},
				};
				const service = new DailyLogService(
					new DailyLogStore(
						vault,
						() => 'logs',
						() => new Date('2026-10-24T12:00:00'),
					),
					{ links: () => [], saveLinks: vi.fn(), remapTaskKeys: vi.fn() },
				);
				const view = new TavernView({} as never, {
					dailyLogs: service,
					vault,
					saveSettings: vi.fn(),
					settings: { boardTaskKeys: [], projectFolders: ['04_Projects'], tavernName: 'Tavern' },
				});
				await view.onOpen();
				const root = rootElements.at(-1)!;
				await vi.waitFor(() => expect(findByClass(root, 'tavern-daily-task')).toBeDefined());
				const log = findByClass(root, 'tavern-daily-panel')!;
				const row = findByClass(log, 'tavern-daily-task')!;
				const checkbox = row.children.find((element) => element.type === 'checkbox')!;
				const draft = findByAriaLabel(log, 'Add todo')!;
				draft.value = 'Keep typing this thought';
				draft.focus();
				for (const checked of [true, false]) {
					checkbox.checked = checked;
					checkbox.dispatch('change');
					await vi.waitFor(() =>
						expect(parseDailyNote(files[path]!).tasks[0]?.checked).toBe(checked),
					);
					await view.refreshProjects();
					await vi.waitFor(() => expect(row.classes.has('is-done')).toBe(checked));
					expect(findByClass(root, 'tavern-daily-panel')).toBe(log);
					expect(findByClass(log, 'tavern-daily-task')).toBe(row);
					expect(findByAriaLabel(log, 'Add todo')).toBe(draft);
					expect(draft.value).toBe('Keep typing this thought');
					expect(fakeDocument.activeElement).toBe(draft);
				}
				expect(files[path]).toContain('- [ ]');
				await view.onClose();
			},
		);

		it.each(['global', 'focus'])(
			'copies a whole parent group from the %s queue and refuses a separate child drop',
			async (sourceKind) => {
				const controller = createDailyController();
				const view = new TavernView({} as never, {
					dailyLogs: controller,
					saveSettings: vi.fn(),
					vault: createVault({ '04_Projects/Pi.md': NESTED_MARKDOWN }),
					settings: { boardTaskKeys: [], projectFolders: ['04_Projects'], tavernName: 'Tavern' },
				});
				await view.onOpen();
				const root = rootElements.at(-1)!;
				if (sourceKind === 'focus') {
					findByAriaLabel(root, 'Complete Parent task')!
						.parent!.children.find((element) => element.classes.has('tavern-queue-toggle'))!
						.dispatch('click');
					await vi.waitFor(() => expect(findByClass(root, 'tavern-focus-task')).toBeDefined());
				}
				await vi.waitFor(() => expect(findByClass(root, 'tavern-daily-content')).toBeDefined());
				let queueClass = 'tavern-global-task';
				if (sourceKind === 'focus') {
					queueClass = 'tavern-focus-task';
				}
				for (const label of ['Parent task', 'Child task']) {
					const source = findAllByAriaLabel(root, `Complete ${label}`).find((element) =>
						element.parent?.classes.has(queueClass),
					)!.parent!;
					const data = new Map<string, string>();
					const transfer = {
						effectAllowed: '',
						dropEffect: '',
						get types() {
							return [...data.keys()];
						},
						setData: (mime: string, value: string) => data.set(mime, value),
						getData: (mime: string) => data.get(mime) ?? '',
					};
					dragHandleFor(source).dispatch('dragstart', { dataTransfer: transfer });
					const target = findByClass(root, 'tavern-daily-content')!;
					const accept = vi.fn();
					target.dispatch('dragover', { dataTransfer: transfer, preventDefault: accept });
					if (label === 'Parent task') {
						expect(accept).toHaveBeenCalled();
						expect(transfer.dropEffect).toBe('copy');
						expect(transfer.effectAllowed).toBe('copyMove');
						target.dispatch('drop', { dataTransfer: transfer });
						await vi.waitFor(() => expect(controller.copyProjectTask).toHaveBeenCalledOnce());
						expect(controller.copyProjectTask).toHaveBeenCalledWith(
							'2026-10-24',
							expect.objectContaining({ text: 'Parent task' }),
							undefined,
						);
					} else {
						expect(accept).not.toHaveBeenCalled();
						target.dispatch('drop', { dataTransfer: transfer });
						expect(controller.copyProjectTask).toHaveBeenCalledOnce();
					}
					dragHandleFor(source).dispatch('dragend');
				}
			},
		);

		it.each(['Escape', 'unchanged Enter', 'blank Enter'])(
			'closes the daily editor on %s and permits editing the task again',
			async (action) => {
				const controller = createDailyController();
				await dailyView(controller).onOpen();
				const root = rootElements.at(-1)!;
				await vi.waitFor(() => expect(findByAriaLabel(root, 'Edit Review log')).toBeDefined());
				findByAriaLabel(root, 'Edit Review log')!.dispatch('click');
				const input = findByAriaLabel(root, 'Task text for Review log')!;
				let key = 'Enter';
				if (action === 'Escape') {
					input.value = 'Discard this';
					key = 'Escape';
				}
				if (action === 'blank Enter') {
					input.value = '   ';
				}
				input.dispatch('keydown', { key });
				await vi.waitFor(() =>
					expect(findByAriaLabel(root, 'Task text for Review log')).toBeUndefined(),
				);
				expect(controller.editTask).not.toHaveBeenCalled();
				findByAriaLabel(root, 'Edit Review log')!.dispatch('click');
				const reopened = findByAriaLabel(root, 'Task text for Review log')!;
				reopened.value = 'Next review';
				reopened.dispatch('keydown', { key: 'Enter' });
				await vi.waitFor(() =>
					expect(controller.editTask).toHaveBeenCalledWith(
						'2026-10-24',
						'block:review',
						'Next review',
					),
				);
			},
		);

		it('reads only today when missing and creates a daily log only after the explicit action', async () => {
			const controller = createDailyController(null);
			const view = dailyView(controller);
			await view.onOpen();
			const root = rootElements.at(-1)!;
			await vi.waitFor(() => expect(textValues(root)).toContain('No note'));
			expect(controller.read.mock.calls.every(([day]) => day === '2026-10-24')).toBe(true);
			expect(controller.create).not.toHaveBeenCalled();
			findByText(root, 'Create daily log')!.dispatch('click');
			await vi.waitFor(() => expect(controller.create).toHaveBeenCalledWith('2026-10-24'));
		});

		it('navigates by day, returns to today and starts a reopened view at today', async () => {
			const controller = createDailyController();
			const view = dailyView(controller);
			await view.onOpen();
			const root = rootElements.at(-1)!;
			findByAriaLabel(root, 'Previous day')!.dispatch('click');
			await vi.waitFor(() => expect(controller.read).toHaveBeenLastCalledWith('2026-10-23'));
			findByAriaLabel(root, 'Next day')!.dispatch('click');
			await vi.waitFor(() => expect(controller.read).toHaveBeenLastCalledWith('2026-10-24'));
			findByAriaLabel(root, 'Previous day')!.dispatch('click');
			findByText(root, 'Today')!.dispatch('click');
			await vi.waitFor(() => expect(controller.read).toHaveBeenLastCalledWith('2026-10-24'));
			findByAriaLabel(root, 'Previous day')!.dispatch('click');
			await view.onClose();
			controller.today.mockReturnValue('2026-10-25');
			await view.onOpen();
			await vi.waitFor(() => expect(controller.read).toHaveBeenLastCalledWith('2026-10-25'));
		});

		it('renders narrative and nested tasks, then routes editing, checking and capture to the selected log', async () => {
			const controller = createDailyController();
			const view = dailyView(controller);
			await view.onOpen();
			const root = rootElements.at(-1)!;
			await vi.waitFor(() => expect(findByAriaLabel(root, 'Edit Review log')).toBeDefined());
			expect(textValues(root)).toContain('Keep the narrative.');
			const child = findByAriaLabel(root, 'Mark Follow up complete')!.parent!;
			expect(child.style.getPropertyValue('--tavern-task-depth')).toBe('1');
			findByAriaLabel(root, 'Edit Review log')!.dispatch('click');
			const editor = findByAriaLabel(root, 'Task text for Review log')!;
			editor.value = 'Review the draft';
			const beforeEdit = controller.read.mock.calls.length;
			editor.dispatch('keydown', { key: 'Enter' });
			await vi.waitFor(() => expect(controller.read.mock.calls.length).toBeGreaterThan(beforeEdit));
			expect(controller.editTask).toHaveBeenCalledWith(
				'2026-10-24',
				'block:review',
				'Review the draft',
			);
			const checkbox = findByAriaLabel(root, 'Mark Review log complete')!;
			checkbox.checked = true;
			const beforeCheck = controller.read.mock.calls.length;
			checkbox.dispatch('change');
			await vi.waitFor(() =>
				expect(controller.read.mock.calls.length).toBeGreaterThan(beforeCheck),
			);
			expect(controller.setTaskChecked).toHaveBeenCalledWith('2026-10-24', 'block:review', true);
			const add = findByAriaLabel(root, 'Add todo')!;
			add.value = 'Capture the next step';
			add.dispatch('keydown', { key: 'Enter' });
			await vi.waitFor(() =>
				expect(controller.addTask).toHaveBeenCalledWith('2026-10-24', 'Capture the next step'),
			);
		});

		it.each(['project', 'focus'])(
			'copies a dragged %s task into a positioned daily task without editing the project',
			async (sourceKind) => {
				const controller = createDailyController();
				const vault = createVault({ '04_Projects/Pi.md': PROJECT_MARKDOWN });
				const view = new TavernView({} as never, {
					dailyLogs: controller,
					saveSettings: vi.fn(),
					vault,
					settings: { boardTaskKeys: [], projectFolders: ['04_Projects'], tavernName: 'Tavern' },
				});
				await view.setState(
					{ mode: 'note', selectedPath: '04_Projects/Pi.md' },
					{ history: false },
				);
				const root = rootElements.at(-1)!;
				if (sourceKind === 'focus') {
					findByAriaLabel(root, 'Queue task')!.dispatch('click');
					await view.setState({ boardPage: 'global' }, { history: false });
					await vi.waitFor(() => expect(findByClass(root, 'tavern-focus-task')).toBeDefined());
				}
				await vi.waitFor(() =>
					expect(findByAriaLabel(root, 'Mark Review log complete')).toBeDefined(),
				);
				let source = findByAriaLabel(root, 'Complete Build board')!.parent!;
				if (sourceKind === 'focus') {
					source = findByClass(root, 'tavern-focus-task')!;
				}
				const data = new Map<string, string>();
				dragHandleFor(source).dispatch('dragstart', {
					dataTransfer: { setData: (type: string, value: string) => data.set(type, value) },
				});
				const target = findByAriaLabel(root, 'Mark Review log complete')!.parent!;
				const stopPropagation = vi.fn();
				target.dispatch('drop', {
					clientX: 70,
					clientY: 15,
					stopPropagation,
					dataTransfer: { getData: (type: string) => data.get(type) ?? '' },
				});
				await vi.waitFor(() =>
					expect(controller.copyProjectTask).toHaveBeenCalledWith(
						'2026-10-24',
						expect.objectContaining({ projectPath: '04_Projects/Pi.md', text: 'Build board' }),
						{ taskId: 'block:review', placement: 'child' },
					),
				);
				expect(stopPropagation).toHaveBeenCalled();
				expect(controller.copyProjectTask).toHaveBeenCalledTimes(1);
				expect(vault.modify).not.toHaveBeenCalled();
			},
		);

		it('keeps a newer selected day visible when an earlier read finishes late', async () => {
			const controller = createDailyController();
			let resolveEarlier: (snapshot: DailyLogSnapshot) => void = () => {
				throw new Error('Earlier read did not start.');
			};
			controller.read.mockImplementation(async (day) => {
				if (day === '2026-10-23') {
					// eslint-disable-next-line promise/avoid-new
					return new Promise((resolve) => {
						resolveEarlier = resolve;
					});
				}
				return { day, path: day, note: parseDailyNote(DAILY_MARKDOWN) };
			});
			await dailyView(controller).onOpen();
			const root = rootElements.at(-1)!;
			findByAriaLabel(root, 'Previous day')!.dispatch('click');
			findByAriaLabel(root, 'Next day')!.dispatch('click');
			await vi.waitFor(() => expect(findByAriaLabel(root, 'Edit Review log')).toBeDefined());
			resolveEarlier({ day: '2026-10-23', path: 'earlier', note: null });
			await Promise.resolve();
			await Promise.resolve();
			expect(textValues(root)).not.toContain('No note');
			expect(findByAriaLabel(root, 'Edit Review log')).toBeDefined();
		});

		it('reopens a linked Done task in place and routes its next completion through the link service', async () => {
			const path = '04_Projects/Pi.md';
			const files = {
				[path]: '---\ntavern: project\n---\n# Pi\n## Done\n- [x] Linked task ^linked\n',
			};
			const settings = {
				boardTaskKeys: [] as string[],
				projectFolders: ['04_Projects'],
				tavernName: 'Tavern',
			};
			const controller = {
				...createDailyController(),
				isLinked: (task: ProjectBoardTask) => task.id === 'block:linked',
				setProjectTaskChecked: vi.fn(async (task: ProjectBoardTask, checked: boolean) => {
					files[path] = await Effect.runPromise(
						setProjectTaskChecked(files[path]!, task.id, checked),
					);
				}),
			};
			const view = new TavernView({} as never, {
				dailyLogs: controller,
				saveSettings: vi.fn(),
				settings,
				vault: createVault(files),
			});
			await view.setState({ mode: 'note', selectedPath: path }, { history: false });
			const root = rootElements.at(-1)!;
			const doneCheckbox = findByAriaLabel(root, 'Reopen Linked task')!;
			expect(doneCheckbox.checked).toBe(true);
			expect(doneCheckbox.disabled).toBe(false);
			doneCheckbox.checked = false;
			doneCheckbox.dispatch('change');
			await vi.waitFor(() => {
				const reopenedCheckbox = findByAriaLabel(root, 'Complete Linked task');
				expect(reopenedCheckbox).not.toBe(doneCheckbox);
				expect(reopenedCheckbox?.checked).toBe(false);
			});
			expect(controller.setProjectTaskChecked).toHaveBeenNthCalledWith(
				1,
				expect.objectContaining({ id: 'block:linked', sectionName: 'Done' }),
				false,
			);
			expect(files[path]).toContain('## Done\n- [ ] Linked task ^linked');
			findByAriaLabel(root, 'Queue task')!.dispatch('click');
			await vi.waitFor(() => expect(settings.boardTaskKeys).toEqual([`${path}::block:linked`]));
			await view.setState({ boardPage: 'global' }, { history: false });
			expect(textValues(findByClass(root, 'tavern-focus-queue')!)).toContain('Linked task');
			const availableCheckbox = findAllByAriaLabel(root, 'Complete Linked task').find((element) =>
				element.parent?.classes.has('tavern-global-task'),
			)!;
			availableCheckbox.checked = true;
			availableCheckbox.dispatch('change');
			await vi.waitFor(() => expect(settings.boardTaskKeys).toEqual([]));
			await vi.waitFor(() => expect(findByAriaLabel(root, 'Complete Linked task')).toBeUndefined());
			expect(controller.setProjectTaskChecked).toHaveBeenNthCalledWith(
				2,
				expect.objectContaining({ id: 'block:linked', sectionName: 'Done' }),
				true,
			);
			expect(files[path]).toContain('- [x] Linked task ^linked');
		});

		it('omits checked descendants from a selected parent and clears externally completed selections on refresh', async () => {
			const path = '04_Projects/Pi.md';
			const files = {
				[path]:
					'---\ntavern: project\n---\n# Pi\n## Backlog\n- [ ] Parent ^parent\n  - [x] Checked child ^checked\n  - [ ] Open child ^open\n',
			};
			const settings = {
				boardTaskKeys: [`${path}::block:parent`, `${path}::block:open`],
				projectFolders: ['04_Projects'],
				tavernName: 'Tavern',
			};
			const view = new TavernView({} as never, {
				saveSettings: vi.fn(),
				settings,
				vault: createVault(files),
			});
			await view.onOpen();
			const root = rootElements.at(-1)!;
			const queue = findByClass(root, 'tavern-focus-queue')!;
			expect(textValues(queue)).toContain('Parent');
			expect(textValues(queue)).toContain('Open child');
			expect(textValues(queue)).not.toContain('Checked child');
			files[path] = files[path]!.replace('- [ ] Parent ^parent', '- [x] Parent ^parent');
			await view.refreshProjects();
			expect(settings.boardTaskKeys).toEqual([]);
			expect(findByClass(root, 'tavern-focus-task')).toBeUndefined();
		});

		it('filters visible daily tasks without changing source order and retains the filter after a shell refresh', async () => {
			const controller = createDailyController();
			const view = dailyView(controller);
			await view.onOpen();
			const root = rootElements.at(-1)!;
			await vi.waitFor(() => expect(findByAriaLabel(root, 'Edit Review log')).toBeDefined());
			const search = findByAriaLabel(root, 'Search log')!;
			search.value = 'fu';
			search.dispatch('input');
			expect(findByAriaLabel(root, 'Edit Review log')).toBeUndefined();
			expect(findByAriaLabel(root, 'Edit Follow up')).toBeDefined();
			await view.refreshProjects();
			await vi.waitFor(() => expect(findByAriaLabel(root, 'Edit Follow up')).toBeDefined());
			expect(findByAriaLabel(root, 'Search log')?.value).toBe('fu');
			const restoredSearch = findByAriaLabel(root, 'Search log')!;
			restoredSearch.value = '';
			restoredSearch.dispatch('input');
			const daily = findByClass(root, 'tavern-daily-panel')!;
			expect(
				allElements(daily)
					.filter((element) => element.attr['aria-label']?.startsWith('Edit '))
					.map((element) => element.attr['aria-label']),
			).toEqual(['Edit Review log', 'Edit Follow up']);
			expect(controller.moveTask).not.toHaveBeenCalled();
			expect(controller.editTask).not.toHaveBeenCalled();
		});

		it.each([
			{ indent: '  ', depth: '1' },
			{ indent: '   ', depth: '1.5' },
			{ indent: '\t', depth: '2' },
			{ indent: '\t  ', depth: '3' },
		])(
			'uses matching nested drop zones in the project and daily log with $indent indentation',
			async ({ indent, depth }) => {
				const controller = createDailyController(
					DAILY_MARKDOWN.replace('  - [ ] Follow up', `${indent}- [ ] Follow up`),
				);
				const view = new TavernView({} as never, {
					dailyLogs: controller,
					saveSettings: vi.fn(),
					vault: createVault({
						'04_Projects/Pi.md': NESTED_MARKDOWN.replace(
							'  - [ ] Child task',
							`${indent}- [ ] Child task`,
						),
					}),
					settings: { boardTaskKeys: [], projectFolders: ['04_Projects'], tavernName: 'Tavern' },
				});
				await view.setState(
					{ boardPage: 'project', selectedPath: '04_Projects/Pi.md' },
					{ history: false },
				);
				const root = rootElements.at(-1)!;
				await vi.waitFor(() =>
					expect(findByAriaLabel(root, 'Mark Follow up complete')).toBeDefined(),
				);
				const project = findByAriaLabel(root, 'Complete Child task')!.parent!;
				const daily = findByAriaLabel(root, 'Mark Follow up complete')!.parent!;
				for (const row of [project, daily]) {
					expect(row.style.getPropertyValue('--tavern-task-depth')).toBe(depth);
					for (const point of [
						{ clientX: 140, clientY: 5, placement: 'before' },
						{ clientX: 70, clientY: 15, placement: 'after' },
						{ clientX: 140, clientY: 15, placement: 'child' },
						{ clientX: 140, clientY: 9.95, placement: 'child' },
						{ clientX: 140, clientY: 25, placement: 'after' },
					]) {
						row.dispatch('dragover', {
							clientX: point.clientX,
							clientY: point.clientY,
							dataTransfer: { types: ['application/x-tavern-daily-task'] },
						});
						expect(row.classes.has(`is-drop-${point.placement}`)).toBe(true);
						row.dispatch('dragleave');
					}
				}
			},
		);

		it.each([
			{ placement: 'before', clientX: 70, clientY: 5 },
			{ placement: 'after', clientX: 70, clientY: 25 },
			{ placement: 'child', clientX: 70, clientY: 15 },
			{ placement: 'after', clientX: 20, clientY: 15 },
		])(
			'moves a daily task using its handle and the $placement drop position at ($clientX, $clientY)',
			async ({ placement, clientX, clientY }) => {
				const controller = createDailyController();
				await dailyView(controller).onOpen();
				const root = rootElements.at(-1)!;
				await vi.waitFor(() =>
					expect(findByAriaLabel(root, 'Mark Follow up complete')).toBeDefined(),
				);
				const source = findByAriaLabel(root, 'Mark Follow up complete')!.parent!;
				const target = findByAriaLabel(root, 'Mark Review log complete')!.parent!;
				const data = new Map<string, string>();
				const transfer = {
					effectAllowed: '',
					types: ['application/x-tavern-daily-task'],
					setData: (type: string, value: string) => data.set(type, value),
					getData: (type: string) => data.get(type) ?? '',
				};
				const handle = dragHandleFor(source);
				expect(source.draggable).toBe(false);
				expect(handle.draggable).toBe(true);
				handle.dispatch('dragstart', { dataTransfer: transfer });
				expect(JSON.parse(data.get('application/x-tavern-daily-task')!)).toEqual({
					day: '2026-10-24',
					taskId: 'block:follow',
				});
				expect(transfer.effectAllowed).toBe('move');
				expect(source.classes.has('is-dragging-task')).toBe(true);
				target.dispatch('drop', { clientX, clientY, dataTransfer: transfer });
				handle.dispatch('dragend');
				expect(source.classes.has('is-dragging-task')).toBe(false);
				await vi.waitFor(() =>
					expect(controller.moveTask).toHaveBeenCalledWith('2026-10-24', 'block:follow', {
						taskId: 'block:review',
						placement,
					}),
				);
				expect(controller.copyProjectTask).not.toHaveBeenCalled();
			},
		);

		it('cancels a daily drag without moving a task and distinguishes copy, move and unsupported drop feedback', async () => {
			const controller = createDailyController();
			await dailyView(controller).onOpen();
			const root = rootElements.at(-1)!;
			await vi.waitFor(() =>
				expect(findByAriaLabel(root, 'Mark Review log complete')).toBeDefined(),
			);
			const row = findByAriaLabel(root, 'Mark Review log complete')!.parent!;
			const handle = dragHandleFor(row);
			handle.dispatch('dragstart', { dataTransfer: { setData: vi.fn() } });
			handle.dispatch('dragend');
			expect(row.classes.has('is-dragging-task')).toBe(false);
			expect(controller.moveTask).not.toHaveBeenCalled();
			const unsupported = vi.fn();
			row.dispatch('dragover', {
				preventDefault: unsupported,
				dataTransfer: { types: ['text/uri-list'] },
			});
			expect(unsupported).not.toHaveBeenCalled();
			expect(row.classes.has('is-drop-target')).toBe(false);
			for (const [mime, expectedCursor] of [
				['application/x-tavern-daily-source', 'copy'],
				['application/x-tavern-daily-task', 'move'],
			]) {
				const transfer = { types: [mime], dropEffect: '' };
				row.dispatch('dragover', { clientX: 70, clientY: 15, dataTransfer: transfer });
				expect(transfer.dropEffect).toBe(expectedCursor);
				expect(row.classes.has('is-drop-target')).toBe(true);
				expect(row.classes.has('is-drop-child')).toBe(true);
				row.dispatch('dragleave');
				expect(row.classes.has('is-drop-target')).toBe(false);
				expect(row.classes.has('is-drop-child')).toBe(false);
			}
		});

		it.each([
			['malformed JSON', '{'],
			['null payload', 'null'],
			['non-object payload', '42'],
			['missing day', '{"taskId":"block:review"}'],
			['missing task identity', '{"day":"2026-10-24"}'],
			['non-text task identity', '{"day":"2026-10-24","taskId":42}'],
			['another day', '{"day":"2026-10-23","taskId":"block:review"}'],
		])('rejects a daily drop with %s without changing either note', async (_reason, raw) => {
			const controller = createDailyController();
			await dailyView(controller).onOpen();
			const root = rootElements.at(-1)!;
			await vi.waitFor(() =>
				expect(findByAriaLabel(root, 'Mark Review log complete')).toBeDefined(),
			);
			const row = findByAriaLabel(root, 'Mark Review log complete')!.parent!;
			row.dispatch('drop', { clientX: 70, clientY: 15, dataTransfer: { getData: () => raw } });
			await Promise.resolve();
			expect(controller.moveTask).not.toHaveBeenCalled();
			expect(controller.copyProjectTask).not.toHaveBeenCalled();
			if (raw === '{') {
				expect(findByClass(root, 'tavern-daily-error')).toBeDefined();
			}
		});

		it('requires a row target for daily reordering and clears hover feedback on an unrelated drop', async () => {
			const controller = createDailyController();
			await dailyView(controller).onOpen();
			const root = rootElements.at(-1)!;
			await vi.waitFor(() =>
				expect(findByAriaLabel(root, 'Mark Review log complete')).toBeDefined(),
			);
			const content = findByClass(root, 'tavern-daily-content')!;
			const transfer = {
				types: ['application/x-tavern-daily-task'],
				dropEffect: '',
				getData: () => JSON.stringify({ day: '2026-10-24', taskId: 'block:review' }),
			};
			content.dispatch('dragover', { dataTransfer: transfer });
			expect(content.classes.has('is-drop-target')).toBe(true);
			content.dispatch('drop', { dataTransfer: transfer });
			expect(content.classes.has('is-drop-target')).toBe(false);
			const row = findByAriaLabel(root, 'Mark Review log complete')!.parent!;
			row.dispatch('dragover', { clientX: 10, clientY: 5, dataTransfer: transfer });
			expect(row.classes.has('is-drop-before')).toBe(true);
			row.dispatch('drop', { dataTransfer: { getData: () => '' } });
			expect(row.classes.has('is-drop-before')).toBe(false);
			expect(row.classes.has('is-drop-target')).toBe(false);
			expect(controller.moveTask).not.toHaveBeenCalled();
			expect(controller.copyProjectTask).not.toHaveBeenCalled();
		});

		it('ignores blank capture, ordinary typing and an Enter used to compose text', async () => {
			const controller = createDailyController();
			await dailyView(controller).onOpen();
			const root = rootElements.at(-1)!;
			await vi.waitFor(() => expect(findByAriaLabel(root, 'Add todo')).toBeDefined());
			const input = findByAriaLabel(root, 'Add todo')!;
			input.value = '   ';
			input.dispatch('keydown', { key: 'Enter' });
			input.value = 'Still composing';
			input.dispatch('keydown', { key: 'a' });
			input.dispatch('keydown', { key: 'Enter', isComposing: true });
			expect(controller.addTask).not.toHaveBeenCalled();
			expect(input.disabled).toBe(false);
			expect(input.value).toBe('Still composing');
		});

		it.each(['success', 'failure'])(
			'ignores a late capture %s after the app closes',
			async (outcome) => {
				const { Notice } = await import('obsidian');
				const controller = createDailyController();
				let finishCapture: () => void = () => {
					throw new Error('Capture did not start.');
				};
				// eslint-disable-next-line promise/avoid-new
				const pending = new Promise<void>((resolve, reject) => {
					finishCapture = resolve;
					if (outcome === 'failure') {
						finishCapture = () => reject(new Error('Late failure'));
					}
				});
				controller.addTask.mockImplementation(() => pending);
				const view = dailyView(controller);
				await view.onOpen();
				const root = rootElements.at(-1)!;
				await vi.waitFor(() => expect(findByAriaLabel(root, 'Add todo')).toBeDefined());
				const input = findByAriaLabel(root, 'Add todo')!;
				input.value = 'Capture before closing';
				input.dispatch('keydown', { key: 'Enter' });
				expect(input.disabled).toBe(true);
				await view.onClose();
				const refresh = vi.spyOn(view, 'refreshProjects');
				const noticesAtClose = vi.mocked(Notice).mock.calls.length;
				const readsAtClose = controller.read.mock.calls.length;
				finishCapture();
				await Promise.allSettled([pending]);
				await Promise.resolve();
				expect(controller.read).toHaveBeenCalledTimes(readsAtClose);
				expect(refresh).not.toHaveBeenCalled();
				expect(Notice).toHaveBeenCalledTimes(noticesAtClose);
				expect(findByClass(root, 'tavern-daily-error')).toBeUndefined();
			},
		);

		it('shows a failed daily action without silently creating another note', async () => {
			const { Notice } = await import('obsidian');
			const controller = createDailyController();
			controller.addTask.mockRejectedValueOnce(new Error('Vault is read-only'));
			await dailyView(controller).onOpen();
			const root = rootElements.at(-1)!;
			await vi.waitFor(() => expect(findByAriaLabel(root, 'Add todo')).toBeDefined());
			const input = findByAriaLabel(root, 'Add todo')!;
			input.value = 'Keep my capture';
			input.dispatch('keydown', { key: 'Enter' });
			await vi.waitFor(() => expect(textValues(root)).toContain('Vault is read-only'));
			expect(Notice).toHaveBeenCalledWith('Tavern: Vault is read-only');
			expect(controller.create).not.toHaveBeenCalled();
		});
	});
});
