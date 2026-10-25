import {
	App,
	FuzzySuggestModal,
	Notice,
	PluginSettingTab,
	Setting,
	type TFile,
	type TextComponent,
} from 'obsidian';
import { DEFAULT_SETTINGS } from './settings-defaults';
import { normalizeTavernName, parseProjectFolders } from './settings-model';
import TavernPlugin from './main';

class DailyTemplatePicker extends FuzzySuggestModal<TFile> {
	constructor(
		app: App,
		private readonly choose: (file: TFile) => Promise<void>,
	) {
		super(app);
		this.setPlaceholder('Choose a daily log template');
	}

	getItems(): TFile[] {
		return this.app.vault.getMarkdownFiles();
	}

	getItemText(file: TFile): string {
		return file.path;
	}

	onChooseItem(file: TFile): void {
		void this.choose(file);
	}
}

export class TavernSettingTab extends PluginSettingTab {
	plugin: TavernPlugin;
	private templateSave = Promise.resolve();
	private templateSelection = Symbol();

	constructor(app: App, plugin: TavernPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Tavern name')
			.setDesc('The name shown by commands and notices.')
			.addText((text) =>
				text
					.setPlaceholder('Tavern')
					.setValue(this.plugin.settings.tavernName)
					.onChange(async (value) => {
						this.plugin.settings.tavernName = normalizeTavernName(value);
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Daily log folder')
			.setDesc('Daily logs are stored here as YYYY/MM/YYYY-MM-DD.md.')
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.dailyLogFolder ?? '')
					.setValue(this.plugin.settings.dailyLogFolder ?? DEFAULT_SETTINGS.dailyLogFolder ?? '')
					.onChange(async (value) => {
						this.plugin.settings.dailyLogFolder = value.trim().replace(/^\/+|\/+$/g, '');
						await this.plugin.saveSettings();
					}),
			);

		let templateInput: TextComponent | undefined = undefined;
		const saveTemplate = (value: string) => {
			const selection = Symbol();
			this.templateSelection = selection;
			const previousSave = this.templateSave;
			this.templateSave = (async () => {
				await previousSave;
				const previous = this.plugin.settings.dailyLogTemplate ?? '';
				this.plugin.settings.dailyLogTemplate = value.trim();
				try {
					await this.plugin.saveSettings();
				} catch (error) {
					this.plugin.settings.dailyLogTemplate = previous;
					new Notice(`Tavern could not save the daily log template: ${String(error)}`);
				}
				if (this.templateSelection === selection) {
					templateInput?.setValue(this.plugin.settings.dailyLogTemplate);
				}
			})();
			return this.templateSave;
		};
		new Setting(containerEl)
			.setName('Daily log template')
			.setDesc(
				'Choose a Markdown template from this vault. Creating a log requires enabled Templater.',
			)
			.addText((text) => {
				templateInput = text;
				text
					.setPlaceholder('Templates/Daily log.md')
					.setValue(this.plugin.settings.dailyLogTemplate ?? '')
					.onChange(saveTemplate);
			})
			.addButton((button) =>
				button.setButtonText('Choose').onClick(() => {
					new DailyTemplatePicker(this.app, (file) => saveTemplate(file.path)).open();
				}),
			);

		new Setting(containerEl)
			.setName('Project source folders')
			.setDesc('Comma-separated vault folders Tavern scans for project notes, such as 04_Projects.')
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.projectFolders.join(', '))
					.setValue(this.plugin.settings.projectFolders.join(', '))
					.onChange(async (value) => {
						this.plugin.settings.projectFolders = parseProjectFolders(value);
						await this.plugin.saveSettings();
					}),
			);
	}
}

export { DEFAULT_SETTINGS };
