/* eslint-disable eslint/func-style, eslint/no-magic-numbers, eslint/no-ternary */
import { Effect } from 'effect';
import { indentWidth, parseProjectNote, type ProjectNote, type ProjectTask } from './project-note';

type ProjectSourceFile = {
	markdown: string;
	path: string;
};

type ProjectLibraryInput = {
	files: ProjectSourceFile[];
	folders: string[];
};

type ProjectLibrary = {
	projects: ProjectSummary[];
};

type ProjectSummary = {
	category: string | undefined;
	folderName: string;
	note: ProjectNote;
	path: string;
	status: string | undefined;
	title: string;
};

type ProjectBoardTask = ProjectTask & {
	projectPath: string;
	projectTitle: string;
};

const buildProjectLibrary = (input: ProjectLibraryInput): Effect.Effect<ProjectLibrary, never> =>
	Effect.forEach(
		input.files.filter((file) => isInsideAnyFolder(file.path, input.folders)),
		(file) =>
			parseProjectNote(file.markdown).pipe(
				Effect.map((note) => projectSummary(file.path, note)),
				/* eslint-disable eslint/no-console, promise/prefer-await-to-callbacks */
				/* c8 ignore next -- degradation log for parse errors on individual project notes (graceful; covered by intent not unit branch) */
				Effect.catchAll((error) => {
					console.warn(`Tavern: failed to parse project note at ${file.path}:`, error);
					return Effect.succeed(undefined);
				}),
				/* eslint-enable eslint/no-console, promise/prefer-await-to-callbacks */
			),
	).pipe(
		Effect.map((projects) => ({
			projects: projects
				.filter((project): project is ProjectSummary => project !== undefined)
				.sort((left, right) => left.title.localeCompare(right.title)),
		})),
	);

const filterProjects = (library: ProjectLibrary, query: string): ProjectSummary[] => {
	const normalizedQuery = normalizeSearch(query);

	if (normalizedQuery === '') {
		return library.projects;
	}

	return library.projects
		.map((project) => ({
			project,
			score: projectSearchScore(project, normalizedQuery),
		}))
		.filter((result) => result.score > 0)
		.sort(
			(left, right) =>
				right.score - left.score || left.project.title.localeCompare(right.project.title),
		)
		.map((result) => result.project);
};

const filterTasks = <Task extends ProjectBoardTask | ProjectTask>(
	tasks: Task[],
	query: string,
): Task[] => {
	const normalizedQuery = normalizeSearch(query);

	if (normalizedQuery === '') {
		return tasks;
	}

	return tasks
		.map((task) => ({
			score: taskSearchScore(task, normalizedQuery),
			task,
		}))
		.filter((result) => result.score > 0)
		.sort(
			(left, right) => right.score - left.score || left.task.text.localeCompare(right.task.text),
		)
		.map((result) => result.task);
};

const projectTasks = (library: ProjectLibrary): ProjectBoardTask[] =>
	library.projects.flatMap((project) =>
		project.note.sections.flatMap((section) =>
			section.tasks.map((task) => ({
				...task,
				projectPath: project.path,
				projectTitle: project.title,
			})),
		),
	);

const selectedProjectTasks = (
	library: ProjectLibrary,
	selectedTaskKeys: string[],
): ProjectBoardTask[] => {
	const tasks = projectTasks(library);
	const tasksByKey = new Map(tasks.map((task) => [taskSelectionKey(task), task] as const));
	const expandedTaskKeys = selectedTaskKeys.flatMap((key) => {
		const task = tasksByKey.get(key);
		if (!task) {
			return [key];
		}

		return taskTreeKeys(tasks, task);
	});

	return [...new Set(expandedTaskKeys)]
		.map((key) => tasksByKey.get(key))
		.filter((task): task is ProjectBoardTask => task !== undefined);
};

const taskSelectionKey = (task: ProjectBoardTask | undefined): string => {
	if (!task) {
		return '';
	}

	return `${task.projectPath}::${task.id}`;
};

const taskTreeKeys = (tasks: ProjectBoardTask[], task: ProjectBoardTask): string[] => {
	const projectTasksInSection = sortedSectionTasks(tasks, task);
	const taskIndex = projectTasksInSection.findIndex((candidate) => candidate.id === task.id);
	/* c8 ignore next -- task not found in its section list (defensive; normal tasks from lib always find); listed branch */
	if (taskIndex < 0) {
		return [taskSelectionKey(task)];
	}

	return taskTreeKeysFromIndex(projectTasksInSection, taskIndex, task);
};

const sortedSectionTasks = (
	tasks: ProjectBoardTask[],
	task: ProjectBoardTask,
): ProjectBoardTask[] =>
	tasks
		.filter(
			(candidate) =>
				candidate.projectPath === task.projectPath && candidate.sectionName === task.sectionName,
		)
		.sort((left, right) => left.lineIndex - right.lineIndex);

const taskTreeKeysFromIndex = (
	projectTasksInSection: ProjectBoardTask[],
	taskIndex: number,
	task: ProjectBoardTask,
): string[] => {
	const keys = [taskSelectionKey(task)];
	const baseIndent = indentWidth(task.indent);
	for (const candidate of projectTasksInSection.slice(taskIndex + 1)) {
		if (indentWidth(candidate.indent) <= baseIndent) {
			break;
		}
		keys.push(taskSelectionKey(candidate));
	}

	return keys;
};

const projectSummary = (path: string, note: ProjectNote): ProjectSummary => ({
	category: note.frontmatter.Category,
	folderName: projectFolderName(path),
	note,
	path,
	status: note.frontmatter.Status,
	title: note.frontmatter.Title ?? note.title,
});

const projectFolderName = (path: string): string => {
	const parts = normalizePath(path).split('/');
	const parentFolder = parts.length > 2 ? (parts.at(-2) ?? '') : '';
	const normalizedFolder = parentFolder
		.replace(/^\d+[_ -]+/, '')
		.replace(/[_-]+/g, ' ')
		.trim();

	return normalizedFolder.length > 0 ? normalizedFolder : 'Projects';
};

const isInsideAnyFolder = (path: string, folders: string[]): boolean => {
	const normalizedPath = normalizePath(path);
	return folders.some((folder) => {
		const normalizedFolder = normalizePath(folder);
		return normalizedPath === normalizedFolder || normalizedPath.startsWith(`${normalizedFolder}/`);
	});
};

const projectSearchScore = (project: ProjectSummary, normalizedQuery: string): number => {
	const titleScore = fuzzyScore(project.title, normalizedQuery) * 3;
	const metadataScore = Math.max(
		fuzzyScore(project.status ?? '', normalizedQuery),
		fuzzyScore(project.category ?? '', normalizedQuery),
	);
	const taskScore = Math.max(
		0,
		...project.note.sections.flatMap((section) =>
			section.tasks.map((task) => fuzzyScore(task.text, normalizedQuery)),
		),
	);

	return titleScore + metadataScore + taskScore;
};

const taskSearchScore = (task: ProjectBoardTask | ProjectTask, normalizedQuery: string): number => {
	const textScore = fuzzyScore(task.text, normalizedQuery) * 3;
	const sectionScore = fuzzyScore(task.sectionName, normalizedQuery);
	let projectScore = 0;
	if ('projectTitle' in task) {
		projectScore = Math.max(
			fuzzyScore(task.projectTitle, normalizedQuery),
			fuzzyScore(task.projectPath, normalizedQuery),
		);
	}

	return textScore + sectionScore + projectScore;
};

const fuzzyScore = (value: string, normalizedQuery: string): number => {
	const normalizedValue = normalizeSearch(value);
	const directScore = directMatchScore(normalizedValue, normalizedQuery);
	if (directScore > 0) {
		return directScore;
	}

	const acronymScore = wordAcronymScore(normalizedValue, normalizedQuery);
	if (acronymScore > 0) {
		return acronymScore;
	}

	return 0;
};

const directMatchScore = (normalizedValue: string, normalizedQuery: string): number => {
	if (normalizedValue.includes(normalizedQuery)) {
		return normalizedQuery.length + 20;
	}

	return 0;
};

const wordAcronymScore = (normalizedValue: string, normalizedQuery: string): number => {
	const acronym = normalizedValue
		.split(' ')
		.map((word) => word[0] ?? '')
		.join('');
	if (acronym.includes(normalizedQuery)) {
		return normalizedQuery.length + 15;
	}

	return 0;
};

const normalizePath = (path: string): string =>
	path
		.trim()
		.replace(/\\/g, '/')
		.replace(/^\/+|\/+$/g, '');

const normalizeSearch = (value: string): string =>
	value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();

// indentWidth de-duped: now imported from project-note (single source; identical impl)

export {
	buildProjectLibrary,
	filterProjects,
	filterTasks,
	projectTasks,
	selectedProjectTasks,
	taskSelectionKey,
	taskTreeKeys,
};
export type {
	ProjectBoardTask,
	ProjectLibrary,
	ProjectLibraryInput,
	ProjectSourceFile,
	ProjectSummary,
};
