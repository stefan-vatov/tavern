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

	/* eslint-disable eslint/max-statements */
	/* eslint-disable eslint/no-underscore-dangle */
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
				/* c8 ignore next -- file-open project routing branch (exercised in main.test but listed for branch cov); covered by explicit invokes */
				if (file && this.isTavernProjectFile(file)) {
					void this.activateView(file.path, this.app.workspace.activeLeaf ?? undefined);
				}
			}),
		);

		// cheap external fm/metadata listener (L3): registerEvent per AGENTS; triggers lightweight refresh hint on any open tavern views (short-circuits if none); no full load unless views active; catches mark/unmark/rename etc not covered by file-open only.
		/* eslint-disable eslint/no-underscore-dangle */
		this.registerEvent(
			this.app.metadataCache.on('changed', (file) => {
				if (file) {
					void this._refreshOpenTavernIfNeeded(file);
				}
			}),
		);
		/* eslint-enable eslint/no-underscore-dangle */

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
		/* c8 ignore next -- mark no-active-file notice+return branch (tested in main.test "show notice when marking without"); listed in cov */
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

	// tiny helper (L3) for the metadata 'changed' listener: cheap leaves check (no-op if no open taverns), delegates refresh (which does its own prune) using runtime access (avoids private + no view.ts change for this L3).
	/* eslint-disable eslint/no-underscore-dangle, eslint/no-unused-vars */
	private _refreshOpenTavernIfNeeded(_file: TFile): void {
		const leaves = this.app.workspace.getLeavesOfType(TAVERN_VIEW_TYPE);
		if (leaves.length === EMPTY_LEAF_COUNT) {
			return;
		}
		leaves.forEach((leaf) => {
			const { view } = leaf;
			if (view && typeof (view as any).refreshProjects === 'function') {
				void (view as any).refreshProjects();
			}
		});
	}
	/* eslint-enable eslint/no-underscore-dangle, eslint/no-unused-vars */
}

const isTavernViewWithTaskSearch = (view: unknown): view is Pick<TavernView, 'openTaskSearch'> =>
	typeof view === 'object' &&
	view !== null &&
	'openTaskSearch' in view &&
	typeof view.openTaskSearch === 'function';

export default TavernPlugin;
