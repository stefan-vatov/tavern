import { Notice, Plugin, TFile, type WorkspaceLeaf } from 'obsidian';
import { createTavernViewState, shouldOpenTavernProjectFile } from './project-mode';
import { DEFAULT_SETTINGS, TavernSettingTab } from './settings';
import type { TavernSettings } from './settings-defaults';
import { TAVERN_VIEW_TYPE, TavernView } from './view';
import type { ProjectVault } from './project-vault';

const FIRST_LEAF_INDEX = 0;
const EMPTY_LEAF_COUNT = 0;

class TavernPlugin extends Plugin {
	settings!: TavernSettings;

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

		this.registerEvent(
			this.app.workspace.on('file-open', (file) => {
				if (file && this.isTavernProjectFile(file)) {
					void this.activateView(file.path, this.app.workspace.activeLeaf ?? undefined);
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
		this.app.workspace.detachLeavesOfType(TAVERN_VIEW_TYPE);
	}

	async activateView(
		selectedPath?: string,
		targetLeaf?: WorkspaceLeaf,
	): Promise<WorkspaceLeaf | undefined> {
		const leaf = await this.prepareViewLeaf(selectedPath, targetLeaf);

		if (!leaf) {
			new Notice(`${this.settings.tavernName} could not open a workspace leaf.`);
			return undefined;
		}

		this.app.workspace.revealLeaf(leaf);
		return leaf;
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
		targetLeaf: WorkspaceLeaf | undefined,
	): Promise<WorkspaceLeaf | undefined> {
		if (targetLeaf) {
			await targetLeaf.setViewState(createTavernViewState(selectedPath, 'note'));
			return targetLeaf;
		}

		const existingLeaves = this.app.workspace.getLeavesOfType(TAVERN_VIEW_TYPE);
		const leaf = existingLeaves[FIRST_LEAF_INDEX] ?? this.app.workspace.getLeaf('tab') ?? undefined;
		if (selectedPath || existingLeaves.length === EMPTY_LEAF_COUNT) {
			await leaf?.setViewState(createTavernViewState(selectedPath, this.viewMode(selectedPath)));
		}

		return leaf;
	}

	private viewMode(selectedPath: string | undefined) {
		if (selectedPath) {
			return 'note';
		}

		return 'board';
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
		if (!file) {
			new Notice(`${this.settings.tavernName} needs an active note to mark as a project.`);
			return;
		}

		await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
			frontmatter.tavern = 'project';
		});
		await this.activateView(file.path, this.app.workspace.activeLeaf ?? undefined);
	}

	private isTavernProjectFile(file: TFile): boolean {
		const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
		return shouldOpenTavernProjectFile(frontmatter);
	}
}

const isTavernViewWithTaskSearch = (view: unknown): view is Pick<TavernView, 'openTaskSearch'> =>
	typeof view === 'object' &&
	view !== null &&
	'openTaskSearch' in view &&
	typeof view.openTaskSearch === 'function';

export default TavernPlugin;
