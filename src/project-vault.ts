/* eslint-disable eslint/func-names, eslint/func-style, eslint/new-cap */
import { Data, Effect } from 'effect';
import {
	addProjectTask,
	addProjectTaskPlan,
	completeProjectTask,
	deleteProjectTask,
	editProjectTask,
	editProjectTaskPlan,
	moveProjectTask,
	moveProjectTaskToPosition,
	reorderProjectTask,
	type ProjectActionError,
} from './project-actions';
import {
	buildProjectLibrary,
	type ProjectBoardTask,
	type ProjectLibrary,
	type ProjectSourceFile,
} from './project-library';
import type { ProjectTaskDropPlacement, ProjectTaskReorderDirection } from './project-note';
import type { TaskEditPlan } from './task-edit';

type ProjectVaultFile = {
	path: string;
};

type ProjectVault = {
	getMarkdownFiles: () => ProjectVaultFile[];
	modify: (file: ProjectVaultFile, markdown: string) => Promise<void>;
	read: (file: ProjectVaultFile) => Promise<string>;
};

type AddVaultProjectTaskInput = {
	projectPath: string;
	sectionName: string;
	taskText: string;
	vault: ProjectVault;
};
type MoveVaultProjectTaskToPositionInput = {
	placement: ProjectTaskDropPlacement;
	sourceTask: ProjectBoardTask | undefined;
	targetTask: ProjectBoardTask | undefined;
	vault: ProjectVault;
};

class ProjectVaultError extends Data.TaggedError('ProjectVaultError')<{
	message: string;
	path?: string;
}> {}

type VaultActionError = ProjectActionError | ProjectVaultError;

const loadVaultProjectLibrary = (
	vault: ProjectVault,
	folders: string[],
): Effect.Effect<ProjectLibrary, ProjectVaultError> =>
	Effect.forEach(vault.getMarkdownFiles(), (file) =>
		Effect.tryPromise({
			catch: () =>
				new ProjectVaultError({
					message: 'Unable to read project file.',
					path: file.path,
				}),
			try: async () => ({
				markdown: await vault.read(file),
				path: file.path,
			}),
		}).pipe(
			/* eslint-disable eslint/no-console, promise/prefer-await-to-callbacks */
			/* c8 ignore next -- degradation log for read errors (per-file graceful in load; action reads still fail hard) */
			Effect.catchAll((error) => {
				console.warn(`Tavern: failed to read file at ${file.path}:`, error);
				return Effect.succeed(undefined);
			}),
			/* eslint-enable eslint/no-console, promise/prefer-await-to-callbacks */
		),
	).pipe(
		Effect.flatMap((files) =>
			buildProjectLibrary({
				files: files.filter((file): file is ProjectSourceFile => file !== undefined),
				folders,
			}),
		),
	);

const addVaultProjectTask = ({
	projectPath,
	sectionName,
	taskText,
	vault,
}: AddVaultProjectTaskInput): Effect.Effect<void, VaultActionError> =>
	updateProjectSource(vault, projectPath, (markdown) =>
		addProjectTask(markdown, sectionName, taskText),
	);

const completeVaultProjectTask = (
	vault: ProjectVault,
	task: ProjectBoardTask | undefined,
): Effect.Effect<void, VaultActionError> =>
	updateTaskSource(vault, task, (markdown, taskId) => completeProjectTask(markdown, taskId));

const deleteVaultProjectTask = (
	vault: ProjectVault,
	task: ProjectBoardTask | undefined,
): Effect.Effect<void, VaultActionError> =>
	updateTaskSource(vault, task, (markdown, taskId) => deleteProjectTask(markdown, taskId));

const editVaultProjectTask = (
	vault: ProjectVault,
	task: ProjectBoardTask | undefined,
	taskText: string,
): Effect.Effect<void, VaultActionError> =>
	updateTaskSource(vault, task, (markdown, taskId) => editProjectTask(markdown, taskId, taskText));

const editVaultProjectTaskPlan = (
	vault: ProjectVault,
	task: ProjectBoardTask | undefined,
	plan: TaskEditPlan,
): Effect.Effect<Map<string, string>, VaultActionError> =>
	Effect.gen(function* () {
		if (!task) {
			return yield* new ProjectVaultError({ message: 'Task was not provided.' });
		}
		return yield* updateProjectSourceResult(vault, task.projectPath, (markdown) =>
			editProjectTaskPlan(markdown, task.id, plan).pipe(
				Effect.map(({ markdown: next, mapping }) => ({ markdown: next, result: mapping })),
			),
		);
	});

const addVaultProjectTaskPlan = ({
	vault,
	projectPath,
	sectionName,
	plan,
}: {
	vault: ProjectVault;
	projectPath: string;
	sectionName: string;
	plan: TaskEditPlan;
}): Effect.Effect<Map<string, string>, VaultActionError> =>
	updateProjectSourceResult(vault, projectPath, (markdown) =>
		addProjectTaskPlan(markdown, sectionName, plan).pipe(
			Effect.map(({ markdown: next, mapping }) => ({ markdown: next, result: mapping })),
		),
	);

const moveVaultProjectTask = (
	vault: ProjectVault,
	task: ProjectBoardTask | undefined,
	targetSectionName: string,
): Effect.Effect<void, VaultActionError> =>
	updateTaskSource(vault, task, (markdown, taskId) =>
		moveProjectTask(markdown, taskId, targetSectionName),
	);

const moveVaultProjectTaskToPosition = ({
	placement,
	sourceTask,
	targetTask,
	vault,
}: MoveVaultProjectTaskToPositionInput): Effect.Effect<void, VaultActionError> =>
	Effect.gen(function* () {
		if (!sourceTask || !targetTask) {
			return yield* new ProjectVaultError({ message: 'Task was not provided.' });
		}
		if (sourceTask.projectPath !== targetTask.projectPath) {
			return yield* new ProjectVaultError({
				message: 'Tasks must belong to the same project.',
				path: sourceTask.projectPath,
			});
		}

		return yield* updateProjectSource(vault, sourceTask.projectPath, (markdown) =>
			moveProjectTaskToPosition({
				markdown,
				placement,
				sourceTaskId: sourceTask.id,
				targetTaskId: targetTask.id,
			}),
		);
	});

const reorderVaultProjectTask = (
	vault: ProjectVault,
	task: ProjectBoardTask | undefined,
	direction: ProjectTaskReorderDirection,
): Effect.Effect<void, VaultActionError> =>
	updateTaskSource(vault, task, (markdown, taskId) =>
		reorderProjectTask(markdown, taskId, direction),
	);

const updateTaskSource = (
	vault: ProjectVault,
	task: ProjectBoardTask | undefined,
	updateMarkdown: (markdown: string, taskId: string) => Effect.Effect<string, ProjectActionError>,
): Effect.Effect<void, VaultActionError> =>
	Effect.gen(function* () {
		if (!task) {
			return yield* new ProjectVaultError({ message: 'Task was not provided.' });
		}

		return yield* updateProjectSource(vault, task.projectPath, (markdown) =>
			updateMarkdown(markdown, task.id),
		);
	});

const updateProjectSource = (
	vault: ProjectVault,
	projectPath: string,
	updateMarkdown: (markdown: string) => Effect.Effect<string, ProjectActionError>,
): Effect.Effect<void, VaultActionError> =>
	updateProjectSourceResult(vault, projectPath, (markdown) =>
		updateMarkdown(markdown).pipe(Effect.map((next) => ({ markdown: next, result: undefined }))),
	);

const updateProjectSourceResult = <Result>(
	vault: ProjectVault,
	projectPath: string,
	updateMarkdown: (
		markdown: string,
	) => Effect.Effect<{ markdown: string; result: Result }, ProjectActionError>,
): Effect.Effect<Result, VaultActionError> =>
	Effect.gen(function* () {
		const file = findFileByPath(vault, projectPath);
		if (!file) {
			return yield* new ProjectVaultError({
				message: 'Project file was not found.',
				path: projectPath,
			});
		}

		const currentMarkdown = yield* Effect.tryPromise({
			catch: () =>
				new ProjectVaultError({
					message: 'Unable to read project file.',
					path: projectPath,
				}),
			try: () => vault.read(file),
		});
		const next = yield* updateMarkdown(currentMarkdown);

		yield* Effect.tryPromise({
			catch: () =>
				new ProjectVaultError({
					message: 'Unable to write project file.',
					path: projectPath,
				}),
			try: () => vault.modify(file, next.markdown),
		});
		return next.result;
	});

const findFileByPath = (vault: ProjectVault, path: string): ProjectVaultFile | undefined =>
	vault.getMarkdownFiles().find((file) => {
		// inline same 3-line normalizePath logic from project-library (no new export/refactor)
		const norm = (str: string) =>
			str
				.trim()
				.replace(/\\/g, '/')
				.replace(/^\/+|\/+$/g, '');
		return norm(file.path) === norm(path);
	});

export {
	addVaultProjectTask,
	addVaultProjectTaskPlan,
	completeVaultProjectTask,
	deleteVaultProjectTask,
	editVaultProjectTask,
	editVaultProjectTaskPlan,
	loadVaultProjectLibrary,
	moveVaultProjectTask,
	moveVaultProjectTaskToPosition,
	ProjectVaultError,
	reorderVaultProjectTask,
};
export type { ProjectVault, ProjectVaultFile, VaultActionError };
