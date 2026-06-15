/* eslint-disable eslint/func-names, eslint/func-style, eslint/init-declarations, eslint/max-statements, eslint/new-cap, eslint/no-continue, eslint/no-magic-numbers, eslint/no-ternary */
import { Data, Effect } from 'effect';

const TAVERN_PROJECT_PROPERTY = 'tavern';
const TAVERN_PROJECT_FRONTMATTER = 'project';
const DONE_SECTION_NAME = 'Done';
const SECTION_HEADING_PATTERN = /^##\s+(.+?)\s*$/;
const TITLE_PATTERN = /^#\s+(.+?)\s*$/;
const TASK_PATTERN = /^(\s*)- \[([ xX])\]\s*(.*)$/;

type ProjectNote = {
	frontmatter: Record<string, string>;
	frontmatterLines: string[];
	preambleLines: string[];
	sections: ProjectSection[];
	title: string;
};

type ProjectSection = {
	lines: SectionLine[];
	name: string;
	tasks: ProjectTask[];
};

type ProjectTask = {
	checked: boolean;
	id: string;
	indent: string;
	lineIndex: number;
	sectionName: string;
	text: string;
};

type ProjectTaskReorderDirection = 'down' | 'up';
type ProjectTaskDropPlacement = 'after' | 'before' | 'child';
type MoveTaskToPositionInput = {
	note: ProjectNote;
	placement: ProjectTaskDropPlacement;
	sourceTaskId: string;
	targetTaskId: string;
};

type SectionLine =
	| {
			raw: string;
			task: ProjectTask;
			type: 'task';
	  }
	| {
			raw: string;
			type: 'text';
	  };

class ProjectNoteParseError extends Data.TaggedError('ProjectNoteParseError')<{
	message: string;
}> {}

class ProjectTaskError extends Data.TaggedError('ProjectTaskError')<{
	message: string;
	taskId: string;
}> {}

function parseProjectNote(markdown: string): Effect.Effect<ProjectNote, ProjectNoteParseError> {
	return Effect.gen(function* () {
		const lines = markdown.split(/\r?\n/);
		const { bodyStartIndex, frontmatter, frontmatterLines } = parseFrontmatter(lines);

		if (!isTavernProjectFrontmatter(frontmatter)) {
			return yield* new ProjectNoteParseError({
				message: `Expected ${TAVERN_PROJECT_PROPERTY}: ${TAVERN_PROJECT_FRONTMATTER} frontmatter.`,
			});
		}

		const bodyLines = lines.slice(bodyStartIndex);
		const firstSectionIndex = bodyLines.findIndex((line) => SECTION_HEADING_PATTERN.test(line));
		const preambleLines =
			firstSectionIndex === -1 ? bodyLines : bodyLines.slice(0, firstSectionIndex);
		const sectionLines = firstSectionIndex === -1 ? [] : bodyLines.slice(firstSectionIndex);
		const title = findTitle(preambleLines) ?? frontmatter.Title ?? 'Untitled project';

		const note = {
			frontmatter,
			frontmatterLines,
			preambleLines,
			sections: parseSections(sectionLines),
			title,
		};
		renumberTasks(note); // ensure initial IDs are unique (section order prefix); mutators also call renumber after every op
		return note;
	});
}

function isTavernProjectFrontmatter(frontmatter: Record<string, unknown>): boolean {
	return frontmatter[TAVERN_PROJECT_PROPERTY] === TAVERN_PROJECT_FRONTMATTER;
}

function moveTaskToSection(
	note: ProjectNote,
	taskId: string,
	targetSectionName: string,
): Effect.Effect<ProjectNote, ProjectTaskError> {
	return Effect.gen(function* () {
		const workingNote = cloneProjectNote(note);
		const locatedTask = findTaskLocation(workingNote, taskId);

		if (!locatedTask) {
			return yield* new ProjectTaskError({ message: 'Task was not found.', taskId });
		}

		const { sectionIndex, taskLineIndex } = locatedTask;
		const sourceSection = workingNote.sections[sectionIndex];
		if (!sourceSection) {
			return yield* new ProjectTaskError({ message: 'Task section was not found.', taskId });
		}

		const taskGroup = removeTaskGroup(sourceSection, taskLineIndex);
		if (taskGroup.length > 0) {
			const [rootLine] = taskGroup;
			if (rootLine && rootLine.type === 'task') {
				reindentTaskGroup(taskGroup, rootLine.task.indent, '');
			}
		}
		const targetSection = ensureSection(workingNote, targetSectionName);
		appendTaskGroup(targetSection, taskGroup);
		renumberTasks(workingNote);

		return workingNote;
	});
}

function moveTaskToPosition({
	note,
	placement,
	sourceTaskId,
	targetTaskId,
}: MoveTaskToPositionInput): Effect.Effect<ProjectNote, ProjectTaskError> {
	return Effect.gen(function* () {
		if (sourceTaskId === targetTaskId) {
			return note;
		}

		const workingNote = cloneProjectNote(note);
		const sourceLocation = findTaskLocation(workingNote, sourceTaskId);
		const targetLocation = findTaskLocation(workingNote, targetTaskId);

		if (!sourceLocation) {
			return yield* new ProjectTaskError({
				message: 'Task was not found.',
				taskId: sourceTaskId,
			});
		}
		if (!targetLocation) {
			return yield* new ProjectTaskError({
				message: 'Task was not found.',
				taskId: targetTaskId,
			});
		}

		const sourceSection = workingNote.sections[sourceLocation.sectionIndex];
		const targetSection = workingNote.sections[targetLocation.sectionIndex];
		if (!sourceSection || !targetSection) {
			return yield* new ProjectTaskError({
				message: 'Task section was not found.',
				taskId: sourceTaskId,
			});
		}

		const sourceTaskLine = sourceSection.lines[sourceLocation.taskLineIndex];
		const targetTaskLine = targetSection.lines[targetLocation.taskLineIndex];
		if (sourceTaskLine?.type !== 'task' || targetTaskLine?.type !== 'task') {
			return yield* new ProjectTaskError({
				message: 'Task line was not found.',
				taskId: sourceTaskId,
			});
		}

		const taskGroup = removeTaskGroup(sourceSection, sourceLocation.taskLineIndex);
		const adjustedTargetIndex = adjustedInsertionTargetIndex(
			sourceLocation,
			targetLocation,
			taskGroup,
		);
		const targetIndent = targetTaskLine.task.indent;
		// inherit child unit from target's trailing style (if \t or 4sp use \t else '  '; mirrors legacy \t + width-delta reindent pass)
		const nextIndent =
			placement === 'child'
				? `${targetIndent}${targetIndent.endsWith('\t') || targetIndent.endsWith('    ') ? '\t' : '  '}`
				: targetIndent;
		reindentTaskGroup(taskGroup, sourceTaskLine.task.indent, nextIndent);

		const insertionIndex = taskInsertionIndex(targetSection, adjustedTargetIndex, placement);
		targetSection.lines.splice(insertionIndex, 0, ...taskGroup);
		renumberTasks(workingNote);

		return workingNote;
	});
}

function addTaskToSection(
	note: ProjectNote,
	sectionName: string,
	taskText: string,
): Effect.Effect<ProjectNote, ProjectTaskError> {
	return Effect.gen(function* () {
		const trimmedTaskText = taskText.trim();
		if (trimmedTaskText.length === 0) {
			return yield* new ProjectTaskError({ message: 'Task text was empty.', taskId: '' });
		}

		const workingNote = cloneProjectNote(note);
		const section = ensureSection(workingNote, sectionName);
		appendTaskLine(section, trimmedTaskText);
		renumberTasks(workingNote);

		return workingNote;
	});
}

function completeTask(
	note: ProjectNote,
	taskId: string,
): Effect.Effect<ProjectNote, ProjectTaskError> {
	return Effect.gen(function* () {
		const checkedNote = cloneProjectNote(note);
		const locatedTask = findTaskLocation(checkedNote, taskId);

		if (!locatedTask) {
			return yield* new ProjectTaskError({ message: 'Task was not found.', taskId });
		}

		const taskLine =
			checkedNote.sections[locatedTask.sectionIndex]?.lines[locatedTask.taskLineIndex];
		if (taskLine?.type !== 'task') {
			return yield* new ProjectTaskError({ message: 'Task line was not found.', taskId });
		}

		taskLine.raw = `${taskLine.task.indent}- [x] ${taskLine.task.text}`;
		taskLine.task = { ...taskLine.task, checked: true };

		return yield* moveTaskToSection(checkedNote, taskId, DONE_SECTION_NAME);
	});
}

function deleteTask(
	note: ProjectNote,
	taskId: string,
): Effect.Effect<ProjectNote, ProjectTaskError> {
	return Effect.gen(function* () {
		const workingNote = cloneProjectNote(note);
		const locatedTask = findTaskLocation(workingNote, taskId);

		if (!locatedTask) {
			return yield* new ProjectTaskError({ message: 'Task was not found.', taskId });
		}

		const section = workingNote.sections[locatedTask.sectionIndex];
		if (!section) {
			return yield* new ProjectTaskError({ message: 'Task section was not found.', taskId });
		}

		const taskGroup = removeTaskGroup(section, locatedTask.taskLineIndex);
		if (taskGroup.length === 0) {
			return yield* new ProjectTaskError({ message: 'Task line was not found.', taskId });
		}
		renumberTasks(workingNote);

		return workingNote;
	});
}

function editTaskText(
	note: ProjectNote,
	taskId: string,
	taskText: string,
): Effect.Effect<ProjectNote, ProjectTaskError> {
	return Effect.gen(function* () {
		const trimmedTaskText = taskText.trim();
		if (trimmedTaskText.length === 0) {
			return yield* new ProjectTaskError({ message: 'Task text was empty.', taskId });
		}

		const workingNote = cloneProjectNote(note);
		const locatedTask = findTaskLocation(workingNote, taskId);

		if (!locatedTask) {
			return yield* new ProjectTaskError({ message: 'Task was not found.', taskId });
		}

		const taskLine =
			workingNote.sections[locatedTask.sectionIndex]?.lines[locatedTask.taskLineIndex];
		if (taskLine?.type !== 'task') {
			return yield* new ProjectTaskError({ message: 'Task line was not found.', taskId });
		}

		const marker = taskLine.task.checked ? 'x' : ' ';
		taskLine.raw = `${taskLine.task.indent}- [${marker}] ${trimmedTaskText}`;
		taskLine.task = { ...taskLine.task, text: trimmedTaskText };
		renumberTasks(workingNote);

		return workingNote;
	});
}

function reorderTask(
	note: ProjectNote,
	taskId: string,
	direction: ProjectTaskReorderDirection,
): Effect.Effect<ProjectNote, ProjectTaskError> {
	return Effect.gen(function* () {
		const workingNote = cloneProjectNote(note);
		const locatedTask = findTaskLocation(workingNote, taskId);

		if (!locatedTask) {
			return yield* new ProjectTaskError({ message: 'Task was not found.', taskId });
		}

		const section = workingNote.sections[locatedTask.sectionIndex];
		if (!section) {
			return yield* new ProjectTaskError({ message: 'Task section was not found.', taskId });
		}

		const taskGroup = moveTaskGroupWithinSection(section, locatedTask.taskLineIndex, direction);
		/* c8 ignore next -- taskGroup.length==0 error (requires non-task in moveWithin which is unreachable); defensive */
		if (taskGroup.length === 0) {
			return yield* new ProjectTaskError({ message: 'Task line was not found.', taskId });
		}

		renumberTasks(workingNote);

		return workingNote;
	});
}

function serializeProjectNote(note: ProjectNote): string {
	const lines = [
		...note.frontmatterLines,
		...note.preambleLines,
		...note.sections.flatMap((section) => [
			`## ${section.name}`,
			...section.lines.map((line) => line.raw),
		]),
	];

	return lines.join('\n');
}

function parseFrontmatter(lines: string[]): {
	bodyStartIndex: number;
	frontmatter: Record<string, string>;
	frontmatterLines: string[];
} {
	if (lines[0] !== '---') {
		return {
			bodyStartIndex: 0,
			frontmatter: {},
			frontmatterLines: [],
		};
	}

	const endIndex = lines.indexOf('---', 1);
	if (endIndex === -1) {
		return {
			bodyStartIndex: 0,
			frontmatter: {},
			frontmatterLines: [],
		};
	}

	const frontmatterLines = lines.slice(0, endIndex + 1);
	const frontmatter = Object.fromEntries(
		lines
			.slice(1, endIndex)
			.map((line) => line.match(/^([^:]+):\s*(.*)$/))
			.filter((match): match is RegExpMatchArray => match !== null)
			.map((match) => [match[1]?.trim() ?? '', match[2]?.trim() ?? '']),
	);

	return {
		bodyStartIndex: endIndex + 1,
		frontmatter,
		frontmatterLines,
	};
}

function parseSections(lines: string[]): ProjectSection[] {
	const sections: ProjectSection[] = [];
	let activeSection: ProjectSection | undefined;

	for (const line of lines) {
		const headingMatch = line.match(SECTION_HEADING_PATTERN);
		if (headingMatch) {
			activeSection = { lines: [], name: headingMatch[1] ?? '', tasks: [] };
			sections.push(activeSection);
			continue;
		}

		/* c8 ignore next -- !activeSection continue in section parse (sectionLines always starts at heading or empty; defensive) */
		if (!activeSection) {
			continue;
		}

		const sectionLine = parseSectionLine(line, activeSection.name, activeSection.lines.length);
		activeSection.lines.push(sectionLine);
		if (sectionLine.type === 'task') {
			activeSection.tasks.push(sectionLine.task);
		}
	}

	return sections;
}

function parseSectionLine(line: string, sectionName: string, lineIndex: number): SectionLine {
	const taskMatch = line.match(TASK_PATTERN);
	if (!taskMatch) {
		return { raw: line, type: 'text' };
	}

	const indent = taskMatch[1] ?? '';
	const checked = (taskMatch[2] ?? '').toLowerCase() === 'x';
	const text = taskMatch[3] ?? '';

	return {
		raw: line,
		task: {
			checked,
			id: createTaskId(sectionName, lineIndex, text), // will be overwritten by renumberTasks at parse end + after every mutator for uniqueness via sectionIdx
			indent,
			lineIndex,
			sectionName,
			text,
		},
		type: 'task',
	};
}

function findTitle(lines: string[]): string | undefined {
	return lines.find((line) => TITLE_PATTERN.test(line))?.match(TITLE_PATTERN)?.[1];
}

function cloneProjectNote(note: ProjectNote): ProjectNote {
	return {
		frontmatter: { ...note.frontmatter },
		frontmatterLines: [...note.frontmatterLines],
		preambleLines: [...note.preambleLines],
		sections: note.sections.map((section) => ({
			lines: section.lines.map((line) =>
				line.type === 'task'
					? { raw: line.raw, task: { ...line.task }, type: 'task' }
					: { raw: line.raw, type: 'text' },
			),
			name: section.name,
			tasks: section.tasks.map((task) => ({ ...task })),
		})),
		title: note.title,
	};
}

function findTaskLocation(
	note: ProjectNote,
	taskIdToFind: string,
): { sectionIndex: number; taskLineIndex: number } | undefined {
	for (const [sectionIndex, section] of note.sections.entries()) {
		const taskLineIndex = section.lines.findIndex(
			(line) => line.type === 'task' && line.task.id === taskIdToFind,
		);
		if (taskLineIndex !== -1) {
			return { sectionIndex, taskLineIndex };
		}
	}

	return undefined;
}

function removeTaskGroup(section: ProjectSection, taskLineIndex: number): SectionLine[] {
	const taskLine = section.lines[taskLineIndex];
	/* c8 ignore next -- defensive non-task return (parallel to moveWithin; callers use resolved task indices); unreachable */
	if (taskLine?.type !== 'task') {
		return [];
	}

	const baseIndent = indentWidth(taskLine.task.indent);
	let endIndex = taskLineIndex + 1;

	while (endIndex < section.lines.length) {
		const line = section.lines[endIndex];
		if (line?.type !== 'task' || indentWidth(line.task.indent) <= baseIndent) {
			break;
		}
		endIndex += 1;
	}

	return section.lines.splice(taskLineIndex, endIndex - taskLineIndex);
}

function moveTaskGroupWithinSection(
	section: ProjectSection,
	taskLineIndex: number,
	direction: ProjectTaskReorderDirection,
): SectionLine[] {
	const taskLine = section.lines[taskLineIndex];
	/* c8 ignore next -- defensive for non-task line index (callers via taskId always resolve to task lines); unreachable in current public API usage */
	if (taskLine?.type !== 'task') {
		return [];
	}

	if (direction === 'up') {
		return moveTaskGroupUp(section, taskLineIndex, taskLine);
	}

	return moveTaskGroupDown(section, taskLineIndex, taskLine);
}

function moveTaskGroupUp(
	section: ProjectSection,
	taskLineIndex: number,
	taskLine: Extract<SectionLine, { type: 'task' }>,
): SectionLine[] {
	const previousStart = findPreviousTaskGroupStart(section, taskLineIndex, taskLine.task.indent);
	const taskGroup = removeTaskGroup(section, taskLineIndex);
	if (previousStart === -1) {
		section.lines.splice(taskLineIndex, 0, ...taskGroup);
		return taskGroup;
	}

	section.lines.splice(previousStart, 0, ...taskGroup);
	return taskGroup;
}

function moveTaskGroupDown(
	section: ProjectSection,
	taskLineIndex: number,
	taskLine: Extract<SectionLine, { type: 'task' }>,
): SectionLine[] {
	const nextStart = findNextTaskGroupStart(section, taskLineIndex, taskLine.task.indent);
	if (nextStart === -1) {
		return removeAndReinsertTaskGroup(section, taskLineIndex, taskLineIndex);
	}

	const nextEnd = findTaskGroupEnd(section, nextStart, taskLine.task.indent);
	const taskGroup = removeTaskGroup(section, taskLineIndex);
	section.lines.splice(nextEnd - taskGroup.length, 0, ...taskGroup);
	return taskGroup;
}

function adjustedInsertionTargetIndex(
	sourceLocation: { sectionIndex: number; taskLineIndex: number },
	targetLocation: { sectionIndex: number; taskLineIndex: number },
	taskGroup: SectionLine[],
): number {
	if (
		sourceLocation.sectionIndex === targetLocation.sectionIndex &&
		sourceLocation.taskLineIndex < targetLocation.taskLineIndex
	) {
		return targetLocation.taskLineIndex - taskGroup.length;
	}

	return targetLocation.taskLineIndex;
}

function taskInsertionIndex(
	section: ProjectSection,
	targetTaskLineIndex: number,
	placement: ProjectTaskDropPlacement,
): number {
	const targetLine = section.lines[targetTaskLineIndex];
	/* c8 ignore next -- defensive for non-task target line (callers via taskId resolve to tasks); unreachable via public move APIs */
	if (targetLine?.type !== 'task') {
		return targetTaskLineIndex;
	}

	if (placement === 'before') {
		return targetTaskLineIndex;
	}

	if (placement === 'child') {
		return targetTaskLineIndex + 1;
	}

	return findTaskGroupEnd(section, targetTaskLineIndex, targetLine.task.indent);
}

function reindentTaskGroup(
	taskGroup: SectionLine[],
	sourceIndent: string,
	targetIndent: string,
): void {
	for (const line of taskGroup) {
		/* c8 ignore next -- defensive for text lines inside taskGroup (removeTaskGroup only returns task lines); unreachable via public move/complete */
		if (line.type !== 'task') {
			continue;
		}

		// Width-delta relative (not startsWith string prefix) to handle mixed ws (spaces vs tabs) between root and descendants.
		// Matches removeTaskGroup / find* logic that already use indentWidth for subtree collection; force-to-'' for group root is preserved via delta=0.
		// Synthesizes relative using tabs+spaces to achieve exact delta width (precedent for \t in moveToPosition child case).
		const sourceWidth = indentWidth(sourceIndent);
		const lineWidth = indentWidth(line.task.indent);
		const delta = Math.max(0, lineWidth - sourceWidth);
		const relativeIndent = '\t'.repeat(Math.floor(delta / 4)) + ' '.repeat(delta % 4);
		const nextIndent = `${targetIndent}${relativeIndent}`;
		const marker = line.task.checked ? 'x' : ' ';
		line.raw = `${nextIndent}- [${marker}] ${line.task.text}`;
		line.task = { ...line.task, indent: nextIndent };
	}
}

function removeAndReinsertTaskGroup(
	section: ProjectSection,
	taskLineIndex: number,
	insertIndex: number,
): SectionLine[] {
	const taskGroup = removeTaskGroup(section, taskLineIndex);
	section.lines.splice(insertIndex, 0, ...taskGroup);
	return taskGroup;
}

function findPreviousTaskGroupStart(
	section: ProjectSection,
	taskLineIndex: number,
	indent: string,
): number {
	const baseIndent = indentWidth(indent);
	for (let index = taskLineIndex - 1; index >= 0; index -= 1) {
		const line = section.lines[index];
		if (line?.type === 'task' && indentWidth(line.task.indent) <= baseIndent) {
			return index;
		}
	}

	return -1;
}

function findNextTaskGroupStart(
	section: ProjectSection,
	taskLineIndex: number,
	indent: string,
): number {
	const baseIndent = indentWidth(indent);
	const currentEnd = findTaskGroupEnd(section, taskLineIndex, indent);
	for (let index = currentEnd; index < section.lines.length; index += 1) {
		const line = section.lines[index];
		if (line?.type === 'task' && indentWidth(line.task.indent) <= baseIndent) {
			return index;
		}
	}

	return -1;
}

function findTaskGroupEnd(section: ProjectSection, taskLineIndex: number, indent: string): number {
	const baseIndent = indentWidth(indent);
	let endIndex = taskLineIndex + 1;

	while (endIndex < section.lines.length) {
		const line = section.lines[endIndex];
		if (line?.type !== 'task' || indentWidth(line.task.indent) <= baseIndent) {
			break;
		}
		endIndex += 1;
	}

	return endIndex;
}

function appendTaskGroup(section: ProjectSection, taskGroup: SectionLine[]): void {
	removeTrailingBlankLines(section);

	if (section.lines.length === 0) {
		section.lines.push({ raw: '', type: 'text' });
	}

	section.lines.push(...taskGroup);
	section.lines.push({ raw: '', type: 'text' });
}

function appendTaskLine(section: ProjectSection, taskText: string): void {
	removeTrailingBlankLines(section);

	if (section.lines.length === 0) {
		section.lines.push({ raw: '', type: 'text' });
	}

	section.lines.push(parseSectionLine(`- [ ] ${taskText}`, section.name, section.lines.length));
	section.lines.push({ raw: '', type: 'text' });
}

function ensureSection(note: ProjectNote, sectionName: string): ProjectSection {
	const existingSection = note.sections.find((section) => section.name === sectionName);
	if (existingSection) {
		return existingSection;
	}

	const notesSectionIndex = note.sections.findIndex(
		(section) => section.name === 'Notes & Decisions',
	);
	const section = {
		lines: [''].map((raw) => ({ raw, type: 'text' as const })),
		name: sectionName,
		tasks: [],
	};
	const insertIndex = notesSectionIndex === -1 ? note.sections.length : notesSectionIndex;
	note.sections.splice(insertIndex, 0, section);

	return section;
}

function removeTrailingBlankLines(section: ProjectSection): void {
	while (section.lines.at(-1)?.raw === '') {
		section.lines.pop();
	}
}

function renumberTasks(note: ProjectNote): void {
	for (let sectionIdx = 0; sectionIdx < note.sections.length; sectionIdx++) {
		const section = note.sections[sectionIdx]!;
		section.tasks = [];
		for (const [lineIndex, line] of section.lines.entries()) {
			if (line.type === 'task') {
				line.task = {
					...line.task,
					id: createTaskId(section.name, lineIndex, line.task.text, sectionIdx),
					lineIndex,
					sectionName: section.name,
				};
				section.tasks.push(line.task);
			}
		}
	}
}

/* eslint-disable eslint/max-params */
function createTaskId(
	sectionName: string,
	lineIndex: number,
	text: string,
	sectionIdx = 0,
): string {
	// sectionIdx prefix guarantees uniqueness even when different sections slug to identical prefix after normalization
	// (e.g. "To Do" vs "To-Do" + same per-section lineIndex + text). Fixes collision bug (reviewerA#1, reviewerB#1).
	// Old persisted boardTaskKeys using previous id format will be pruned on next refresh (acceptable for focus queue).
	const secPrefix = sectionIdx === 0 ? sectionName : `${sectionIdx}-${sectionName}`;
	return `${secPrefix}:${lineIndex}:${text}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function indentWidth(indent: string): number {
	return indent.replace(/\t/g, '    ').length;
}

export {
	addTaskToSection,
	completeTask,
	deleteTask,
	editTaskText,
	indentWidth,
	isTavernProjectFrontmatter,
	moveTaskToPosition,
	moveTaskToSection,
	parseProjectNote,
	ProjectNoteParseError,
	ProjectTaskError,
	reorderTask,
	serializeProjectNote,
	TAVERN_PROJECT_FRONTMATTER,
	TAVERN_PROJECT_PROPERTY,
};
export type {
	ProjectNote,
	ProjectSection,
	ProjectTask,
	ProjectTaskDropPlacement,
	ProjectTaskReorderDirection,
	SectionLine,
	MoveTaskToPositionInput,
};
