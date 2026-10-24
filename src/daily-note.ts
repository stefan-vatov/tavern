/* eslint-disable eslint/func-style, eslint/max-statements, eslint/no-continue, eslint/no-magic-numbers, eslint/no-ternary */
import type { ProjectTask } from './project-note';
import type { TaskEditResult } from './task-edit';

type DailyTask = ProjectTask & { blockId?: string };
type DailyTaskDropPlacement = 'before' | 'after' | 'child';
type DailyNoteItem =
	| { type: 'heading'; level: number; text: string; lineIndex: number }
	| { type: 'text'; raw: string; lineIndex: number }
	| { type: 'task'; task: DailyTask };
type DailyNote = { markdown: string; items: DailyNoteItem[]; tasks: DailyTask[] };
type MarkdownLine = { raw: string; ending: string; original?: number };

const TASK = /^([\t ]*)([-+*] \[)([ xX])(\][\t ]*)(.*)$/;
const HEADING = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;

function localDay(date: Date): string {
	if (Number.isNaN(date.getTime())) {
		throw new Error('Invalid daily note date.');
	}
	return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function dayDate(day: string): Date {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
		throw new Error('Invalid daily note day.');
	}
	const date = new Date(`${day}T12:00:00`);
	if (Number.isNaN(date.getTime()) || localDay(date) !== day) {
		throw new Error('Invalid daily note day.');
	}
	return date;
}

function shiftDay(day: string, offset: number): string {
	if (!Number.isInteger(offset)) {
		throw new Error('Day offset must be an integer.');
	}
	const date = dayDate(day);
	date.setDate(date.getDate() + offset);
	return localDay(date);
}

function dailyLogPath(folder: string, day: string): string {
	dayDate(day);
	const root = folder.replace(/^\/+|\/+$/g, '');
	return `${root ? `${root}/` : ''}${day.slice(0, 4)}/${day.slice(5, 7)}/${day}.md`;
}

function createDailyNote(day: string): string {
	dayDate(day);
	return `# ${day}\n\n## General\n\n### Plan\n\n### Notes\n`;
}

function readLines(markdown: string): MarkdownLine[] {
	return Array.from(markdown.matchAll(/([^\r\n]*)(\r\n|\n|\r|$)/g))
		.filter((match) => match[0] !== '')
		.map((match, original) => ({ raw: match[1] ?? '', ending: match[2] ?? '', original }));
}

function writeLines(lines: MarkdownLine[]): string {
	return lines.map((line) => line.raw + line.ending).join('');
}

function parseDailyNote(markdown: string): DailyNote {
	const lines = readLines(markdown);
	const items: DailyNoteItem[] = [];
	const tasks: DailyTask[] = [];
	const frontmatterEnd =
		lines[0]?.raw === '---'
			? lines.findIndex((line, index) => index > 0 && /^(---|\.\.\.)$/.test(line.raw))
			: -1;
	let sectionName = '';
	let fence: { marker: string; length: number } | undefined = undefined;
	for (const [lineIndex, { raw }] of lines.entries()) {
		if (lineIndex <= frontmatterEnd) {
			continue;
		}
		const fenceMatch = raw.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
		if (fence) {
			items.push({ type: 'text', raw, lineIndex });
			if (
				fenceMatch?.[1]?.[0] === fence.marker &&
				fenceMatch[1].length >= fence.length &&
				!fenceMatch[2]?.trim()
			) {
				fence = undefined;
			}
			continue;
		}
		if (fenceMatch) {
			fence = { marker: fenceMatch[1]![0]!, length: fenceMatch[1]!.length };
			items.push({ type: 'text', raw, lineIndex });
			continue;
		}
		const heading = raw.match(HEADING);
		if (heading) {
			const level = heading[1]!.length;
			if (level > 1) {
				sectionName = heading[2]!;
				items.push({ type: 'heading', level, text: sectionName, lineIndex });
			}
			continue;
		}
		const match = raw.match(TASK);
		if (!match) {
			items.push({ type: 'text', raw, lineIndex });
			continue;
		}
		const content = match[5] ?? '';
		const block = content.match(/(?:^|\s)\^([A-Za-z0-9-]+)\s*$/);
		const blockId = block?.[1];
		const task: DailyTask = {
			checked: match[3]?.toLowerCase() === 'x',
			id: blockId ? `block:${blockId}` : `line:${lineIndex}`,
			indent: match[1]!,
			lineIndex,
			sectionName,
			text: block ? content.slice(0, block.index).trimEnd() : content,
			...(blockId ? { blockId } : {}),
		};
		tasks.push(task);
		items.push({ type: 'task', task });
	}
	return { markdown, items, tasks };
}

function requireTask(markdown: string, lineIndex: number): DailyTask {
	const task = parseDailyNote(markdown).tasks.find(
		(candidate) => candidate.lineIndex === lineIndex,
	);
	if (!task) {
		throw new Error(`Daily task was not found at line ${lineIndex}.`);
	}
	return task;
}

function taskText(text: string): string {
	if (!text.trim()) {
		throw new Error('Task text was empty.');
	}
	if (/[\r\n]/.test(text)) {
		throw new Error('Task text must be a single line.');
	}
	return text.trim();
}

function setDailyTaskChecked(markdown: string, lineIndex: number, checked: boolean): string {
	requireTask(markdown, lineIndex);
	const lines = readLines(markdown);
	const line = lines[lineIndex]!;
	const match = line.raw.match(TASK)!;
	const markerIndex = match[1]!.length + match[2]!.length;
	line.raw =
		line.raw.slice(0, markerIndex) + (checked ? 'x' : ' ') + line.raw.slice(markerIndex + 1);
	return writeLines(lines);
}

function editDailyTask(markdown: string, lineIndex: number, text: string): string {
	const task = requireTask(markdown, lineIndex);
	const nextText = taskText(text);
	const lines = readLines(markdown);
	const line = lines[lineIndex]!;
	const match = line.raw.match(TASK)!;
	const blockSuffix = task.blockId ? (match[5]!.match(/\s*\^[A-Za-z0-9-]+\s*$/)?.[0] ?? '') : '';
	line.raw = `${match[1]}${match[2]}${match[3]}${match[4]}${nextText}${blockSuffix}`;
	return writeLines(lines);
}

function insertLines(lines: MarkdownLine[], index: number, raws: string[]): void {
	const ending = lines.find((line) => line.ending)?.ending ?? '\n';
	if (index > 0 && !lines[index - 1]!.ending) {
		lines[index - 1]!.ending = ending;
	}
	lines.splice(index, 0, ...raws.map((raw) => ({ raw, ending })));
}

function addDailyTask(markdown: string, text: string, sectionName = 'Plan'): string {
	return appendDailyTaskLines(markdown, [`- [ ] ${taskText(text)}`], sectionName);
}

function appendDailyTaskLines(markdown: string, raws: string[], sectionName: string): string {
	const lines = readLines(markdown);
	appendTaskLines(lines, raws, sectionName);
	return writeLines(lines);
}

function appendTaskLines(lines: MarkdownLine[], raws: string[], sectionName: string): void {
	const name = taskText(sectionName);
	const headings = parseDailyNote(writeLines(lines)).items.filter(
		(item) => item.type === 'heading',
	);
	const section = headings.find((item) => item.text === name);
	if (section) {
		const nextHeading = headings.find(
			(item) => item.lineIndex > section.lineIndex && item.level <= section.level,
		);
		let index = nextHeading?.lineIndex ?? lines.length;
		while (index > section.lineIndex + 1 && !lines[index - 1]!.raw.trim()) {
			index -= 1;
		}
		insertLines(lines, index, raws);
	} else {
		const general = headings.find((item) => item.level === 2 && item.text === 'General');
		const nextGeneral =
			general && headings.find((item) => item.lineIndex > general.lineIndex && item.level <= 2);
		const index = nextGeneral?.lineIndex ?? lines.length;
		insertLines(lines, index, [
			...(general ? [] : ['', '## General', '']),
			`### ${name}`,
			'',
			...raws,
			'',
		]);
	}
}

function indentWidth(indent: string): number {
	return indent.replace(/\t/g, '    ').length;
}

function childIndent(target: DailyTask, child?: DailyTask): string {
	return (
		child?.indent ??
		target.indent + (target.indent.endsWith('\t') || target.indent.endsWith('    ') ? '\t' : '  ')
	);
}

function taskEnd(lines: MarkdownLine[], task: DailyTask, tasks: DailyTask[]): number {
	const byLine = new Map(tasks.map((candidate) => [candidate.lineIndex, candidate]));
	const width = indentWidth(task.indent);
	let end = task.lineIndex + 1;
	for (let index = end; index < lines.length; index += 1) {
		const { raw } = lines[index]!;
		if (!raw.trim()) {
			continue;
		}
		const nextTask = byLine.get(index);
		if (
			HEADING.test(raw) ||
			(nextTask
				? indentWidth(nextTask.indent) <= width
				: indentWidth(raw.match(/^[\t ]*/)?.[0] ?? '') <= width)
		) {
			break;
		}
		end = index + 1;
	}
	return end;
}

// eslint-disable-next-line eslint/max-params
function moveDailyTask(
	markdown: string,
	sourceLine: number,
	targetLine: number,
	placement: DailyTaskDropPlacement,
): string {
	const source = requireTask(markdown, sourceLine);
	const target = requireTask(markdown, targetLine);
	if (sourceLine === targetLine) {
		return markdown;
	}
	const lines = readLines(markdown);
	const finalEnding = lines.at(-1)!.ending;
	const { tasks } = parseDailyNote(markdown);
	const end = taskEnd(lines, source, tasks);
	if (targetLine > sourceLine && targetLine < end) {
		throw new Error('Cannot move a task inside its own children.');
	}
	const targetEnd = taskEnd(lines, target, tasks);
	let insertIndex = targetEnd;
	if (placement === 'before') {
		insertIndex = targetLine;
	}
	if (placement === 'child') {
		insertIndex = targetLine + 1;
	}
	const child = tasks.find((task) => task.lineIndex > targetLine && task.lineIndex < targetEnd);
	const indent = placement === 'child' ? childIndent(target, child) : target.indent;
	const group = lines.splice(sourceLine, end - sourceLine);
	for (const line of group) {
		if (!line.raw.trim()) {
			continue;
		}
		const oldIndent = line.raw.match(/^[\t ]*/)?.[0] ?? '';
		const relative = oldIndent.startsWith(source.indent)
			? oldIndent.slice(source.indent.length)
			: ' '.repeat(Math.max(0, indentWidth(oldIndent) - indentWidth(source.indent)));
		line.raw = indent + relative + line.raw.slice(oldIndent.length);
	}
	if (insertIndex > sourceLine) {
		insertIndex -= group.length;
	}
	const ending = lines.find((line) => line.ending)?.ending ?? '\n';
	if (insertIndex > 0 && !lines[insertIndex - 1]!.ending) {
		lines[insertIndex - 1]!.ending = ending;
	}
	if (insertIndex < lines.length && !group.at(-1)!.ending) {
		group.at(-1)!.ending = ending;
	}
	lines.splice(insertIndex, 0, ...group);
	lines.at(-1)!.ending = finalEnding;
	return writeLines(lines);
}

function insertDailyTaskTree(
	markdown: string,
	taskMarkdown: string,
	target?: { lineIndex: number; placement: DailyTaskDropPlacement },
): TaskEditResult {
	const sourceLines = readLines(taskMarkdown);
	const [root] = parseDailyNote(taskMarkdown).tasks;
	if (!root || root.lineIndex !== 0 || !root.text.trim()) {
		throw new Error('Daily task tree must start with a nonempty task.');
	}
	const lines = readLines(markdown);
	const { tasks } = parseDailyNote(markdown);
	let indent = '';
	let index = 0;
	if (target) {
		const task = requireTask(markdown, target.lineIndex);
		const end = taskEnd(lines, task, tasks);
		index = target.placement === 'before' ? task.lineIndex : end;
		({ indent } = task);
		if (target.placement === 'child') {
			index = task.lineIndex + 1;
			const child = tasks.find(
				(candidate) => candidate.lineIndex > task.lineIndex && candidate.lineIndex < end,
			);
			indent = childIndent(task, child);
		}
	}
	const raws = sourceLines.map(({ raw }) => {
		if (!raw.trim()) {
			return raw;
		}
		const oldIndent = raw.match(/^[\t ]*/)?.[0] ?? '';
		const relative = oldIndent.startsWith(root.indent)
			? oldIndent.slice(root.indent.length)
			: ' '.repeat(Math.max(0, indentWidth(oldIndent) - indentWidth(root.indent)));
		return indent + relative + raw.slice(oldIndent.length);
	});
	if (target) {
		insertLines(lines, index, raws);
	} else {
		appendTaskLines(lines, raws, 'Plan');
	}
	return {
		markdown: writeLines(lines),
		lineMapping: new Map(
			lines.flatMap((line, lineIndex) =>
				line.original === undefined ? [] : [[line.original, lineIndex]],
			),
		),
	};
}

export {
	addDailyTask,
	createDailyNote,
	dailyLogPath,
	editDailyTask,
	insertDailyTaskTree,
	localDay,
	moveDailyTask,
	parseDailyNote,
	setDailyTaskChecked,
	shiftDay,
};
export type { DailyNote, DailyTask, DailyTaskDropPlacement };
