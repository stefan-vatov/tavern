/* eslint-disable eslint/max-classes-per-file, eslint/max-lines, eslint/max-statements, eslint/no-magic-numbers, promise/prefer-await-to-callbacks, @typescript-eslint/no-explicit-any */
import { beforeEach, vi } from 'vitest';
import { TavernView } from '../src/view';
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
	body = new FakeElement('body');
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
	ItemView: class {
		app: { keymap: typeof keymapMock; scope: unknown };
		contentEl: FakeElement;

		constructor() {
			this.app = { keymap: keymapMock, scope: { id: 'app-scope' } };
			this.contentEl = new FakeElement('root');
			rootElements.push(this.contentEl);
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

const findByClass = (root: FakeElement, className: string): FakeElement | undefined =>
	allElements(root).find((element) => element.classes.has(className));

const findByText = (root: FakeElement, text: string): FakeElement | undefined =>
	allElements(root).find((element) => element.text === text);

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
		expect(view.getDisplayText()).toBe('Tavern projects');
		expect(view.getIcon()).toBe('dice');
		expect(view.getState()).toEqual({
			availableTasksCollapsed: false,
			boardPage: 'global',
			globalTaskQuery: '',
			mode: 'board',
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

		expect(textValues(rootElements.at(-1) as FakeElement)).toContain(
			'Tavern could not load project notes.',
		);
	});

	it('should render projects, focus queue, and selected project sections', async () => {
		const vault = createVault({
			'04_Projects/Blogging.md': OTHER_MARKDOWN,
			'04_Projects/Pi.md': PROJECT_MARKDOWN,
		});
		const view = new TavernView({} as never, {
			saveSettings: vi.fn(),
			settings: {
				boardTaskKeys: ['04_Projects/Blogging.md::0::Backlog::Draft post'],
				projectFolders: ['04_Projects'],
				tavernName: 'Tavern',
			},
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

		const globalTitle = findByText(root, 'Global queue');
		if (!globalTitle?.parent?.parent) {
			throw new Error('global queue card was not rendered');
		}

		globalTitle.parent.parent.dispatch('click');

		expect(textValues(root)).toContain('Global work queue');
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

	it('should render a selected project note without the global project list in note mode', async () => {
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

		await view.setState({ mode: 'note', selectedPath: '04_Projects/Pi.md' }, { history: false });
		const root = rootElements.at(-1) as FakeElement;

		expect(findByClass(root, 'tavern-panel-list')).toBeUndefined();
		expect(findByClass(root, 'tavern-note-mode')).toBeDefined();
		expect(textValues(root)).toEqual(expect.arrayContaining(['Pi', 'Backlog', 'Build board']));
		expect(textValues(root)).not.toContain('Blogging');
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
		expect(tabRow?.style.getPropertyValue('--tavern-task-depth')).toBe('1');
		expect(mixedRow?.style.getPropertyValue('--tavern-task-depth')).toBe('2');
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
		expect(textValues(overlay)).not.toContain('Projects');
		expect(textValues(overlay)).not.toContain('Build board');
		expect(textValues(root)).toContain('Pi');
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
		expect(textValues(root)).toContain('Draft post');
		expect(textValues(root)).not.toContain('Build board');
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

		expect(findByClass(root, 'tavern-panel-list')).toBeUndefined();
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

	it('should edit project task text inline without taking over row dragging', async () => {
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

		editLabel.dispatch('dblclick', { preventDefault: vi.fn(), stopPropagation: vi.fn() });
		const editor = findByAriaLabel(root, 'Task text for Build board');
		if (!editor) {
			throw new Error('task edit input was not rendered');
		}
		const stopDrag = vi.fn();

		editor.dispatch('dragstart', { stopPropagation: stopDrag });
		editor.value = 'Build inline editor';
		editor.dispatch('keydown', {
			key: 'Enter',
			preventDefault: vi.fn(),
			stopPropagation: vi.fn(),
		});
		await vi.waitFor(() => expect(vault.modify).toHaveBeenCalledTimes(1));

		expect(stopDrag).toHaveBeenCalledTimes(1);
		expect(files['04_Projects/Pi.md']).toContain('- [ ] Build inline editor');
		expect(files['04_Projects/Pi.md']).not.toContain('- [ ] Build board');
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

		editLabel.dispatch('dblclick', { preventDefault: vi.fn(), stopPropagation: vi.fn() });
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
		const toggleButton = findByAriaLabel(root, 'Toggle available tasks');
		if (!toggleButton) {
			throw new Error('available task toggle was not rendered');
		}

		expect(textValues(root)).toContain('Build board');

		toggleButton.dispatch('click');

		expect(textValues(root)).not.toContain('Build board');
		expect(view.getState()).toEqual(
			expect.objectContaining({
				availableTasksCollapsed: true,
			}),
		);

		const nextToggleButton = findByAriaLabel(root, 'Toggle available tasks');
		nextToggleButton?.dispatch('click');

		expect(textValues(root)).toContain('Build board');
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

		taskEl.dispatch('dragstart', {
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

		taskEl.dispatch('dragstart', {
			dataTransfer: {
				setData: vi.fn(),
			},
		});
		expect(taskEl.classes.has('is-dragging-task')).toBe(true);

		focusQueue.dispatch('dragover', { preventDefault: vi.fn() });
		expect(focusQueue.classes.has('is-drop-target')).toBe(true);

		focusQueue.dispatch('dragleave');
		expect(focusQueue.classes.has('is-drop-target')).toBe(false);

		taskEl.dispatch('dragend');
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

		focusRows[1]?.dispatch('dragstart', {
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

		await view.onOpen();
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
		expect(settings.boardTaskKeys).toEqual(['04_Projects/Pi.md::backlog-1-build-board']);
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

		taskEl.dispatch('dragstart', {
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

		firstTask.dispatch('dragstart', {
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

		childCandidate.dispatch('dragstart', {
			dataTransfer: {
				setData: (type: string, value: string) => dragData.set(type, value),
			},
		});
		parentTask.dispatch('drop', {
			clientX: 48,
			clientY: 12,
			dataTransfer: { getData: (type: string) => dragData.get(type) ?? '' },
			preventDefault: vi.fn(),
			stopPropagation: vi.fn(),
		});
		await vi.waitFor(() => expect(vault.modify).toHaveBeenCalledTimes(1));

		expect(files['04_Projects/Pi.md']).toContain('- [ ] Parent task\n\t- [ ] Child candidate');

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

		nestedTask.dispatch('dragstart', {
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

		taskEl.dispatch('dragover', { clientX: 48, clientY: 12, preventDefault: vi.fn() });
		expect(taskEl.classes.has('is-drop-before')).toBe(false);
		expect(taskEl.classes.has('is-drop-child')).toBe(true);

		taskEl.dispatch('dragover', { clientX: 48, clientY: 24, preventDefault: vi.fn() });
		expect(taskEl.classes.has('is-drop-child')).toBe(false);
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
			boardTaskKeys: ['04_Projects/Blogging.md::backlog-1-draft-post'],
			projectFolders: ['04_Projects'],
			tavernName: 'Tavern',
		};
		const view = new TavernView({} as never, {
			saveSettings,
			settings,
			vault,
		});

		await view.onOpen();
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
		expect(saveSettings).toHaveBeenCalledTimes(1);
		expect(settings.boardTaskKeys).toEqual([]);
	});

	it('should remove a task from the focus queue without completing it', async () => {
		const saveSettings = vi.fn();
		const settings = {
			boardTaskKeys: ['04_Projects/Blogging.md::backlog-1-draft-post'],
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
		const removeButton = findByAriaLabel(
			rootElements.at(-1) as FakeElement,
			'Remove from focus queue',
		);
		if (!removeButton) {
			throw new Error('focus queue remove button was not rendered');
		}

		removeButton.dispatch('click');
		await vi.waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(1));
		expect(settings.boardTaskKeys).toEqual([]);
	});

	it('should resize panels and cleanup document listeners on close', async () => {
		const listeners = new Map<string, Listener>();
		vi.stubGlobal('document', {
			addEventListener: vi.fn((name: string, listener: Listener) => {
				listeners.set(name, listener);
			}),
			removeEventListener: vi.fn((name: string) => {
				listeners.delete(name);
			}),
		});
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
		const handle = findByClass(root, 'tavern-resize-handle');
		if (!handle) {
			throw new Error('resize handle was not rendered');
		}

		handle.dispatch('mousedown', { clientX: 100, preventDefault: vi.fn() });
		listeners.get('mousemove')?.({ clientX: 120 });
		await view.onClose();

		expect(root.style.getPropertyValue('--tavern-list-width')).toBe('260px');
		expect(handle.classes.has('is-dragging')).toBe(false);
		expect(listeners.has('mousemove')).toBe(false);
	});
});
