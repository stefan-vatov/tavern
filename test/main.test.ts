/* eslint-disable eslint/max-statements, eslint/no-magic-numbers, promise/prefer-await-to-callbacks */
import { beforeEach, vi } from 'vitest';
import { Platform, TFile, TFolder } from 'obsidian';
import TavernPlugin from '../src/main';
import { TavernView } from '../src/view';
import { TAVERN_VIEW_TYPE } from '../src/project-mode';
import type { DailyLogController } from '../src/daily-log-controller';
import type { DailyTaskLink } from '../src/daily-log-service';
import type { ProjectVaultFile } from '../src/project-vault';

const { noticeMock } = vi.hoisted(() => ({ noticeMock: vi.fn() }));
vi.mock('obsidian', () => ({
	App: class {},
	Component: class {},
	FuzzySuggestModal: class {},
	ItemView: class {},
	Notice: noticeMock,
	Platform: { isDesktopApp: true },
	Plugin: class {},
	PluginSettingTab: class {},
	Setting: class {},
	TFile: class {},
	TFolder: class {},
	normalizePath: (path: string) => path,
	setIcon: vi.fn(),
}));

const createContainer = () => {
	const attributes = new Map<string, string>();
	return {
		doc: {
			documentElement: {
				setAttribute: vi.fn((name: string, value: string) => attributes.set(name, value)),
				hasAttribute: vi.fn((name: string) => attributes.has(name)),
			},
		},
	};
};

const createLeaf = (container = createContainer()) => {
	let viewState = { type: TAVERN_VIEW_TYPE };
	return {
		getContainer: vi.fn(() => container),
		getViewState: vi.fn(() => viewState),
		setViewState: vi.fn(async (state: { type: string }) => {
			viewState = state;
		}),
		detach: vi.fn(),
		view: {} as unknown,
	};
};

const setup = () => {
	const plugin = new TavernPlugin({} as never, {} as never);
	const leaf = createLeaf();
	const leaves: ReturnType<typeof createLeaf>[] = [];
	const workspace = {
		rootSplit: createContainer(),
		getLeavesOfType: vi.fn(() =>
			leaves.filter((candidate) => candidate.getViewState().type === TAVERN_VIEW_TYPE),
		),
		iterateAllLeaves: vi.fn((callback: (candidate: ReturnType<typeof createLeaf>) => void) =>
			leaves.forEach(callback),
		),
		getMostRecentLeaf: vi.fn(
			(container: ReturnType<typeof createContainer>) =>
				leaves.find((candidate) => candidate.getContainer() === container) ?? null,
		),
		getLeaf: vi.fn(() => {
			leaves.push(leaf);
			return leaf;
		}),
		moveLeafToPopout: vi.fn(),
		revealLeaf: vi.fn(async (_leaf: unknown) => {}),
		detachLeavesOfType: vi.fn(),
		onLayoutReady: vi.fn(),
		on: vi.fn(),
		getActiveFile: vi.fn(() => null as { path: string } | null),
	};
	const metadata = { on: vi.fn() };
	const fileManager = { processFrontMatter: vi.fn() };
	plugin.app = { workspace, metadataCache: metadata, fileManager, vault: { on: vi.fn() } } as never;
	plugin.settings = { boardTaskKeys: [], projectFolders: ['04_Projects'], tavernName: 'Tavern' };
	plugin.loadData = vi.fn(async () => ({}));
	plugin.saveData = vi.fn();
	plugin.registerView = vi.fn();
	plugin.registerObsidianProtocolHandler = vi.fn();
	plugin.addRibbonIcon = vi.fn();
	plugin.addStatusBarItem = vi.fn(() => ({ setText: vi.fn() }) as unknown as HTMLElement);
	plugin.registerEvent = vi.fn();
	plugin.addCommand = vi.fn();
	plugin.addSettingTab = vi.fn();
	return { plugin, leaf, leaves, workspace, metadata, fileManager };
};

const linkedSourcePath = '04_Projects/Linked.md';
const linkedDailyPath = 'Daily/2026/10/2026-10-24.md';
const linkedDay = '2026-10-24';

const setupLinkedTasks = async () => {
	const state = setup();
	const files = new Map([
		[linkedSourcePath, '---\ntavern: project\n---\n## Work\n- [ ] Source ^source-task\n'],
		[linkedDailyPath, '## General\n### Plan\n- [ ] Daily copy ^copy-task\n'],
	]);
	const contents = (path: string): string => {
		const markdown = files.get(path);
		if (markdown === undefined) {
			throw new Error(`Missing file: ${path}`);
		}
		return markdown;
	};
	const vault = {
		on: vi.fn(),
		getMarkdownFiles: () => [...files.keys()].map((path) => ({ path })),
		getAbstractFileByPath: (path: string) => {
			if (files.has(path)) {
				return { path };
			}
			return null;
		},
		read: async (file: ProjectVaultFile) => contents(file.path),
		modify: async (file: ProjectVaultFile, markdown: string) => {
			files.set(file.path, markdown);
		},
		process: vi.fn(async (file: ProjectVaultFile, transform: (markdown: string) => string) => {
			const markdown = transform(contents(file.path));
			files.set(file.path, markdown);
			return markdown;
		}),
		create: async (path: string, markdown: string) => {
			files.set(path, markdown);
			return { path };
		},
		createFolder: vi.fn(),
	};
	const links: DailyTaskLink[] = [
		{
			source: { path: linkedSourcePath, blockId: 'source-task' },
			copies: [{ path: linkedDailyPath, blockId: 'copy-task' }],
			checked: false,
		},
	];
	state.plugin.app = { ...state.plugin.app, vault } as never;
	vi.mocked(state.plugin.loadData).mockResolvedValue({
		dailyLogFolder: 'Daily',
		dailyTaskLinks: links,
		boardTaskKeys: [`${linkedSourcePath}::block:source-task`, '04_Projects/Other.md::other'],
	});
	await state.plugin.onload();
	const [, creator] = vi.mocked(state.plugin.registerView).mock.calls[0]!;
	const view = creator(state.leaf as never) as TavernView;
	const refresh = vi.spyOn(view, 'refreshProjects').mockResolvedValue();
	state.leaf.view = view;
	state.leaves.push(state.leaf);
	const controller = (view as unknown as { deps: { dailyLogs: DailyLogController } }).deps
		.dailyLogs;
	const changed = state.metadata.on.mock.calls.find(([name]) => name === 'changed')![1] as (file: {
		path: string;
	}) => void;
	const renamed = vault.on.mock.calls.find(([name]) => name === 'rename')![1] as (
		file: { path: string },
		oldPath: string,
	) => void;
	return { ...state, files, vault, links, refresh, controller, changed, renamed };
};

beforeEach(() => {
	Platform.isDesktopApp = true;
});

describe('Tavern app window', () => {
	it('registers the view, ribbon, commands and URI without intercepting note opens', async () => {
		const { plugin, workspace } = setup();
		const activate = vi.spyOn(plugin, 'activateView').mockResolvedValue(undefined);
		await plugin.onload();
		expect(plugin.registerView).toHaveBeenCalledWith(TAVERN_VIEW_TYPE, expect.any(Function));
		const [, creator] = vi.mocked(plugin.registerView).mock.calls[0]!;
		const view = creator({} as never) as TavernView;
		expect(view).toBeInstanceOf(TavernView);
		await (view as unknown as { deps: { saveSettings: () => Promise<void> } }).deps.saveSettings();
		expect(plugin.saveData).toHaveBeenCalledWith(plugin.settings);
		expect(workspace.on).not.toHaveBeenCalled();
		expect(plugin.addSettingTab).toHaveBeenCalled();
		vi.mocked(plugin.addRibbonIcon).mock.calls[0]![2]({} as MouseEvent);
		vi.mocked(plugin.addCommand).mock.calls.find(([command]) => command.id === 'open')![0]
			.callback!();
		const [action, handler] = vi.mocked(plugin.registerObsidianProtocolHandler).mock.calls[0]!;
		expect(action).toBe('tavern');
		await handler({ action: 'tavern' });
		expect(activate).toHaveBeenCalledTimes(3);
	});

	it('creates daily logs through Templater using the current saved template selection', async () => {
		const { plugin, leaf, workspace } = setup();
		const first = Object.assign(new TFile(), { path: 'Templates/First.md', extension: 'md' });
		const second = Object.assign(new TFile(), { path: 'Templates/Second.md', extension: 'md' });
		const folder = Object.assign(new TFolder(), { path: 'Daily/2026/10' });
		const entries = new Map<string, TFile | TFolder>([
			[first.path, first],
			[second.path, second],
			[folder.path, folder],
			['Daily', Object.assign(new TFolder(), { path: 'Daily' })],
			['Daily/2026', Object.assign(new TFolder(), { path: 'Daily/2026' })],
		]);
		const create = vi.fn(async (template: TFile, parent: TFolder, title: string) => {
			expect(parent).toBe(folder);
			const created = Object.assign(new TFile(), { path: `${parent.path}/${title}.md` });
			entries.set(created.path, created);
			expect([first, second]).toContain(template);
			return created;
		});
		plugin.app = {
			...plugin.app,
			plugins: { getPlugin: () => ({ templater: { create_new_note_from_template: create } }) },
			vault: {
				on: vi.fn(),
				getRoot: () => new TFolder(),
				getAbstractFileByPath: (path: string) => entries.get(path) ?? null,
			},
		} as never;
		vi.mocked(plugin.loadData).mockResolvedValue({
			dailyLogFolder: 'Daily',
			dailyLogTemplate: first.path,
		});
		await plugin.onload();
		const [, factory] = vi.mocked(plugin.registerView).mock.calls[0]!;
		const view = factory(leaf as never) as unknown as { deps: { dailyLogs: DailyLogController } };
		await view.deps.dailyLogs.create('2026-10-24');
		plugin.settings.dailyLogTemplate = second.path;
		await view.deps.dailyLogs.create('2026-10-25');
		expect(create.mock.calls.map(([template]) => template)).toEqual([first, second]);
		plugin.settings.dailyLogTemplate = '';
		await expect(view.deps.dailyLogs.create('2026-10-26')).rejects.toThrow(
			'Choose a daily log template',
		);
		expect(create).toHaveBeenCalledTimes(2);
		expect(workspace.getLeaf).not.toHaveBeenCalled();
		expect(workspace.revealLeaf).not.toHaveBeenCalled();
	});

	it('creates one desktop window for concurrent opens and keeps its current state', async () => {
		const { plugin, leaf, workspace } = setup();
		const results = await Promise.all([
			plugin.activateView(),
			plugin.activateView(),
			plugin.activateView(),
		]);
		expect(results).toEqual([leaf, leaf, leaf]);
		expect(workspace.getLeaf).toHaveBeenCalledExactlyOnceWith('window');
		expect(leaf.setViewState).toHaveBeenCalledExactlyOnceWith({
			active: true,
			type: TAVERN_VIEW_TYPE,
			state: { boardPage: 'global', selectedPath: undefined },
		});
		expect(workspace.revealLeaf).toHaveBeenCalledTimes(3);
	});

	it('uses a tab on mobile', async () => {
		Platform.isDesktopApp = false;
		const { plugin, workspace } = setup();
		await plugin.activateView();
		expect(workspace.getLeaf).toHaveBeenCalledWith('tab');
		await plugin.activateView();
		expect(workspace.moveLeafToPopout).not.toHaveBeenCalled();
	});

	it('reuses its window after the Tavern view is replaced by a Markdown note', async () => {
		const { plugin, leaf, workspace } = setup();
		await plugin.activateView();
		const appWindow = leaf.getContainer();
		await leaf.setViewState({ type: 'markdown' });
		expect(workspace.getLeavesOfType()).toEqual([]);
		await plugin.activateView();
		expect(workspace.getLeaf).toHaveBeenCalledTimes(1);
		expect(workspace.revealLeaf).toHaveBeenLastCalledWith(leaf);
		expect(leaf.getContainer()).toBe(appWindow);
		expect(leaf.getViewState()).toMatchObject({ type: TAVERN_VIEW_TYPE });
	});

	it('reuses the app window after closing Tavern while a note remains in another tab', async () => {
		const { plugin, leaf, leaves, workspace } = setup();
		await plugin.activateView();
		const note = createLeaf(leaf.getContainer());
		await note.setViewState({ type: 'markdown' });
		leaves.splice(0, 1, note);
		workspace.getMostRecentLeaf.mockReturnValue(null);
		await plugin.activateView();
		expect(workspace.getLeaf).toHaveBeenCalledTimes(1);
		expect(workspace.revealLeaf).toHaveBeenLastCalledWith(note);
		expect(note.getViewState().type).toBe(TAVERN_VIEW_TYPE);
	});

	it('recognizes the same app window across plugin reloads', async () => {
		const { plugin, leaf, workspace } = setup();
		await plugin.activateView();
		await leaf.setViewState({ type: 'markdown' });
		plugin.onunload();
		const reloaded = setup().plugin;
		reloaded.app = plugin.app;
		await reloaded.activateView();
		expect(workspace.getLeaf).toHaveBeenCalledTimes(1);
		expect(workspace.revealLeaf).toHaveBeenLastCalledWith(leaf);
	});

	it('creates a new window after its previous window is actually closed', async () => {
		const { plugin, leaves, workspace } = setup();
		await plugin.activateView();
		leaves.length = 0;
		await plugin.activateView();
		expect(workspace.getLeaf).toHaveBeenCalledTimes(2);
	});

	it('leaves unrelated Markdown windows alone', async () => {
		const { plugin, leaves, workspace } = setup();
		const note = createLeaf();
		await note.setViewState({ type: 'markdown' });
		leaves.push(note);
		await plugin.activateView();
		expect(workspace.getLeaf).toHaveBeenCalledExactlyOnceWith('window');
		expect(note.getViewState().type).toBe('markdown');
		expect(note.detach).not.toHaveBeenCalled();
	});

	it('moves a restored main-workspace Tavern leaf into the app window', async () => {
		const { plugin, leaves, workspace } = setup();
		const legacy = createLeaf(workspace.rootSplit);
		leaves.push(legacy);
		await plugin.activateView();
		expect(workspace.moveLeafToPopout).toHaveBeenCalledExactlyOnceWith(legacy);
		expect(legacy.setViewState).not.toHaveBeenCalled();
		expect(workspace.getLeaf).not.toHaveBeenCalled();
	});

	it('prefers the existing popout and removes duplicate Tavern leaves after revealing it', async () => {
		const { plugin, leaf, leaves, workspace } = setup();
		const legacy = createLeaf(workspace.rootSplit);
		leaves.push(legacy, leaf);
		workspace.revealLeaf.mockImplementation(async () => {
			expect(legacy.detach).not.toHaveBeenCalled();
		});
		await plugin.activateView('04_Projects/Pi.md');
		expect(leaf.setViewState).toHaveBeenCalledWith({
			active: true,
			type: TAVERN_VIEW_TYPE,
			state: { boardPage: 'project', selectedPath: '04_Projects/Pi.md' },
		});
		expect(workspace.revealLeaf).toHaveBeenCalledWith(leaf);
		expect(legacy.detach).toHaveBeenCalledOnce();
		expect(leaf.detach).not.toHaveBeenCalled();
		expect(workspace.moveLeafToPopout).not.toHaveBeenCalled();
	});

	it('restores only an already-open Tavern app after layout is ready', async () => {
		const { plugin, leaf, leaves, workspace } = setup();
		const activate = vi.spyOn(plugin, 'activateView').mockResolvedValue(undefined);
		await plugin.onload();
		const ready = workspace.onLayoutReady.mock.calls[0]![0] as () => void;
		ready();
		expect(activate).not.toHaveBeenCalled();
		leaves.push(leaf);
		ready();
		expect(activate).toHaveBeenCalledOnce();
		plugin.onunload();
		expect(workspace.detachLeavesOfType).toHaveBeenCalledWith(TAVERN_VIEW_TYPE);
	});

	it('waits for a deferred view before opening task search', async () => {
		const { plugin, leaf, leaves, workspace } = setup();
		leaves.push(leaf);
		const search = vi.fn();
		workspace.revealLeaf.mockImplementation(async () => {
			leaf.view = { openTaskSearch: search };
		});
		await plugin.onload();
		vi
			.mocked(plugin.addCommand)
			.mock.calls.find(([command]) => command.id === 'open-task-search')![0].callback!();
		await vi.waitFor(() => expect(search).toHaveBeenCalledOnce());
	});

	it('does not try to open search after a window failure', async () => {
		const { plugin, workspace } = setup();
		workspace.getLeaf.mockImplementation(() => {
			throw new Error('Window unavailable');
		});
		await plugin.onload();
		vi
			.mocked(plugin.addCommand)
			.mock.calls.find(([command]) => command.id === 'open-task-search')![0].callback!();
		await vi.waitFor(() => expect(noticeMock).toHaveBeenCalledOnce());
		expect(workspace.revealLeaf).not.toHaveBeenCalled();
	});

	it('reports an opening failure and permits a later retry', async () => {
		const { plugin, workspace } = setup();
		workspace.getLeaf.mockImplementationOnce(() => {
			throw new Error('Window unavailable');
		});
		expect(await plugin.activateView()).toBeUndefined();
		expect(noticeMock).toHaveBeenCalledWith('Tavern could not open its app window.');
		expect(await plugin.activateView()).toBeDefined();
	});

	it('marks the active note and opens the project inside Tavern', async () => {
		const { plugin, workspace, fileManager } = setup();
		const file = { path: '04_Projects/New.md' };
		const frontmatter: Record<string, unknown> = {};
		workspace.getActiveFile.mockReturnValue(file);
		fileManager.processFrontMatter.mockImplementation(async (_file, cb) => cb(frontmatter));
		const activate = vi.spyOn(plugin, 'activateView').mockResolvedValue(undefined);
		await plugin.onload();
		vi
			.mocked(plugin.addCommand)
			.mock.calls.find(([command]) => command.id === 'mark-current-note-as-project')![0]
			.callback!();
		await vi.waitFor(() => expect(activate).toHaveBeenCalledWith(file.path));
		expect(frontmatter).toEqual({ tavern: 'project' });
		expect(fileManager.processFrontMatter).toHaveBeenCalledWith(file, expect.any(Function));
	});

	it('explains when marking needs an active note', async () => {
		const { plugin, fileManager } = setup();
		await plugin.onload();
		vi
			.mocked(plugin.addCommand)
			.mock.calls.find(([command]) => command.id === 'mark-current-note-as-project')![0]
			.callback!();
		expect(fileManager.processFrontMatter).not.toHaveBeenCalled();
		expect(noticeMock).toHaveBeenCalledWith('Tavern needs an active note to mark as a project.');
	});

	it('refreshes open Tavern views after metadata changes without waking deferred views', async () => {
		const { plugin, leaf, leaves, metadata } = setup();
		const view = new TavernView({} as never, {
			settings: plugin.settings,
			saveSettings: vi.fn(),
			vault: {} as never,
		});
		const refresh = vi.spyOn(view, 'refreshProjects').mockResolvedValue();
		leaf.view = view;
		leaves.push(createLeaf(), leaf);
		await plugin.onload();
		const changed = metadata.on.mock.calls[0]![1] as (file: unknown) => void;
		changed({ path: '04_Projects/New.md' });
		await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
		changed(null);
		leaves.length = 0;
		changed({ path: '04_Projects/New.md' });
		expect(refresh).toHaveBeenCalledOnce();
	});

	it('cancels queued opens when the plugin unloads', async () => {
		const { plugin, workspace } = setup();
		const opening = plugin.activateView();
		plugin.onunload();
		expect(await opening).toBeUndefined();
		expect(workspace.getLeaf).not.toHaveBeenCalled();
	});

	it('does not reveal a view that finishes initializing after unload', async () => {
		const { plugin, leaf, workspace } = setup();
		leaf.setViewState.mockImplementation(async () => {
			plugin.onunload();
		});
		expect(await plugin.activateView()).toBeUndefined();
		expect(workspace.revealLeaf).not.toHaveBeenCalled();
		expect(leaf.detach).toHaveBeenCalledOnce();
	});

	it('detaches a deferred view when unloading while it is revealing', async () => {
		const { plugin, leaf, workspace } = setup();
		workspace.revealLeaf.mockImplementation(async () => {
			plugin.onunload();
		});
		expect(await plugin.activateView()).toBeUndefined();
		expect(leaf.detach).toHaveBeenCalledOnce();
	});

	it('loads defaults and persists settings', async () => {
		const { plugin } = setup();
		vi.mocked(plugin.loadData).mockResolvedValue({ projectFolders: ['Projects'] });
		await plugin.loadSettings();
		await plugin.saveSettings();
		expect(plugin.settings).toEqual({
			availableTasksCollapsed: false,
			boardTaskKeys: [],
			dailyLogFolder: '02_Daily_Log/Daily_Log',
			dailyLogTemplate: '',
			dailyTaskLinks: [],
			projectFolders: ['Projects'],
			sidebarCollapsedSections: [],
			tavernName: 'Tavern',
		});
		expect(plugin.saveData).toHaveBeenCalledWith(plugin.settings);
	});
});

describe('daily task plugin events', () => {
	it.each([linkedSourcePath, linkedDailyPath])(
		'synchronizes editor checkbox changes in %s before refreshing a live view',
		async (path) => {
			const state = await setupLinkedTasks();
			const refreshed: { source: string; copy: string; checked: boolean }[] = [];
			state.files.set(path, state.files.get(path)!.replace('- [ ]', '- [x]'));
			state.refresh.mockImplementation(async () => {
				refreshed.push({
					source: state.files.get(linkedSourcePath)!,
					copy: state.files.get(linkedDailyPath)!,
					checked: state.plugin.settings.dailyTaskLinks![0]!.checked,
				});
			});
			state.changed({ path });
			await vi.waitFor(() => expect(state.refresh).toHaveBeenCalledOnce());
			expect(refreshed).toEqual([
				{
					source: expect.stringContaining('- [x] Source ^source-task'),
					copy: expect.stringContaining('- [x] Daily copy ^copy-task'),
					checked: true,
				},
			]);
			expect(state.files.get(linkedSourcePath)).toMatch(/## Done\n+- \[x\] Source/);
			expect(state.plugin.saveData).toHaveBeenCalledWith(
				expect.objectContaining({
					dailyTaskLinks: [expect.objectContaining({ checked: true })],
				}),
			);
			expect(noticeMock).not.toHaveBeenCalled();
		},
	);

	it('persists renamed source endpoints and focus references before refreshing the view', async () => {
		const state = await setupLinkedTasks();
		const renamedPath = '04_Projects/Renamed.md';
		const refreshed: { sourcePath: string; focused: string[] }[] = [];
		state.files.set(renamedPath, state.files.get(linkedSourcePath)!);
		state.files.delete(linkedSourcePath);
		state.refresh.mockImplementation(async () => {
			refreshed.push({
				sourcePath: state.plugin.settings.dailyTaskLinks![0]!.source.path,
				focused: [...state.plugin.settings.boardTaskKeys],
			});
		});
		state.renamed({ path: renamedPath }, linkedSourcePath);
		await vi.waitFor(() => expect(state.refresh).toHaveBeenCalledOnce());
		expect(refreshed).toEqual([
			{
				sourcePath: renamedPath,
				focused: [`${renamedPath}::block:source-task`, '04_Projects/Other.md::other'],
			},
		]);
		expect(state.plugin.saveData).toHaveBeenLastCalledWith(
			expect.objectContaining({
				dailyTaskLinks: [
					expect.objectContaining({ source: { path: renamedPath, blockId: 'source-task' } }),
				],
			}),
		);
		expect(state.plugin.settings.dailyTaskLinks![0]!.copies).toEqual(state.links[0]!.copies);
	});

	it('reports an unresolved editor link and refreshes without changing the other note', async () => {
		const state = await setupLinkedTasks();
		const source = `${state.files.get(linkedSourcePath)!}- [ ] Collision ^source-task\n`;
		state.files.set(linkedSourcePath, source);
		state.files.set(linkedDailyPath, state.files.get(linkedDailyPath)!.replace('- [ ]', '- [x]'));
		state.changed({ path: linkedDailyPath });
		await vi.waitFor(() => expect(state.refresh).toHaveBeenCalledOnce());
		expect(noticeMock).toHaveBeenCalledWith(expect.stringContaining('missing or ambiguous'));
		expect(state.files.get(linkedSourcePath)).toBe(source);
		expect(state.vault.process).not.toHaveBeenCalled();
		expect(state.plugin.settings.dailyTaskLinks).toEqual(state.links);
	});

	it('stops queued editor synchronization and view refresh when the plugin unloads', async () => {
		const state = await setupLinkedTasks();
		const source = state.files.get(linkedSourcePath);
		state.files.set(linkedDailyPath, state.files.get(linkedDailyPath)!.replace('- [ ]', '- [x]'));
		state.changed({ path: linkedDailyPath });
		state.plugin.onunload();
		await expect(state.controller.read(linkedDay)).rejects.toThrow('disposed');
		expect(state.files.get(linkedSourcePath)).toBe(source);
		expect(state.vault.process).not.toHaveBeenCalled();
		expect(state.refresh).not.toHaveBeenCalled();
		expect(noticeMock).not.toHaveBeenCalled();
	});

	it('retains the saved registry in memory when a controller action cannot persist changed links', async () => {
		const state = await setupLinkedTasks();
		const source = state.files.get(linkedSourcePath);
		const daily = state.files.get(linkedDailyPath);
		vi.mocked(state.plugin.saveData).mockRejectedValueOnce(new Error('Settings write failed.'));
		await expect(
			state.controller.setTaskChecked(linkedDay, 'block:copy-task', true),
		).rejects.toThrow('Settings write failed.');
		expect(state.plugin.settings.dailyTaskLinks).toEqual(state.links);
		expect(state.plugin.settings.dailyTaskLinks![0]!.checked).toBe(false);
		expect(state.files.get(linkedSourcePath)).toBe(source);
		expect(state.files.get(linkedDailyPath)).toBe(daily);
	});
});
