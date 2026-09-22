import { Notice, Platform, Plugin, type WorkspaceLeaf } from 'obsidian';
import { createTavernViewState } from './project-mode';
import { DEFAULT_SETTINGS, TavernSettingTab } from './settings';
import type { TavernSettings } from './settings-defaults';
import { TAVERN_VIEW_TYPE, TavernView } from './view';
import type { ProjectVault } from './project-vault';

const EMPTY_LEAF_COUNT = 0;
const FIRST_LEAF_INDEX = 0;
const APP_WINDOW_ATTRIBUTE = 'data-tavern-app-window';

class TavernPlugin extends Plugin {
	settings!: TavernSettings;
	private unloaded = false;
	private activation: Promise<WorkspaceLeaf | undefined> = Promise.resolve(undefined);

	/* eslint-disable eslint/max-statements */
	async onload() {
		await this.loadSettings();

		this.registerView(
			TAVERN_VIEW_TYPE,
			(leaf) =>
				new TavernView(leaf, {
					saveSettings: () => this.saveSettings(),
					settings: this.settings,
					vault: this.app.vault as unknown as ProjectVault,
				}),
		);

		this.addRibbonIcon('dice', 'Open tavern', () => {
			void this.activateView();
		});

		const statusBarItemEl = this.addStatusBarItem();
		statusBarItemEl.setText('Tavern');

		this.registerObsidianProtocolHandler('tavern', async () => {
			await this.activateView();
		});
		this.app.workspace.onLayoutReady(() => {
			if (this.app.workspace.getLeavesOfType(TAVERN_VIEW_TYPE).length > EMPTY_LEAF_COUNT) {
				void this.activateView();
			}
		});

		// Refresh live views when project metadata changes; leave deferred views asleep.
		this.registerEvent(
			this.app.metadataCache.on('changed', (file) => {
				if (file) {
					this.refreshOpenTavern();
				}
			}),
		);

		this.addCommand({
			callback: () => {
				void this.activateView();
			},
			id: 'open',
			name: 'Open',
		});

		this.addCommand({
			callback: () => {
				void this.openTaskSearch();
			},
			id: 'open-task-search',
			name: 'Open task search',
		});

		this.addCommand({
			callback: () => {
				void this.markActiveFileAsProject();
			},
			id: 'mark-current-note-as-project',
			name: 'Mark current note as project',
		});

		this.addSettingTab(new TavernSettingTab(this.app, this));
	}

	onunload() {
		this.unloaded = true;
		this.app.workspace.detachLeavesOfType(TAVERN_VIEW_TYPE);
	}

	activateView(selectedPath?: string): Promise<WorkspaceLeaf | undefined> {
		// A second command can arrive before the first view has finished opening.
		this.activation = this.openAfterActivation(this.activation, selectedPath);
		return this.activation;
	}

	private async openAfterActivation(
		previous: Promise<WorkspaceLeaf | undefined>,
		selectedPath?: string,
	): Promise<WorkspaceLeaf | undefined> {
		await previous;
		if (this.unloaded) {
			return undefined;
		}
		try {
			return await this.prepareViewLeaf(selectedPath);
		} catch {
			new Notice(`${this.settings.tavernName} could not open its app window.`);
			return undefined;
		}
	}

	private async openTaskSearch(): Promise<void> {
		const leaf = await this.activateView();
		const view = leaf?.view;
		if (isTavernViewWithTaskSearch(view)) {
			view.openTaskSearch();
		}
	}

	private async prepareViewLeaf(
		selectedPath: string | undefined,
	): Promise<WorkspaceLeaf | undefined> {
		const { workspace } = this.app;
		const existingLeaves = workspace.getLeavesOfType(TAVERN_VIEW_TYPE);
		const existing =
			this.findAppWindowLeaf(existingLeaves) ??
			existingLeaves.find((leaf) => leaf.getContainer() !== workspace.rootSplit) ??
			existingLeaves[FIRST_LEAF_INDEX];
		let leaf = existing;
		if (!leaf) {
			let location: 'window' | 'tab' = 'tab';
			if (Platform.isDesktopApp) {
				location = 'window';
			}
			leaf = workspace.getLeaf(location);
		}

		if (existing && Platform.isDesktopApp && leaf.getContainer() === workspace.rootSplit) {
			workspace.moveLeafToPopout(leaf);
		}
		if (Platform.isDesktopApp && leaf.getContainer() !== workspace.rootSplit) {
			leaf.getContainer().doc.documentElement.setAttribute(APP_WINDOW_ATTRIBUTE, 'true');
		}
		if (!existingLeaves.includes(leaf) || selectedPath) {
			await leaf.setViewState(createTavernViewState(selectedPath));
		}
		if (this.unloaded) {
			leaf.detach();
			return undefined;
		}
		// revealLeaf also loads views that Obsidian restored in a deferred state.
		await workspace.revealLeaf(leaf);
		if (this.unloaded) {
			leaf.detach();
			return undefined;
		}
		for (const duplicate of existingLeaves) {
			if (duplicate !== leaf) {
				duplicate.detach();
			}
		}
		return leaf;
	}

	private findAppWindowLeaf(tavernLeaves: WorkspaceLeaf[]): WorkspaceLeaf | undefined {
		if (!Platform.isDesktopApp) {
			return undefined;
		}
		const { workspace } = this.app;
		let appLeaf: WorkspaceLeaf | undefined = undefined;
		workspace.iterateAllLeaves((leaf) => {
			const container = leaf.getContainer();
			if (
				!appLeaf &&
				container !== workspace.rootSplit &&
				container.doc.documentElement.hasAttribute(APP_WINDOW_ATTRIBUTE)
			) {
				appLeaf =
					tavernLeaves.find((candidate) => candidate.getContainer() === container) ??
					workspace.getMostRecentLeaf(container) ??
					leaf;
			}
		});
		return appLeaf;
	}

	async loadSettings() {
		this.settings = {
			...DEFAULT_SETTINGS,
			...((await this.loadData()) as Partial<TavernSettings>),
		};
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private async markActiveFileAsProject() {
		const file = this.app.workspace.getActiveFile();
		/* c8 ignore next -- mark no-active-file notice+return branch (tested in main.test "show notice when marking without"); listed in cov */
		if (!file) {
			new Notice(`${this.settings.tavernName} needs an active note to mark as a project.`);
			return;
		}

		await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
			frontmatter.tavern = 'project';
		});
		await this.activateView(file.path);
	}

	private refreshOpenTavern(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(TAVERN_VIEW_TYPE)) {
			if (leaf.view instanceof TavernView) {
				void leaf.view.refreshProjects();
			}
		}
	}
}

const isTavernViewWithTaskSearch = (view: unknown): view is Pick<TavernView, 'openTaskSearch'> =>
	typeof view === 'object' &&
	view !== null &&
	'openTaskSearch' in view &&
	typeof view.openTaskSearch === 'function';

export default TavernPlugin;
