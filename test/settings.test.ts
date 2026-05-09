/* eslint-disable eslint/max-statements, eslint/no-magic-numbers, promise/prefer-await-to-callbacks */
import { vi } from 'vitest';
import { TavernSettingTab } from '../src/settings';

type TextControl = {
	onChangeHandler?: (value: string) => Promise<void>;
	placeholder?: string;
	value?: string;
};

const { settingRecords, textControls } = vi.hoisted(() => ({
	settingRecords: [] as { desc?: string; name?: string }[],
	textControls: [] as TextControl[],
}));

vi.mock('obsidian', () => ({
	App: class {},
	ItemView: class {},
	Notice: vi.fn(),
	Plugin: class {},
	PluginSettingTab: class {
		containerEl: { empty: () => void };

		constructor(app: { containerEl: { empty: () => void } }) {
			this.containerEl = app.containerEl;
		}
	},
	Setting: class {
		private readonly record: { desc?: string; name?: string };

		constructor() {
			this.record = {};
			settingRecords.push(this.record);
		}

		setName(value: string) {
			this.record.name = value;
			return this;
		}

		setDesc(value: string) {
			this.record.desc = value;
			return this;
		}

		addText(callback: (text: unknown) => void) {
			const control: TextControl = {};
			const text = {
				onChange: (handler: (value: string) => Promise<void>) => {
					control.onChangeHandler = handler;
					return text;
				},
				setPlaceholder: (value: string) => {
					control.placeholder = value;
					return text;
				},
				setValue: (value: string) => {
					control.value = value;
					return text;
				},
			};
			textControls.push(control);
			callback(text);
			return this;
		}
	},
	TFile: class {},
	setIcon: vi.fn(),
}));

describe('settings tab', () => {
	it('should render settings and persist normalized values', async () => {
		const empty = vi.fn();
		const saveSettings = vi.fn();
		const plugin = {
			saveSettings,
			settings: {
				boardTaskKeys: [],
				projectFolders: ['04_Projects'],
				sidebarCollapsedSections: [],
				tavernName: 'Tavern',
			},
		};
		const tab = new TavernSettingTab({ containerEl: { empty } } as never, plugin as never);

		tab.display();
		await textControls[0]?.onChangeHandler?.(' Project Pub ');
		await textControls[1]?.onChangeHandler?.('04_Projects, 05_Areas,, ');

		expect(empty).toHaveBeenCalled();
		expect(settingRecords.map((record) => record.name)).toEqual([
			'Tavern name',
			'Project source folders',
		]);
		expect(settingRecords[1]?.desc).toBe(
			'Comma-separated vault folders Tavern scans for project notes, such as 04_Projects.',
		);
		expect(textControls.map((control) => control.value)).toEqual(['Tavern', '04_Projects']);
		expect(plugin.settings.tavernName).toBe('Project Pub');
		expect(plugin.settings.projectFolders).toEqual(['04_Projects', '05_Areas']);
		expect(saveSettings).toHaveBeenCalledTimes(2);
	});
});
