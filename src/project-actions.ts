/* eslint-disable eslint/func-names, eslint/max-statements, eslint/no-magic-numbers, eslint/no-ternary */
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
	setTaskChecked,
	type ProjectNoteParseError,
	ProjectTaskError,
	type ProjectTaskDropPlacement,
	type ProjectTaskReorderDirection,
	type ProjectNote,
} from './project-note';
import {
	applyTaskDelete,
	applyTaskEdit,
	hasTaskEditContent,
	taskHasChildren,
	type TaskDeleteMode,
	type TaskEditPlan,
	type TaskEditResult,
} from './task-edit';

type ProjectActionError = ProjectNoteParseError | ProjectTaskError;
type ProjectTaskPlanResult = TaskEditResult & { mapping: Map<string, string> };
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

const setProjectTaskChecked = (
	markdown: string,
	taskId: string,
	checked: boolean,
): Effect.Effect<string, ProjectActionError> => {
	if (checked) {
		return completeProjectTask(markdown, taskId);
	}
	return parseProjectNote(markdown).pipe(
		Effect.flatMap((note) => setTaskChecked(note, taskId, false)),
		Effect.map(serializeProjectNote),
	);
};

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

const projectTaskLines = (note: ProjectNote): { id: string; lineIndex: number }[] => {
	let offset = note.frontmatterLines.length + note.preambleLines.length;
	return note.sections.flatMap((section) => {
		offset += 1;
		const tasks = section.tasks.map((task) => ({
			id: task.id,
			lineIndex: offset + task.lineIndex,
		}));
		offset += section.lines.length;
		return tasks;
	});
};

const projectTaskHasChildren = (note: ProjectNote, taskId: string): boolean => {
	const task = projectTaskLines(note).find((candidate) => candidate.id === taskId);
	return task ? taskHasChildren(serializeProjectNote(note), task.lineIndex) : false;
};

const editProjectTaskPlan = (
	markdown: string,
	taskId: string,
	plan: TaskEditPlan,
): Effect.Effect<ProjectTaskPlanResult, ProjectActionError> =>
	transformProjectTaskPlan(markdown, taskId, (lineIndex) =>
		applyTaskEdit(markdown, lineIndex, plan),
	);

const deleteProjectTaskPlan = (
	markdown: string,
	taskId: string,
	mode: TaskDeleteMode,
): Effect.Effect<ProjectTaskPlanResult, ProjectActionError> =>
	transformProjectTaskPlan(markdown, taskId, (lineIndex) =>
		applyTaskDelete(markdown, lineIndex, mode),
	);

const transformProjectTaskPlan = (
	markdown: string,
	taskId: string,
	transform: (lineIndex: number) => TaskEditResult,
): Effect.Effect<ProjectTaskPlanResult, ProjectActionError> =>
	Effect.gen(function* () {
		const note = yield* parseProjectNote(markdown);
		const before = projectTaskLines(note);
		const matches = before.filter((task) => task.id === taskId);
		const [task] = matches;
		if (!task || matches.length > 1) {
			return yield* new ProjectTaskError({
				message: task ? 'Task identity is ambiguous.' : 'Task was not found.',
				taskId,
			});
		}
		const transformed = yield* Effect.try({
			try: () => transform(task.lineIndex),
			catch: (error) =>
				new ProjectTaskError({
					message: error instanceof Error ? error.message : 'Unable to edit task.',
					taskId,
				}),
		});
		const after = projectTaskLines(yield* parseProjectNote(transformed.markdown));
		const byLine = new Map(after.map((candidate) => [candidate.lineIndex, candidate.id]));
		const mapping = new Map(
			before.map((candidate) => {
				const nextLine = transformed.lineMapping.get(candidate.lineIndex);
				return [candidate.id, nextLine === undefined ? '' : (byLine.get(nextLine) ?? '')];
			}),
		);
		return { ...transformed, mapping };
	});

const addProjectTaskPlan = (
	markdown: string,
	sectionName: string,
	plan: TaskEditPlan,
): Effect.Effect<ProjectTaskPlanResult, ProjectActionError> =>
	Effect.gen(function* () {
		const note = yield* parseProjectNote(markdown);
		const before = projectTaskLines(note);
		const originalLines = Array.from(markdown.matchAll(/([^\r\n]*)(\r\n|\n|\r|$)/g))
			.filter((match) => match[0] !== '')
			.map((_line, index) => index);
		if (!hasTaskEditContent(plan)) {
			return {
				markdown,
				mapping: new Map(before.map((task) => [task.id, task.id])),
				lineMapping: new Map(originalLines.map((line) => [line, line])),
			};
		}
		const staged = stageProjectTask(markdown, note, sectionName);
		const stagedTasks = projectTaskLines(yield* parseProjectNote(staged.markdown));
		const anchor = stagedTasks.find((task) => task.lineIndex === staged.anchorLine)!;
		const result = yield* editProjectTaskPlan(staged.markdown, anchor.id, plan);
		const byLine = new Map(stagedTasks.map((task) => [task.lineIndex, task.id]));
		return {
			markdown: result.markdown,
			lineMapping: new Map(
				originalLines.flatMap((line) => {
					const stagedLine = line + (line >= staged.insertionIndex ? staged.count : 0);
					const next = result.lineMapping.get(stagedLine);
					return next === undefined ? [] : [[line, next]];
				}),
			),
			mapping: new Map(
				before.map((task) => {
					const line =
						task.lineIndex + (task.lineIndex >= staged.insertionIndex ? staged.count : 0);
					return [task.id, result.mapping.get(byLine.get(line)!) ?? ''];
				}),
			),
		};
	});

const stageProjectTask = (
	markdown: string,
	note: ProjectNote,
	sectionName: string,
): {
	markdown: string;
	anchorLine: number;
	insertionIndex: number;
	count: number;
} => {
	const lines = Array.from(markdown.matchAll(/([^\r\n]*)(\r\n|\n|\r|$)/g))
		.filter((match) => match[0] !== '')
		.map((match) => ({ raw: match[1] ?? '', ending: match[2] ?? '' }));
	const finalEnding = lines.at(-1)?.ending ?? '';
	const ending = lines.find((line) => line.ending)?.ending ?? '\n';
	let offset = note.frontmatterLines.length + note.preambleLines.length;
	let insertionIndex = lines.length;
	let sectionStart = -1;
	let notesStart = lines.length;
	for (const section of note.sections) {
		if (section.name === 'Notes & Decisions') {
			notesStart = offset;
		}
		if (section.name === sectionName && sectionStart < 0) {
			sectionStart = offset;
			insertionIndex = Math.min(lines.length, offset + 1 + section.lines.length);
		}
		offset += 1 + section.lines.length;
	}
	let added = ['- [ ] Draft'];
	if (sectionStart >= 0) {
		while (insertionIndex > sectionStart + 1 && !lines[insertionIndex - 1]!.raw.trim()) {
			insertionIndex -= 1;
		}
	} else {
		insertionIndex = notesStart;
		added = [
			`## ${sectionName}`,
			'',
			'- [ ] Draft',
			...(insertionIndex < lines.length ? [''] : []),
		];
	}
	if (insertionIndex > 0 && !lines[insertionIndex - 1]!.ending) {
		lines[insertionIndex - 1]!.ending = ending;
	}
	lines.splice(insertionIndex, 0, ...added.map((raw) => ({ raw, ending })));
	lines.at(-1)!.ending = finalEnding;
	return {
		markdown: lines.map((line) => line.raw + line.ending).join(''),
		anchorLine: insertionIndex + (sectionStart >= 0 ? 0 : 2),
		insertionIndex,
		count: added.length,
	};
};

export {
	addProjectTask,
	addProjectTaskPlan,
	completeProjectTask,
	deleteProjectTask,
	deleteProjectTaskPlan,
	editProjectTask,
	editProjectTaskPlan,
	moveProjectTask,
	moveProjectTaskToPosition,
	projectTaskHasChildren,
	reorderProjectTask,
	setProjectTaskChecked,
};
export type { ProjectActionError, ProjectTaskPlanResult };
