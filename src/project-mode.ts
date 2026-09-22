const TAVERN_VIEW_TYPE = 'tavern-view';

const createTavernViewState = (selectedPath?: string) => {
	let boardPage = 'global';
	if (selectedPath) {
		boardPage = 'project';
	}
	return {
		active: true,
		state: { boardPage, selectedPath },
		type: TAVERN_VIEW_TYPE,
	};
};

export { createTavernViewState, TAVERN_VIEW_TYPE };
