/* eslint-disable eslint/max-statements, eslint/no-magic-numbers, promise/prefer-await-to-callbacks */
import { vi } from 'vitest';
import { Notice } from 'obsidian';
import { TavernSettingTab } from '../src/settings';

type TextControl = {
	onChangeHandler?: (value: string) => Promise<void>;
	placeholder?: string;
	value?: string;
};

const { settingRecords, textControls, buttons, pickers } = vi.hoisted(() => ({
	buttons: [] as { click?: () => void }[],
	pickers: [] as {
		getItems: () => { path: string }[];
		getItemText: (file: { path: string }) => string;
		onChooseItem: (file: { path: string }) => void;
	}[],
	settingRecords: [] as { desc?: string; name?: string }[],
	textControls: [] as TextControl[],
}));

vi.mock('obsidian', () => ({
	App: class {},
	Component: class {},
	FuzzySuggestModal: class {
		constructor(readonly app: unknown) {}
		setPlaceholder() {}
		open() {
			pickers.push(this as never);
		}
	},
	ItemView: class {},
	Notice: vi.fn(),
	Plugin: class {},
	PluginSettingTab: class {
		containerEl: { empty: () => void };

		constructor(readonly app: { containerEl: { empty: () => void } }) {
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

		addButton(callback: (button: unknown) => void) {
			const control: { click?: () => void } = {};
			const button = {
				setButtonText: () => button,
				onClick: (handler: () => void) => {
					control.click = handler;
					return button;
				},
			};
			buttons.push(control);
			callback(button);
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
	beforeEach(() => {
		settingRecords.length = 0;
		textControls.length = 0;
		buttons.length = 0;
		pickers.length = 0;
	});
	it('should render settings and persist normalized values', async () => {
		const empty = vi.fn();
		const saveSettings = vi.fn();
		const plugin = {
			saveSettings,
			settings: {
				boardTaskKeys: [],
				dailyLogFolder: '02_Daily_Log/Daily_Log',
				projectFolders: ['04_Projects'],
				sidebarCollapsedSections: [],
				tavernName: 'Tavern',
			},
		};
		const tab = new TavernSettingTab({ containerEl: { empty } } as never, plugin as never);

		tab.display();
		await textControls[0]?.onChangeHandler?.(' Project Pub ');
		await textControls[1]?.onChangeHandler?.(' /Daily Notes/Logs/ ');
		await textControls[3]?.onChangeHandler?.('04_Projects, 05_Areas,, ');

		expect(empty).toHaveBeenCalled();
		expect(settingRecords.map((record) => record.name)).toEqual([
			'Tavern name',
			'Daily log folder',
			'Daily log template',
			'Project source folders',
		]);
		expect(settingRecords[3]?.desc).toBe(
			'Comma-separated vault folders Tavern scans for project notes, such as 04_Projects.',
		);
		expect(textControls.map((control) => control.value)).toEqual([
			'Tavern',
			'02_Daily_Log/Daily_Log',
			'',
			'04_Projects',
		]);
		expect(plugin.settings.dailyLogFolder).toBe('Daily Notes/Logs');
		expect(plugin.settings.tavernName).toBe('Project Pub');
		expect(plugin.settings.projectFolders).toEqual(['04_Projects', '05_Areas']);
		expect(saveSettings).toHaveBeenCalledTimes(3);
	});
	it('chooses a vault template, persists its path and restores it if saving fails', async () => {
		const template = { path: 'Templates/Captains log.md' };
		const saveSettings = vi.fn().mockResolvedValue(undefined);
		const plugin = {
			saveSettings,
			settings: { tavernName: 'Tavern', projectFolders: ['04_Projects'], dailyLogTemplate: '' },
		};
		const tab = new TavernSettingTab(
			{
				containerEl: { empty: vi.fn() },
				vault: { getMarkdownFiles: () => [template] },
			} as never,
			plugin as never,
		);
		tab.display();
		buttons[0]!.click!();
		const picker = pickers[0]!;
		expect(picker.getItems()).toEqual([template]);
		expect(picker.getItemText(template)).toBe(template.path);
		picker.onChooseItem(template);
		await vi.waitFor(() => expect(textControls[2]!.value).toBe(template.path));
		expect(plugin.settings.dailyLogTemplate).toBe(template.path);
		expect(saveSettings).toHaveBeenCalledTimes(1);
		saveSettings.mockRejectedValueOnce(new Error('Disk full'));
		await textControls[2]!.onChangeHandler!('Templates/Unsaved.md');
		expect(plugin.settings.dailyLogTemplate).toBe(template.path);
		expect(textControls[2]!.value).toBe(template.path);
		expect(Notice).toHaveBeenCalledWith(expect.stringContaining('Disk full'));
		await textControls[2]!.onChangeHandler!('  ');
		expect(plugin.settings.dailyLogTemplate).toBe('');
		expect(textControls[2]!.value).toBe('');
	});
	it('finishes older template saves before applying a newer selection after failure', async () => {
		let rejectFirst: (error: Error) => void = () => {};
		// eslint-disable-next-line promise/avoid-new -- Keep the first disk write pending while a later choice arrives.
		const pending = new Promise<void>((_resolve, reject) => {
			rejectFirst = reject;
		});
		const saveSettings = vi.fn().mockReturnValueOnce(pending).mockResolvedValue(undefined);
		const plugin = {
			saveSettings,
			settings: {
				tavernName: 'Tavern',
				projectFolders: [],
				dailyLogTemplate: 'Templates/Original.md',
			},
		};
		const tab = new TavernSettingTab({ containerEl: { empty: vi.fn() } } as never, plugin as never);
		tab.display();
		const change = textControls[2]!.onChangeHandler!;
		const first = change('Templates/Older.md');
		await Promise.resolve();
		const second = change('Templates/Newer.md');
		await Promise.resolve();
		expect(saveSettings).toHaveBeenCalledTimes(1);
		expect(plugin.settings.dailyLogTemplate).toBe('Templates/Older.md');
		rejectFirst(new Error('Older save failed'));
		await Promise.all([first, second]);
		expect(saveSettings).toHaveBeenCalledTimes(2);
		expect(plugin.settings.dailyLogTemplate).toBe('Templates/Newer.md');
		expect(textControls[2]!.value).toBe('Templates/Newer.md');
	});
});
