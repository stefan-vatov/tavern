/* eslint-disable eslint/func-style, eslint/max-statements, eslint/no-continue, eslint/no-magic-numbers, eslint/no-ternary */
import { parseDailyNote } from './daily-note';

type TaskEditTree = { text: string; children: TaskEditTree[] };
type TaskEditPlan = { text: string; children: TaskEditTree[]; siblings: TaskEditTree[] };
type TaskDeleteMode = 'task' | 'tree';
type TaskEditResult = { markdown: string; lineMapping: Map<number, number> };
type EditLine = { raw: string; ending: string; original?: number };

const TASK = /^([\t ]*)([-+*] \[)([ xX])(\][\t ]*)(.*)$/;

function width(indent: string): number {
	return indent.replace(/\t/g, '    ').length;
}

function cleanText(text: string): string {
	if (/[\r\n]/.test(text)) {
		throw new Error('Task text must be a single line.');
	}
	return text.trim();
}

function draftLines(trees: TaskEditTree[], indent: string, unit: string): string[] {
	return trees.flatMap((tree) => {
		const text = cleanText(tree.text);
		if (!text) {
			return draftLines(tree.children, indent, unit);
		}
		return [`${indent}- [ ] ${text}`, ...draftLines(tree.children, indent + unit, unit)];
	});
}

function hasTaskEditContent(plan: TaskEditPlan): boolean {
	const hasText = (tree: TaskEditTree): boolean =>
		Boolean(tree.text.trim()) || tree.children.some(hasText);
	return [{ text: plan.text, children: plan.children }, ...plan.siblings].some(hasText);
}

function readEditLines(markdown: string): EditLine[] {
	return Array.from(markdown.matchAll(/([^\r\n]*)(\r\n|\n|\r|$)/g))
		.filter((match) => match[0] !== '')
		.map((match, original) => ({ raw: match[1] ?? '', ending: match[2] ?? '', original }));
}

function taskHasChildren(markdown: string, lineIndex: number): boolean {
	const { tasks } = parseDailyNote(markdown);
	const task = tasks.find((candidate) => candidate.lineIndex === lineIndex);
	if (!task) {
		return false;
	}
	const end = subtreeEnd(readEditLines(markdown), lineIndex, task.indent);
	return tasks.some((candidate) => candidate.lineIndex > lineIndex && candidate.lineIndex < end);
}

function subtreeEnd(lines: EditLine[], lineIndex: number, indent: string): number {
	let end = lineIndex + 1;
	let fence: { marker: string; length: number } | undefined = undefined;
	for (let index = end; index < lines.length; index += 1) {
		const { raw } = lines[index]!;
		const fenceMatch = raw.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
		if (fence) {
			end = index + 1;
			if (
				fenceMatch?.[1]?.[0] === fence.marker &&
				fenceMatch[1].length >= fence.length &&
				!fenceMatch[2]?.trim()
			) {
				fence = undefined;
			}
			continue;
		}
		if (!raw.trim()) {
			continue;
		}
		if (/^ {0,3}#{1,6}\s+/.test(raw) || width(raw.match(/^[\t ]*/)?.[0] ?? '') <= width(indent)) {
			break;
		}
		if (fenceMatch) {
			fence = { marker: fenceMatch[1]![0]!, length: fenceMatch[1]!.length };
		}
		end = index + 1;
	}
	return end;
}

function promoteLine(raw: string, indent: string, amount: number): string {
	if (!raw.trim()) {
		return raw;
	}
	const oldIndent = raw.match(/^[\t ]*/)?.[0] ?? '';
	let removed = 0;
	let consumed = 0;
	const relative = oldIndent.startsWith(indent) ? oldIndent.slice(indent.length) : oldIndent;
	const target = oldIndent.startsWith(indent) ? amount : amount + width(indent);
	while (consumed < relative.length && removed < target) {
		removed += relative[consumed] === '\t' ? 4 : 1;
		consumed += 1;
	}
	return (
		indent +
		' '.repeat(Math.max(0, removed - target)) +
		relative.slice(consumed) +
		raw.slice(oldIndent.length)
	);
}

function applyTaskEdit(markdown: string, lineIndex: number, plan: TaskEditPlan): TaskEditResult {
	const task = parseDailyNote(markdown).tasks.find(
		(candidate) => candidate.lineIndex === lineIndex,
	);
	if (!task) {
		throw new Error(`Task was not found at line ${lineIndex}.`);
	}
	const lines = readEditLines(markdown);
	const finalEnding = lines.at(-1)!.ending;
	const ending = lines[lineIndex]!.ending || lines.find((line) => line.ending)?.ending || '\n';
	const end = subtreeEnd(lines, lineIndex, task.indent);
	const existing = lines.slice(lineIndex + 1, end);
	const descendantIndents = parseDailyNote(markdown)
		.tasks.filter((candidate) => candidate.lineIndex > lineIndex && candidate.lineIndex < end)
		.map((candidate) => candidate.indent);
	const nestedIndents = existing
		.filter((line) => line.raw.trim())
		.map((line) => line.raw.match(/^[\t ]*/)![0]);
	const [childIndent] = (descendantIndents.length ? descendantIndents : nestedIndents).sort(
		(left, right) => width(left) - width(right),
	);
	let unit = task.indent.endsWith('\t') || task.indent.endsWith('    ') ? '\t' : '  ';
	if (childIndent) {
		unit = childIndent.startsWith(task.indent)
			? childIndent.slice(task.indent.length)
			: ' '.repeat(width(childIndent) - width(task.indent));
	}
	const text = cleanText(plan.text);
	const children = draftLines(plan.children, text ? task.indent + unit : task.indent, unit);
	const siblings = draftLines(plan.siblings, task.indent, unit);
	const root = lines[lineIndex]!;
	const match = root.raw.match(TASK)!;
	const suffix = task.blockId ? (match[5]!.match(/\s*\^[A-Za-z0-9-]+\s*$/)?.[0] ?? '') : '';
	if (text) {
		root.raw = `${match[1]}${match[2]}${match[3]}${match[4]}${text}${suffix}`;
	} else {
		for (const line of existing) {
			line.raw = promoteLine(line.raw, task.indent, width(unit));
		}
	}
	const added = (raws: string[]): EditLine[] => raws.map((raw) => ({ raw, ending }));
	lines.splice(
		lineIndex,
		end - lineIndex,
		...(text ? [root] : []),
		...added(children),
		...existing,
		...added(siblings),
	);
	for (const line of lines.slice(0, -1)) {
		if (!line.ending) {
			line.ending = ending;
		}
	}
	if (lines.length) {
		lines.at(-1)!.ending = finalEnding;
	}
	const lineMapping = new Map<number, number>();
	for (const [index, line] of lines.entries()) {
		if (line.original !== undefined) {
			lineMapping.set(line.original, index);
		}
	}
	return { markdown: lines.map((line) => line.raw + line.ending).join(''), lineMapping };
}

function applyTaskDelete(
	markdown: string,
	lineIndex: number,
	mode: TaskDeleteMode,
): TaskEditResult {
	if (mode === 'task') {
		return applyTaskEdit(markdown, lineIndex, { text: '', children: [], siblings: [] });
	}
	const task = parseDailyNote(markdown).tasks.find(
		(candidate) => candidate.lineIndex === lineIndex,
	);
	if (!task) {
		throw new Error(`Task was not found at line ${lineIndex}.`);
	}
	const lines = readEditLines(markdown);
	const finalEnding = lines.at(-1)!.ending;
	lines.splice(lineIndex, subtreeEnd(lines, lineIndex, task.indent) - lineIndex);
	if (lines.length) {
		lines.at(-1)!.ending = finalEnding;
	}
	return {
		markdown: lines.map((line) => line.raw + line.ending).join(''),
		lineMapping: new Map(lines.map((line, index) => [line.original!, index])),
	};
}

export { applyTaskDelete, applyTaskEdit, hasTaskEditContent, taskHasChildren };
export type { TaskDeleteMode, TaskEditPlan, TaskEditResult, TaskEditTree };
