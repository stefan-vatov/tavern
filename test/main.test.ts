/* eslint-disable eslint/init-declarations, eslint/max-statements, promise/prefer-await-to-callbacks */
import { vi } from 'vitest';
import TavernPlugin from '../src/main';
import { TAVERN_VIEW_TYPE } from '../src/project-mode';

const { noticeMock } = vi.hoisted(() => ({
	noticeMock: vi.fn(),
}));
const ACTIVATION_COUNT_WITH_SEARCH_COMMAND = 4;
const ONE_SEARCH_OPEN = 1;
const ONE_CALL = 1;
const TWO_CALLS = 2;

vi.mock('obsidian', () => ({
	App: class {},
	ItemView: class {},
	Notice: noticeMock,
	Plugin: class {},
	PluginSettingTab: class {},
	Setting: class {},
	TFile: class {},
	setIcon: vi.fn(),
}));

const createPlugin = (): TavernPlugin => {
	const plugin = new TavernPlugin({} as never, {} as never);
	plugin.settings = {
		boardTaskKeys: [],
		projectFolders: ['04_Projects'],
		tavernName: 'Tavern',
	};
	return plugin;
};

describe('main plugin activation', () => {
	it('should register views, commands, settings, and file-open routing on load', async () => {
		const plugin = createPlugin();
		let ribbonCallback: (() => void) | undefined;
		const commandCallbacks = new Map<string, () => void>();
		let fileOpenCallback: ((file: { path: string } | null) => void) | undefined;
		let viewCreator: ((leaf: unknown) => unknown) | undefined;
		const activateView = vi.spyOn(plugin, 'activateView').mockResolvedValue({} as never);
		const activeLeaf = { id: 'active-leaf' };
		const setText = vi.fn();
		plugin.loadData = vi.fn(async () => ({ tavernName: 'Project Pub' }));
		plugin.saveData = vi.fn();
		plugin.registerView = vi.fn((type, creator) => {
			viewCreator = creator;
			expect(type).toBe(TAVERN_VIEW_TYPE);
		});
		plugin.addRibbonIcon = vi.fn((_icon, _label, callback) => {
			ribbonCallback = callback;
			return {} as HTMLElement;
		});
		plugin.addStatusBarItem = vi.fn(() => ({ setText }) as unknown as HTMLElement);
		plugin.registerEvent = vi.fn();
		plugin.addCommand = vi.fn((command) => {
			commandCallbacks.set(command.id, command.callback);
			return command;
		});
		plugin.addSettingTab = vi.fn();
		plugin.app = {
			metadataCache: {
				getFileCache: vi.fn(() => ({ frontmatter: { tavern: 'project' } })),
				on: vi.fn(() => ({ event: 'metadata-changed' })), // L3: support the external fm 'changed' listener added in onload
			},
			vault: {},
			workspace: {
				activeLeaf,
				on: vi.fn((_name, callback) => {
					fileOpenCallback = callback;
					return { event: 'file-open' };
				}),
			},
		} as never;

		await plugin.onload();
		ribbonCallback?.();
		commandCallbacks.get('open')?.();
		commandCallbacks.get('open-task-search')?.();
		fileOpenCallback?.({ path: '04_Projects/Pi.md' });
		const view = viewCreator?.({});
		await (view as { deps: { saveSettings: () => Promise<void> } }).deps.saveSettings();

		expect(plugin.settings.tavernName).toBe('Project Pub');
		expect(plugin.saveData).toHaveBeenCalledWith(plugin.settings);
		expect(plugin.registerView).toHaveBeenCalled();
		expect(view).toBeDefined();
		expect(setText).toHaveBeenCalledWith('Tavern');
		expect(plugin.registerEvent).toHaveBeenCalledWith({ event: 'file-open' });
		expect(plugin.addSettingTab).toHaveBeenCalled();
		expect([...commandCallbacks.keys()]).toEqual([
			'open',
			'open-task-search',
			'mark-current-note-as-project',
		]);
		expect(activateView).toHaveBeenCalledWith();
		expect(activateView).toHaveBeenCalledTimes(ACTIVATION_COUNT_WITH_SEARCH_COMMAND);
		expect(activateView).toHaveBeenCalledWith('04_Projects/Pi.md', activeLeaf);
	});

	it('should open task search through the command on the tavern view', async () => {
		const plugin = createPlugin();
		let searchCommand: (() => void) | undefined;
		const openTaskSearch = vi.fn();
		const leaf = { setViewState: vi.fn(), view: { openTaskSearch } };
		plugin.loadData = vi.fn(async () => ({}));
		plugin.saveData = vi.fn();
		plugin.registerView = vi.fn();
		plugin.addRibbonIcon = vi.fn();
		plugin.addStatusBarItem = vi.fn(() => ({ setText: vi.fn() }) as unknown as HTMLElement);
		plugin.registerEvent = vi.fn();
		plugin.addCommand = vi.fn((command) => {
			if (command.id === 'open-task-search') {
				searchCommand = command.callback;
			}
			return command;
		});
		plugin.addSettingTab = vi.fn();
		plugin.app = {
			metadataCache: {
				getFileCache: vi.fn(),
				on: vi.fn(() => ({ event: 'metadata-changed' })), // L3: support the external fm 'changed' listener added in onload
			},
			vault: {},
			workspace: {
				getLeaf: vi.fn(() => leaf),
				getLeavesOfType: vi.fn(() => []),
				on: vi.fn(() => ({ event: 'file-open' })),
				revealLeaf: vi.fn(),
			},
		} as never;

		await plugin.onload();
		searchCommand?.();
		await vi.waitFor(() => expect(openTaskSearch).toHaveBeenCalledTimes(ONE_SEARCH_OPEN));
	});

	it('should ignore non-project file-open events and detach views on unload', async () => {
		const plugin = createPlugin();
		let fileOpenCallback: ((file: { path: string } | null) => void) | undefined;
		const activateView = vi.spyOn(plugin, 'activateView').mockResolvedValue(undefined);
		const detachLeavesOfType = vi.fn();
		plugin.loadData = vi.fn(async () => ({}));
		plugin.registerView = vi.fn();
		plugin.addRibbonIcon = vi.fn();
		plugin.addStatusBarItem = vi.fn(() => ({ setText: vi.fn() }) as unknown as HTMLElement);
		plugin.registerEvent = vi.fn();
		plugin.addCommand = vi.fn();
		plugin.addSettingTab = vi.fn();
		plugin.app = {
			metadataCache: {
				getFileCache: vi.fn(() => ({ frontmatter: { tavern: 'note' } })),
				on: vi.fn(() => ({ event: 'metadata-changed' })), // L3: support the external fm 'changed' listener added in onload
			},
			vault: {},
			workspace: {
				detachLeavesOfType,
				on: vi.fn((_name, callback) => {
					fileOpenCallback = callback;
					return { event: 'file-open' };
				}),
			},
		} as never;

		await plugin.onload();
		fileOpenCallback?.({ path: '04_Projects/Pi.md' });
		fileOpenCallback?.(null);
		plugin.onunload();

		expect(activateView).not.toHaveBeenCalled();
		expect(detachLeavesOfType).toHaveBeenCalledWith(TAVERN_VIEW_TYPE);
	});

	it('should load and save settings through Obsidian data storage', async () => {
		const plugin = createPlugin();
		const saveData = vi.fn();
		plugin.loadData = vi.fn(async () => ({ projectFolders: ['Projects'] }));
		plugin.saveData = saveData;

		await plugin.loadSettings();
		await plugin.saveSettings();

		expect(plugin.settings).toEqual({
			availableTasksCollapsed: false,
			boardTaskKeys: [],
			projectFolders: ['Projects'],
			sidebarCollapsedSections: [],
			tavernName: 'Tavern',
		});
		expect(saveData).toHaveBeenCalledWith(plugin.settings);
	});

	it('should create and reveal the tavern view when no view exists', async () => {
		const plugin = createPlugin();
		const setViewState = vi.fn();
		const leaf = { setViewState };
		const revealLeaf = vi.fn();
		plugin.app = {
			workspace: {
				getLeaf: vi.fn(() => leaf),
				getLeavesOfType: vi.fn(() => []),
				revealLeaf,
			},
		} as never;

		await plugin.activateView('04_Projects/Pi.md');

		expect(setViewState).toHaveBeenCalledWith({
			active: true,
			state: { mode: 'note', selectedPath: '04_Projects/Pi.md' },
			type: TAVERN_VIEW_TYPE,
		});
		expect(plugin.app.workspace.getLeaf).toHaveBeenCalledWith('tab');
		expect(revealLeaf).toHaveBeenCalledWith(leaf);
	});

	it('should replace the target note leaf with the tavern project view', async () => {
		const plugin = createPlugin();
		const setViewState = vi.fn();
		const targetLeaf = { setViewState };
		const revealLeaf = vi.fn();
		plugin.app = {
			workspace: {
				getLeavesOfType: vi.fn(() => []),
				getLeaf: vi.fn(),
				revealLeaf,
			},
		} as never;

		await plugin.activateView('04_Projects/Pi.md', targetLeaf as never);

		expect(setViewState).toHaveBeenCalledWith({
			active: true,
			state: { mode: 'note', selectedPath: '04_Projects/Pi.md' },
			type: TAVERN_VIEW_TYPE,
		});
		expect(plugin.app.workspace.getLeaf).not.toHaveBeenCalled();
		expect(revealLeaf).toHaveBeenCalledWith(targetLeaf);
	});

	it('should update an existing tavern view when a selected path is provided', async () => {
		const plugin = createPlugin();
		const setViewState = vi.fn();
		const leaf = { setViewState };
		const revealLeaf = vi.fn();
		plugin.app = {
			workspace: {
				getLeaf: vi.fn(),
				getLeavesOfType: vi.fn(() => [leaf]),
				revealLeaf,
			},
		} as never;

		await plugin.activateView('04_Projects/Pi.md');

		expect(setViewState).toHaveBeenCalledWith({
			active: true,
			state: { mode: 'note', selectedPath: '04_Projects/Pi.md' },
			type: TAVERN_VIEW_TYPE,
		});
		expect(revealLeaf).toHaveBeenCalledWith(leaf);
	});

	it('should reveal an existing tavern view without changing state when no path is provided', async () => {
		const plugin = createPlugin();
		const setViewState = vi.fn();
		const leaf = { setViewState };
		const revealLeaf = vi.fn();
		plugin.app = {
			workspace: {
				getLeaf: vi.fn(),
				getLeavesOfType: vi.fn(() => [leaf]),
				revealLeaf,
			},
		} as never;

		await plugin.activateView();

		expect(setViewState).not.toHaveBeenCalled();
		expect(revealLeaf).toHaveBeenCalledWith(leaf);
	});

	it('should show a notice when no workspace leaf is available', async () => {
		const plugin = createPlugin();
		plugin.app = {
			workspace: {
				getLeaf: vi.fn(() => undefined),
				getLeavesOfType: vi.fn(() => []),
				revealLeaf: vi.fn(),
			},
		} as never;

		await plugin.activateView();

		expect(noticeMock).toHaveBeenCalledWith('Tavern could not open a workspace leaf.');
	});

	it('should mark the active file as a tavern project and open it', async () => {
		const plugin = createPlugin();
		const activeFile = { path: '04_Projects/Pi.md' };
		const activeLeaf = { id: 'active-leaf' };
		const frontmatter: Record<string, unknown> = {};
		const activateView = vi.spyOn(plugin, 'activateView').mockResolvedValue(undefined);
		let markCommand: (() => void) | undefined;
		plugin.loadData = vi.fn(async () => ({}));
		plugin.registerView = vi.fn();
		plugin.addRibbonIcon = vi.fn();
		plugin.addStatusBarItem = vi.fn(() => ({ setText: vi.fn() }) as unknown as HTMLElement);
		plugin.registerEvent = vi.fn();
		plugin.addCommand = vi.fn((command) => {
			if (command.id === 'mark-current-note-as-project') {
				markCommand = command.callback;
			}
			return command;
		});
		plugin.addSettingTab = vi.fn();
		plugin.app = {
			fileManager: {
				processFrontMatter: vi.fn(async (_file, callback) => callback(frontmatter)),
			},
			metadataCache: {
				getFileCache: vi.fn(),
				on: vi.fn(() => ({ event: 'metadata-changed' })), // L3: support the external fm 'changed' listener
			},
			vault: {},
			workspace: {
				activeLeaf,
				getActiveFile: vi.fn(() => activeFile),
				on: vi.fn(),
			},
		} as never;

		await plugin.onload();
		markCommand?.();
		await Promise.resolve();

		expect(frontmatter.tavern).toBe('project');
		expect(plugin.app.fileManager.processFrontMatter).toHaveBeenCalledWith(
			activeFile,
			expect.any(Function),
		);
		expect(activateView).toHaveBeenCalledWith('04_Projects/Pi.md', activeLeaf);
	});

	it('should show a notice when marking without an active note', async () => {
		const plugin = createPlugin();
		let markCommand: (() => void) | undefined;
		plugin.loadData = vi.fn(async () => ({}));
		plugin.registerView = vi.fn();
		plugin.addRibbonIcon = vi.fn();
		plugin.addStatusBarItem = vi.fn(() => ({ setText: vi.fn() }) as unknown as HTMLElement);
		plugin.registerEvent = vi.fn();
		plugin.addCommand = vi.fn((command) => {
			if (command.id === 'mark-current-note-as-project') {
				markCommand = command.callback;
			}
			return command;
		});
		plugin.addSettingTab = vi.fn();
		plugin.app = {
			fileManager: {
				processFrontMatter: vi.fn(),
			},
			metadataCache: {
				getFileCache: vi.fn(),
				on: vi.fn(() => ({ event: 'metadata-changed' })), // L3: support the external fm 'changed' listener
			},
			vault: {},
			workspace: {
				getActiveFile: vi.fn(() => null),
				on: vi.fn(),
			},
		} as never;

		await plugin.onload();
		markCommand?.();
		await Promise.resolve();

		expect(plugin.app.fileManager.processFrontMatter).not.toHaveBeenCalled();
		expect(noticeMock).toHaveBeenCalledWith('Tavern needs an active note to mark as a project.');
	});

	// TDD coverage for L3 metadata 'changed' listener + _refreshOpenTavernIfNeeded helper (exercises if(file), getLeaves check, early return on 0 leaves, forEach call to refresh)
	it('should refresh open tavern views on metadata changed when taverns are open (L3), and short-circuit when none (covers 48-49,167-174)', async () => {
		const plugin = createPlugin();
		const refreshMock = vi.fn();
		const leafWithRefresh = { view: { refreshProjects: refreshMock } };
		let changedCallback: ((file: unknown) => void) | undefined;
		plugin.loadData = vi.fn(async () => ({}));
		plugin.registerView = vi.fn();
		plugin.addRibbonIcon = vi.fn();
		plugin.addStatusBarItem = vi.fn(() => ({ setText: vi.fn() }) as unknown as HTMLElement);
		plugin.registerEvent = vi.fn();
		plugin.addCommand = vi.fn();
		plugin.addSettingTab = vi.fn();
		const getLeaves = vi.fn((type: string) => {
			if (type === TAVERN_VIEW_TYPE) {
				return [leafWithRefresh];
			}
			return [];
		});
		plugin.app = {
			metadataCache: {
				getFileCache: vi.fn(),
				on: vi.fn((eventName: string, cb: (file: unknown) => void) => {
					if (eventName === 'changed') {
						changedCallback = cb;
					}
					return { event: 'metadata-changed' };
				}),
			},
			vault: {},
			workspace: {
				getLeavesOfType: getLeaves,
				on: vi.fn(),
			},
		} as never;

		await plugin.onload();

		// positive: file truthy + leaves >0 => calls refresh via helper
		changedCallback?.({ path: '04_Projects/Pi.md' });
		await vi.waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(ONE_CALL));

		// forEach if(view && typeof fn): include a leaf without view/fn to hit falsy branch too
		getLeaves.mockReturnValue([{ view: null }, { view: {} }, leafWithRefresh] as any);
		changedCallback?.({ path: '04_Projects/Pi2.md' });
		await vi.waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(TWO_CALLS));

		// early return when no leaves
		getLeaves.mockReturnValue([]);
		changedCallback?.({ path: '04_Projects/Other.md' });
		expect(refreshMock).toHaveBeenCalledTimes(TWO_CALLS); // no extra

		// if(!file) guard
		changedCallback?.(null);
		expect(refreshMock).toHaveBeenCalledTimes(TWO_CALLS);
	});
});
