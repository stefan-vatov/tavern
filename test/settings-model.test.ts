import { normalizeTavernName, parseProjectFolders } from '../src/settings-model';

describe('settings model', () => {
	it('should fall back to the default name when the custom name is blank', () => {
		expect(normalizeTavernName('  ')).toBe('Tavern');
		expect(normalizeTavernName(' Project Pub ')).toBe('Project Pub');
	});

	it('should parse comma-separated project folders', () => {
		expect(parseProjectFolders('04_Projects, 05_Areas,, ')).toEqual(['04_Projects', '05_Areas']);
	});

	it('should fall back to default project folders when the value is blank', () => {
		expect(parseProjectFolders(' , ')).toEqual(['04_Projects']);
	});
});
