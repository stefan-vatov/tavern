import { App, PluginSettingTab, Setting } from 'obsidian';
import { DEFAULT_SETTINGS } from './settings-defaults';
import { normalizeTavernName, parseProjectFolders } from './settings-model';
import TavernPlugin from './main';

export class TavernSettingTab extends PluginSettingTab {
	plugin: TavernPlugin;

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
