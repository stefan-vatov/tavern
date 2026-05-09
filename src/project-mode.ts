import { isTavernProjectFrontmatter } from './project-note';

const TAVERN_VIEW_TYPE = 'tavern-view';

type TavernViewState = {
	active: true;
	state: { mode: TavernViewMode; selectedPath?: string };
	type: typeof TAVERN_VIEW_TYPE;
};

type TavernViewMode = 'board' | 'note';

const shouldOpenTavernProjectFile = (frontmatter: unknown): boolean =>
	typeof frontmatter === 'object' &&
	frontmatter !== null &&
	isTavernProjectFrontmatter(frontmatter as Record<string, unknown>);

const createTavernViewState = (
	selectedPath?: string,
	mode: TavernViewMode = defaultModeForPath(selectedPath),
): TavernViewState => {
	const state = {
		active: true,
		state: { mode, selectedPath },
		type: TAVERN_VIEW_TYPE,
	} satisfies TavernViewState;

	return state;
};

const defaultModeForPath = (selectedPath?: string): TavernViewMode => {
	if (selectedPath) {
		return 'note';
	}

	return 'board';
};

export { createTavernViewState, shouldOpenTavernProjectFile, TAVERN_VIEW_TYPE };
export type { TavernViewMode };
