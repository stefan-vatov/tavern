/* eslint-disable eslint/func-style, eslint/max-statements, eslint/no-continue, eslint/no-magic-numbers, eslint/no-ternary */
import { Effect, Either } from 'effect';
import {
	dailyNotesLevel,
	dailyPlanInsertion,
	insertDailyTaskTree,
	parseDailyNote,
	type DailyTask,
} from './daily-note';
import { indentWidth, parseProjectNote } from './project-note';
import {
	applyTaskDelete,
	applyTaskEdit,
	type TaskDeleteMode,
	type TaskEditPlan,
	type TaskEditResult,
} from './task-edit';

type TaskLine = { raw: string; ending: string; original?: number };
type LocatedTask = DailyTask & { line: TaskLine };

function linesOf(markdown: string): TaskLine[] {
	return Array.from(markdown.matchAll(/([^\r\n]*)(\r\n|\n|\r|$)/g))
		.filter((match) => match[0] !== '')
		.map((match, original) => ({ raw: match[1]!, ending: match[2]!, original }));
}

function projectTasks(markdown: string): { id: string; lineIndex: number }[] | undefined {
	const parsed = Effect.runSync(Effect.either(parseProjectNote(markdown)));
	if (Either.isLeft(parsed)) {
		return undefined;
	}
	let offset = parsed.right.frontmatterLines.length + parsed.right.preambleLines.length;
	return parsed.right.sections.flatMap((section) => {
		offset += 1;
		const tasks = section.tasks.map((task) => ({
			id: task.id,
			lineIndex: offset + task.lineIndex,
		}));
		offset += section.lines.length;
		return tasks;
	});
}

class LinkedTaskDocument {
	readonly original: string;
	readonly isProject: boolean;
	readonly lines: TaskLine[];
	private readonly finalEnding: string;
	private readonly ending: string;
	private parsedMarkdown: string | undefined = undefined;
	private parsedTasks: LocatedTask[] = [];
	private readonly ends = new Map<TaskLine, number>();

	constructor(
		readonly path: string,
		markdown: string,
	) {
		this.original = markdown;
		this.lines = linesOf(markdown);
		this.finalEnding = this.lines.at(-1)?.ending ?? '';
		this.ending = this.lines.find((line) => line.ending)?.ending ?? '\n';
		this.isProject = projectTasks(markdown) !== undefined;
	}

	markdown(): string {
		return this.lines.map((line) => line.raw + line.ending).join('');
	}

	tasks(): LocatedTask[] {
		const markdown = this.markdown();
		if (markdown !== this.parsedMarkdown) {
			this.parsedTasks = parseDailyNote(markdown).tasks.map((task) => ({
				...task,
				line: this.lines[task.lineIndex]!,
			}));
			this.parsedMarkdown = markdown;
			this.ends.clear();
		}
		return this.parsedTasks;
	}

	locate(id: string, project = false): LocatedTask {
		let lineIndex: number | undefined = undefined;
		if (project) {
			const matches = projectTasks(this.markdown())?.filter((task) => task.id === id) ?? [];
			if (matches.length !== 1) {
				throw new Error('Source project task was missing or ambiguous.');
			}
			({ lineIndex } = matches[0]!);
		}
		const matches = this.tasks().filter((task) =>
			lineIndex === undefined ? task.id === id : task.lineIndex === lineIndex,
		);
		if (matches.length !== 1) {
			throw new Error('Daily task was missing or ambiguous.');
		}
		const task = matches[0]!;
		if (task.blockId) {
			this.block(task.blockId);
		}
		return task;
	}

	block(blockId: string): LocatedTask {
		const matches = this.tasks().filter((task) => task.blockId === blockId);
		const occurrences = this.lines.filter(
			(line) => line.raw.match(/(?:^|\s)\^([A-Za-z0-9-]+)\s*$/)?.[1] === blockId,
		);
		if (matches.length !== 1 || occurrences.length !== 1) {
			throw new Error(`Linked task block ^${blockId} was missing or ambiguous.`);
		}
		return matches[0]!;
	}

	at(line: TaskLine): LocatedTask {
		const task = this.tasks().find((candidate) => candidate.line === line);
		if (!task) {
			throw new Error('Task was missing after an earlier operation.');
		}
		return task;
	}

	end(line: TaskLine): number {
		const task = this.at(line);
		const cached = this.ends.get(line);
		if (cached !== undefined) {
			return cached;
		}
		const result = applyTaskDelete(this.markdown(), task.lineIndex, 'tree');
		let end = task.lineIndex + 1;
		while (end < this.lines.length && !result.lineMapping.has(end)) {
			end += 1;
		}
		this.ends.set(line, end);
		return end;
	}

	parent(line: TaskLine): LocatedTask | undefined {
		const index = this.lines.indexOf(line);
		return this.tasks()
			.filter((task) => task.lineIndex < index && this.end(task.line) > index)
			.at(-1);
	}

	group(line: TaskLine): TaskLine[] {
		return this.lines.slice(this.lines.indexOf(line), this.end(line));
	}

	edit(line: TaskLine, plan: TaskEditPlan): TaskLine[] {
		const previous = new Set(this.lines);
		this.apply(applyTaskEdit(this.markdown(), this.at(line).lineIndex, plan));
		return this.tasks()
			.filter((task) => !previous.has(task.line))
			.map((task) => task.line);
	}

	delete(line: TaskLine, mode: TaskDeleteMode): void {
		this.apply(applyTaskDelete(this.markdown(), this.at(line).lineIndex, mode));
	}

	apply(result: TaskEditResult): void {
		this.parsedMarkdown = undefined;
		const previous = [...this.lines];
		const byNewLine = new Map(
			[...result.lineMapping].map(([before, after]) => [after, previous[before]!]),
		);
		this.lines.splice(
			0,
			this.lines.length,
			...linesOf(result.markdown).map((parsed, index) => {
				const retained = byNewLine.get(index);
				if (retained) {
					retained.raw = parsed.raw;
					retained.ending = parsed.ending;
					return retained;
				}
				return { raw: parsed.raw, ending: parsed.ending };
			}),
		);
	}

	setChecked(line: TaskLine, checked: boolean): void {
		this.at(line);
		line.raw = line.raw.replace(/^(\s*[-+*] \[)[ xX](\])/, `$1${checked ? 'x' : ' '}$2`);
	}

	assignId(line: TaskLine, id: string): void {
		this.at(line);
		line.raw = `${line.raw.replace(/\s*\^[A-Za-z0-9-]+\s*$/, '')} ^${id}`;
	}

	insertTree(
		markdown: string,
		target?: { line: TaskLine; placement: 'before' | 'after' | 'child' },
	): void {
		this.apply(
			insertDailyTaskTree(
				this.markdown(),
				markdown,
				target
					? { lineIndex: this.at(target.line).lineIndex, placement: target.placement }
					: undefined,
			),
		);
	}

	insert(index: number, rows: TaskLine[]): void {
		this.parsedMarkdown = undefined;
		this.lines.splice(index, 0, ...rows);
		this.finish();
	}

	sectionIndex(name: string): number {
		const visiblePlan = name === 'Plan' && !this.isProject;
		if (visiblePlan) {
			const index = dailyPlanInsertion(this.markdown());
			if (index !== undefined) {
				return index;
			}
		}
		const headings = parseDailyNote(this.markdown()).items.filter(
			(item) => item.type === 'heading',
		);
		const heading = headings.find(
			(item) => item.text === name && (!this.isProject || item.level === 2) && !visiblePlan,
		);
		if (heading) {
			let index =
				headings.find((item) => item.lineIndex > heading.lineIndex && item.level <= heading.level)
					?.lineIndex ?? this.lines.length;
			while (index > heading.lineIndex + 1 && !this.lines[index - 1]!.raw.trim()) {
				index -= 1;
			}
			return index;
		}
		const index = this.isProject
			? (headings.find((item) => item.text === 'Notes & Decisions')?.lineIndex ?? this.lines.length)
			: this.lines.length;
		const defaultLevel = this.isProject ? 2 : 3;
		const level = visiblePlan
			? Math.min(
					defaultLevel,
					dailyNotesLevel(parseDailyNote(this.markdown()), index) ?? defaultLevel,
				)
			: defaultLevel;
		this.insert(index, [
			{ raw: `${'#'.repeat(level)} ${name}`, ending: this.ending },
			{ raw: '', ending: this.ending },
		]);
		return index + 2;
	}

	isHidden(line: TaskLine): boolean {
		return dailyNotesLevel(parseDailyNote(this.markdown()), this.lines.indexOf(line)) !== undefined;
	}

	move(line: TaskLine, target: TaskLine, placement: 'before' | 'after' | 'child'): void {
		if (line === target) {
			return;
		}
		const root = this.at(line);
		const destination = this.at(target);
		const end = this.end(line);
		if (destination.lineIndex > root.lineIndex && destination.lineIndex < end) {
			throw new Error('Cannot move a task inside its own children.');
		}
		const targetEnd = this.end(target);
		const child = this.tasks().find(
			(task) => task.lineIndex > destination.lineIndex && task.lineIndex < targetEnd,
		);
		const indent =
			placement === 'child' ? (child?.indent ?? `${destination.indent}  `) : destination.indent;
		let index = placement === 'before' ? destination.lineIndex : targetEnd;
		if (placement === 'child') {
			index = destination.lineIndex + 1;
		}
		const rows = this.lines.splice(root.lineIndex, end - root.lineIndex);
		this.reindent(rows, root.indent, indent);
		if (index > root.lineIndex) {
			index -= rows.length;
		}
		this.insert(index, rows);
	}

	moveSection(line: TaskLine, section: string): void {
		const root = this.at(line);
		const rows = this.lines.splice(root.lineIndex, this.end(line) - root.lineIndex);
		this.reindent(rows, root.indent, '');
		this.insert(this.sectionIndex(section), rows);
	}

	reindent(rows: TaskLine[], from: string, to: string): void {
		for (const line of rows) {
			if (!line.raw.trim()) {
				continue;
			}
			const [indent] = line.raw.match(/^[\t ]*/)!;
			const relative = indent.startsWith(from)
				? indent.slice(from.length)
				: ' '.repeat(Math.max(0, indentWidth(indent) - indentWidth(from)));
			line.raw = to + relative + line.raw.slice(indent.length);
		}
	}

	mapping(project = false): Map<string, string> {
		const before = project ? projectTasks(this.original)! : parseDailyNote(this.original).tasks;
		const after = project ? projectTasks(this.markdown())! : this.tasks();
		const byLine = new Map(after.map((task) => [task.lineIndex, task.id]));
		const originals = new Map(
			this.lines.flatMap((line, index) =>
				line.original === undefined ? [] : [[line.original, index] as const],
			),
		);
		return new Map(
			before.map((task) => {
				const index = originals.get(task.lineIndex);
				return [task.id, index === undefined ? '' : (byLine.get(index) ?? '')];
			}),
		);
	}

	newLine(raw: string): TaskLine {
		return { raw, ending: this.ending };
	}

	private finish(): void {
		for (const line of this.lines.slice(0, -1)) {
			line.ending ||= this.ending;
		}
		if (this.lines.length) {
			this.lines.at(-1)!.ending = this.finalEnding;
		}
	}
}

export { LinkedTaskDocument };
export type { TaskLine };
