import { Effect } from 'effect';
import {
	addTaskToSection,
	completeTask,
	deleteTask,
	editTaskText,
	moveTaskToPosition,
	moveTaskToSection,
	parseProjectNote,
	reorderTask,
	serializeProjectNote,
	type ProjectNoteParseError,
	type ProjectTaskError,
	type ProjectTaskDropPlacement,
	type ProjectTaskReorderDirection,
} from './project-note';

type ProjectActionError = ProjectNoteParseError | ProjectTaskError;
type MoveProjectTaskToPositionInput = {
	markdown: string;
	placement: ProjectTaskDropPlacement;
	sourceTaskId: string;
	targetTaskId: string;
};

const completeProjectTask = (
	markdown: string,
	taskId: string,
): Effect.Effect<string, ProjectActionError> =>
	parseProjectNote(markdown).pipe(
		Effect.flatMap((note) => completeTask(note, taskId)),
		Effect.map(serializeProjectNote),
	);

const addProjectTask = (
	markdown: string,
	sectionName: string,
	taskText: string,
): Effect.Effect<string, ProjectActionError> =>
	parseProjectNote(markdown).pipe(
		Effect.flatMap((note) => addTaskToSection(note, sectionName, taskText)),
		Effect.map(serializeProjectNote),
	);

const moveProjectTask = (
	markdown: string,
	taskId: string,
	targetSectionName: string,
): Effect.Effect<string, ProjectActionError> =>
	parseProjectNote(markdown).pipe(
		Effect.flatMap((note) => moveTaskToSection(note, taskId, targetSectionName)),
		Effect.map(serializeProjectNote),
	);

const moveProjectTaskToPosition = ({
	markdown,
	placement,
	sourceTaskId,
	targetTaskId,
}: MoveProjectTaskToPositionInput): Effect.Effect<string, ProjectActionError> =>
	parseProjectNote(markdown).pipe(
		Effect.flatMap((note) => moveTaskToPosition({ note, placement, sourceTaskId, targetTaskId })),
		Effect.map(serializeProjectNote),
	);

const deleteProjectTask = (
	markdown: string,
	taskId: string,
): Effect.Effect<string, ProjectActionError> =>
	parseProjectNote(markdown).pipe(
		Effect.flatMap((note) => deleteTask(note, taskId)),
		Effect.map(serializeProjectNote),
	);

const editProjectTask = (
	markdown: string,
	taskId: string,
	taskText: string,
): Effect.Effect<string, ProjectActionError> =>
	parseProjectNote(markdown).pipe(
		Effect.flatMap((note) => editTaskText(note, taskId, taskText)),
		Effect.map(serializeProjectNote),
	);

const reorderProjectTask = (
	markdown: string,
	taskId: string,
	direction: ProjectTaskReorderDirection,
): Effect.Effect<string, ProjectActionError> =>
	parseProjectNote(markdown).pipe(
		Effect.flatMap((note) => reorderTask(note, taskId, direction)),
		Effect.map(serializeProjectNote),
	);

export {
	addProjectTask,
	completeProjectTask,
	deleteProjectTask,
	editProjectTask,
	moveProjectTask,
	moveProjectTaskToPosition,
	reorderProjectTask,
};
export type { ProjectActionError };
