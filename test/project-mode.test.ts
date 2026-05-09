import {
	createTavernViewState,
	shouldOpenTavernProjectFile,
	TAVERN_VIEW_TYPE,
} from '../src/project-mode';

describe('project mode', () => {
	it('should identify tavern project frontmatter', () => {
		expect(shouldOpenTavernProjectFile({ tavern: 'project' })).toBe(true);
		expect(shouldOpenTavernProjectFile({ tavern: 'note' })).toBe(false);
		expect(shouldOpenTavernProjectFile(undefined)).toBe(false);
	});

	it('should create a view state without selected project state by default', () => {
		expect(createTavernViewState()).toEqual({
			active: true,
			state: { mode: 'board', selectedPath: undefined },
			type: TAVERN_VIEW_TYPE,
		});
	});

	it('should create a view state with the selected project path', () => {
		expect(createTavernViewState('04_Projects/Pi.md')).toEqual({
			active: true,
			state: { mode: 'note', selectedPath: '04_Projects/Pi.md' },
			type: TAVERN_VIEW_TYPE,
		});
	});
});
