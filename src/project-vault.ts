/* eslint-disable eslint/func-names, eslint/func-style, eslint/new-cap */
import { Data, Effect } from 'effect';
import {
	addProjectTask,
	completeProjectTask,
	deleteProjectTask,
	editProjectTask,
	moveProjectTask,
	moveProjectTaskToPosition,
	reorderProjectTask,
	type ProjectActionError,
} from './project-actions';
import { buildProjectLibrary, type ProjectBoardTask, type ProjectLibrary } from './project-library';
import type { ProjectTaskDropPlacement, ProjectTaskReorderDirection } from './project-note';

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
		}),
	).pipe(Effect.flatMap((files) => buildProjectLibrary({ files, folders })));

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
		const nextMarkdown = yield* updateMarkdown(currentMarkdown);

		return yield* Effect.tryPromise({
			catch: () =>
				new ProjectVaultError({
					message: 'Unable to write project file.',
					path: projectPath,
				}),
			try: () => vault.modify(file, nextMarkdown),
		});
	});

const findFileByPath = (vault: ProjectVault, path: string): ProjectVaultFile | undefined =>
	vault.getMarkdownFiles().find((file) => file.path === path);

export {
	addVaultProjectTask,
	completeVaultProjectTask,
	deleteVaultProjectTask,
	editVaultProjectTask,
	loadVaultProjectLibrary,
	moveVaultProjectTask,
	moveVaultProjectTaskToPosition,
	ProjectVaultError,
	reorderVaultProjectTask,
};
export type { ProjectVault, ProjectVaultFile, VaultActionError };
