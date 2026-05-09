import { DEFAULT_SETTINGS } from '../src/settings-defaults';

describe('default settings', () => {
	it('uses tavern as the default name', () => {
		expect(DEFAULT_SETTINGS.tavernName).toBe('Tavern');
	});

	it('scans the project folder by default', () => {
		expect(DEFAULT_SETTINGS.projectFolders).toEqual(['04_Projects']);
	});

	it('starts with an empty project board task list', () => {
		expect(DEFAULT_SETTINGS.boardTaskKeys).toEqual([]);
	});

	it('starts with no collapsed sidebar sections', () => {
		expect(DEFAULT_SETTINGS.sidebarCollapsedSections).toEqual([]);
	});
});
