import { createTavernViewState, TAVERN_VIEW_TYPE } from '../src/project-mode';

describe('app navigation state', () => {
	it('opens the global queue by default', () => {
		expect(createTavernViewState()).toEqual({
			active: true,
			state: { boardPage: 'global', selectedPath: undefined },
			type: TAVERN_VIEW_TYPE,
		});
	});
	it('opens projects inside the same app shell', () => {
		expect(createTavernViewState('04_Projects/Pi.md')).toEqual({
			active: true,
			state: { boardPage: 'project', selectedPath: '04_Projects/Pi.md' },
			type: TAVERN_VIEW_TYPE,
		});
	});
});
