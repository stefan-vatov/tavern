/* eslint-disable eslint/func-style */
import {
	filterProjects,
	projectTasks,
	selectedProjectTasks,
	type ProjectBoardTask,
	type ProjectLibrary,
	type ProjectSummary,
} from './project-library';

const EMPTY_LENGTH = 0;
const FIRST_PROJECT_INDEX = 0;

type ProjectBoardModelInput = {
	boardTaskKeys: string[];
	library: ProjectLibrary;
	query: string;
	selectedPath: string;
};

type ProjectBoardModel = {
	doneTaskCount: number;
	focusTasks: ProjectBoardTask[];
	openTaskCount: number;
	selectedProject: ProjectSummary | undefined;
	visibleProjects: ProjectSummary[];
};

const createProjectBoardModel = (input: ProjectBoardModelInput): ProjectBoardModel => {
	const tasks = projectTasks(input.library);
	return {
		doneTaskCount: tasks.filter((task) => task.checked).length,
		focusTasks: selectedProjectTasks(input.library, input.boardTaskKeys),
		openTaskCount: tasks.filter((task) => !task.checked).length,
		selectedProject: selectedProject(input.library, input.selectedPath),
		visibleProjects: filterProjects(input.library, input.query),
	};
};

const addTaskToFocusQueue = (boardTaskKeys: string[], key: string): string[] => {
	if (key.length === EMPTY_LENGTH || boardTaskKeys.includes(key)) {
		return boardTaskKeys;
	}

	return [...boardTaskKeys, key];
};

const removeTaskFromFocusQueue = (boardTaskKeys: string[], key: string): string[] => {
	if (key.length === EMPTY_LENGTH) {
		return boardTaskKeys;
	}

	return boardTaskKeys.filter((item) => item !== key);
};

const selectedProject = (
	library: ProjectLibrary,
	selectedPath: string,
): ProjectSummary | undefined =>
	library.projects.find((project) => project.path === selectedPath) ??
	library.projects[FIRST_PROJECT_INDEX];

export { addTaskToFocusQueue, createProjectBoardModel, removeTaskFromFocusQueue };
