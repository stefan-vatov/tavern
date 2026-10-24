/* eslint-disable eslint/func-style, eslint/max-statements, eslint/no-continue, eslint/no-magic-numbers, eslint/no-ternary */
import { Effect } from 'effect';
import type {
	DailyLogController,
	DailyLogDropTarget,
	DailyLogSnapshot,
} from './daily-log-controller';
import { DailyLogStore } from './daily-log-store';
import {
	insertDailyTaskTree,
	parseDailyNote,
	setDailyTaskChecked,
	type DailyTask,
} from './daily-note';
import {
	addProjectTaskPlan,
	editProjectTaskPlan,
	setProjectTaskChecked,
	type ProjectActionError,
} from './project-actions';
import type { TaskEditPlan } from './task-edit';
import type { ProjectBoardTask } from './project-library';
import { indentWidth, parseProjectNote } from './project-note';

type TaskEndpoint = { path: string; blockId: string };
type DailyTaskLink = { source: TaskEndpoint; copies: TaskEndpoint[]; checked: boolean };
type DailyLogServiceOptions = {
	links: () => DailyTaskLink[];
	saveLinks: (links: DailyTaskLink[]) => Promise<void>;
	remapTaskKeys: (mapping: Map<string, string>) => Promise<() => Promise<void>>;
};

const sameEndpoint = (left: TaskEndpoint, right: TaskEndpoint): boolean =>
	left.path === right.path && left.blockId === right.blockId;
const endpoints = (link: DailyTaskLink): TaskEndpoint[] => [link.source, ...link.copies];

function blockTask(markdown: string, blockId: string): DailyTask {
	const matches = parseDailyNote(markdown).tasks.filter((task) => task.blockId === blockId);
	const occurrences = markdown.split(/\r\n|\n|\r/).filter((line) => {
		const suffix = line.match(/(?:^|\s)\^([A-Za-z0-9-]+)\s*$/);
		return suffix?.[1] === blockId;
	});
	if (matches.length !== 1 || occurrences.length !== 1) {
		throw new Error(`Linked task block ^${blockId} was missing or ambiguous.`);
	}
	return matches[0]!;
}

function nextBlockId(markdown: string, used: Set<string>): string {
	const id = `tavern-${globalThis.crypto.randomUUID()}`;
	if (used.has(id) || markdown.includes(`^${id}`)) {
		throw new Error('Generated task block ID already exists.');
	}
	used.add(id);
	return id;
}

class DailyLogService implements DailyLogController {
	private pending: Promise<unknown> = Promise.resolve();
	private disposed = false;

	constructor(
		private readonly store: DailyLogStore,
		private readonly options: DailyLogServiceOptions,
	) {}

	today(): string {
		return this.store.today();
	}

	read(day: string): Promise<DailyLogSnapshot> {
		return this.enqueue(() => this.store.read(day));
	}

	create(day: string): Promise<void> {
		return this.enqueue(() => this.store.create(day));
	}

	addTask(day: string, text: string): Promise<void> {
		return this.enqueue(() => this.store.addTask(day, text));
	}

	editTask(day: string, taskId: string, text: string): Promise<void> {
		return this.enqueue(() => this.store.editTask(day, taskId, text));
	}

	addTaskPlan(day: string, plan: TaskEditPlan): Promise<void> {
		return this.enqueue(() => this.store.addTaskPlan(day, plan));
	}

	editTaskPlan(day: string, taskId: string, plan: TaskEditPlan): Promise<void> {
		return this.enqueue(async () => {
			const links = structuredClone(this.options.links());
			if (!plan.text.trim()) {
				await this.unlinkRemovedTask(this.store.path(day), taskId);
			}
			try {
				await this.store.editTaskPlan(day, taskId, plan);
			} catch (error) {
				if (JSON.stringify(this.options.links()) !== JSON.stringify(links)) {
					await this.options.saveLinks(links);
				}
				throw error;
			}
		});
	}

	editProjectTaskPlan(task: ProjectBoardTask, plan: TaskEditPlan): Promise<void> {
		return this.enqueue(() =>
			this.writeProjectTaskPlan(
				task.projectPath,
				(markdown) => editProjectTaskPlan(markdown, task.id, plan),
				plan.text.trim() ? undefined : task.id,
			),
		);
	}

	addProjectTaskPlan(projectPath: string, sectionName: string, plan: TaskEditPlan): Promise<void> {
		return this.enqueue(() =>
			this.writeProjectTaskPlan(projectPath, (markdown) =>
				addProjectTaskPlan(markdown, sectionName, plan),
			),
		);
	}

	private async writeProjectTaskPlan(
		path: string,
		prepare: (
			markdown: string,
		) => Effect.Effect<{ markdown: string; mapping: Map<string, string> }, ProjectActionError>,
		removedId?: string,
	): Promise<void> {
		const file = this.requireFile(path);
		const result = await Effect.runPromise(prepare(await this.store.vault.read(file)));
		const links = structuredClone(this.options.links());
		let undoKeys: (() => Promise<void>) | undefined = undefined;
		try {
			if (removedId) {
				await this.unlinkRemovedTask(path, removedId);
			}
			const mapping = new Map(
				[...result.mapping].map(([before, after]) => [
					`${path}::${before}`,
					after ? `${path}::${after}` : '',
				]),
			);
			undoKeys = await this.options.remapTaskKeys(mapping);
			this.assertActive();
			await this.store.vault.modify(file, result.markdown);
		} catch (error) {
			try {
				await undoKeys?.();
			} finally {
				if (JSON.stringify(this.options.links()) !== JSON.stringify(links)) {
					await this.options.saveLinks(links);
				}
			}
			throw error;
		}
	}

	private async unlinkRemovedTask(path: string, taskId: string): Promise<void> {
		if (!taskId.startsWith('block:')) {
			return;
		}
		const removed = { path, blockId: taskId.slice('block:'.length) };
		const links = this.options.links();
		const next = links
			.filter((link) => !sameEndpoint(link.source, removed))
			.map((link) => ({
				...link,
				copies: link.copies.filter((copy) => !sameEndpoint(copy, removed)),
			}))
			.filter((link) => link.copies.length > 0);
		if (JSON.stringify(next) !== JSON.stringify(links)) {
			await this.options.saveLinks(next);
		}
	}

	moveTask(day: string, sourceId: string, target: DailyLogDropTarget): Promise<void> {
		return this.enqueue(() => this.store.moveTask(day, sourceId, target));
	}

	setTaskChecked(day: string, taskId: string, checked: boolean): Promise<void> {
		return this.enqueue(async () => {
			const path = this.store.path(day);
			const link = this.options
				.links()
				.find((entry) =>
					entry.copies.some((copy) => copy.path === path && `block:${copy.blockId}` === taskId),
				);
			if (link) {
				await this.propagate(link, checked);
			} else {
				await this.store.setTaskChecked(day, taskId, checked);
			}
		});
	}

	isLinked(task: ProjectBoardTask): boolean {
		return this.options
			.links()
			.some(
				(link) =>
					link.source.path === task.projectPath && `block:${link.source.blockId}` === task.id,
			);
	}

	setProjectTaskChecked(task: ProjectBoardTask, checked: boolean): Promise<void> {
		return this.enqueue(async () => {
			const link = this.options
				.links()
				.find(
					(entry) =>
						entry.source.path === task.projectPath && `block:${entry.source.blockId}` === task.id,
				);
			if (!link) {
				throw new Error('Project task was not linked to a daily note.');
			}
			await this.propagate(link, checked);
		});
	}

	copyProjectTask(day: string, task: ProjectBoardTask, target?: DailyLogDropTarget): Promise<void> {
		return this.enqueue(async () => {
			const destination = this.store.path(day);
			const file = this.requireFile(destination);
			const existing = await this.store.vault.read(file);
			if (target) {
				this.dropLine(existing, target);
			}
			const originalLinks = structuredClone(this.options.links());
			const prepared = await this.prepareCopy(task, destination, existing);
			await this.options.remapTaskKeys(prepared.mapping);
			this.assertActive();
			await this.options.saveLinks(prepared.links);
			try {
				this.assertActive();
				await this.store.vault.process(file, (markdown) => {
					for (const copied of parseDailyNote(prepared.markdown).tasks) {
						if (copied.blockId && markdown.includes(`^${copied.blockId}`)) {
							throw new Error('Copied task block ID already exists in the destination.');
						}
					}
					return insertDailyTaskTree(
						markdown,
						prepared.markdown,
						target ? this.dropLine(markdown, target) : undefined,
					);
				});
			} catch (error) {
				await this.options.saveLinks(originalLinks);
				throw error;
			}
		});
	}

	private async prepareCopy(
		task: ProjectBoardTask,
		destination: string,
		destinationMarkdown: string,
	): Promise<{
		markdown: string;
		mapping: Map<string, string>;
		links: DailyTaskLink[];
	}> {
		const mapping = new Map<string, string>();
		const links = structuredClone(this.options.links());
		let copied = '';
		await this.store.vault.process(this.requireFile(task.projectPath), (markdown) => {
			const note = Effect.runSync(parseProjectNote(markdown));
			const located = note.sections
				.flatMap((section) => section.tasks)
				.filter((candidate) => candidate.id === task.id);
			if (located.length !== 1) {
				throw new Error('Source project task was missing or ambiguous.');
			}
			const root = located[0]!;
			let start = note.frontmatterLines.length + note.preambleLines.length;
			for (const section of note.sections) {
				start += 1;
				if (section.tasks.includes(root)) {
					start += root.lineIndex;
					break;
				}
				start += section.lines.length;
			}
			const lines = Array.from(markdown.matchAll(/([^\r\n]*)(\r\n|\n|\r|$)/g))
				.filter((match) => match[0] !== '')
				.map((match) => ({ raw: match[1]!, ending: match[2]! }));
			let end = start + 1;
			while (end < lines.length) {
				const { raw } = lines[end]!;
				if (
					raw.trim() &&
					indentWidth(raw.match(/^[\t ]*/)?.[0] ?? '') <= indentWidth(root.indent)
				) {
					break;
				}
				end += 1;
			}
			const used = new Set<string>();
			const copyLines: string[] = [];
			const sourceTasks = note.sections.find((section) => section.tasks.includes(root))!.tasks;
			for (let index = start; index < end; index += 1) {
				const line = lines[index]!;
				const [parsed] = parseDailyNote(line.raw).tasks;
				if (!parsed) {
					copyLines.push(line.raw);
					continue;
				}
				let sourceId = parsed.blockId;
				if (sourceId) {
					blockTask(markdown, sourceId);
				} else {
					sourceId = nextBlockId(`${markdown}\n${destinationMarkdown}`, used);
					const oldTask = sourceTasks.find(
						(candidate) => candidate.lineIndex === root.lineIndex + index - start,
					);
					if (!oldTask) {
						throw new Error('Source task identity could not be resolved.');
					}
					mapping.set(
						`${task.projectPath}::${oldTask.id}`,
						`${task.projectPath}::block:${sourceId}`,
					);
					line.raw += ` ^${sourceId}`;
				}
				const copyId = nextBlockId(`${markdown}\n${destinationMarkdown}`, used);
				copyLines.push(line.raw.replace(/\s*\^[A-Za-z0-9-]+\s*$/, ` ^${copyId}`));
				const source = { path: task.projectPath, blockId: sourceId };
				const copy = { path: destination, blockId: copyId };
				const link = links.find((entry) => sameEndpoint(entry.source, source));
				if (link) {
					link.copies.push(copy);
				} else {
					links.push({ source, copies: [copy], checked: parsed.checked });
				}
			}
			copied = copyLines.join('\n');
			return lines.map((line) => line.raw + line.ending).join('');
		});
		return { markdown: copied, mapping, links };
	}

	private dropLine(
		markdown: string,
		target: DailyLogDropTarget,
	): { lineIndex: number; placement: DailyLogDropTarget['placement'] } {
		if (target.taskId.startsWith('block:')) {
			blockTask(markdown, target.taskId.slice('block:'.length));
		}
		const matches = parseDailyNote(markdown).tasks.filter((task) => task.id === target.taskId);
		if (matches.length !== 1) {
			throw new Error('Daily drop target was missing or ambiguous.');
		}
		return { lineIndex: matches[0]!.lineIndex, placement: target.placement };
	}

	syncFile(path: string): Promise<void> {
		return this.enqueue(async () => {
			for (const link of this.options.links()) {
				const changed = endpoints(link).filter((endpoint) => endpoint.path === path);
				if (changed.length === 0) {
					continue;
				}
				const states = await Promise.all(changed.map((endpoint) => this.readChecked(endpoint)));
				const delta = states.find((checked) => checked !== link.checked);
				if (delta !== undefined) {
					await this.propagate(link, delta);
				}
			}
		});
	}

	syncAll(): Promise<void> {
		return this.enqueue(async () => {
			for (const link of this.options.links()) {
				const states = await Promise.all(
					endpoints(link).map((endpoint) => this.readChecked(endpoint)),
				);
				const delta = states.find((checked) => checked !== link.checked);
				if (delta !== undefined) {
					await this.propagate(link, delta);
				}
			}
		});
	}

	private async readChecked(endpoint: TaskEndpoint): Promise<boolean> {
		const markdown = await this.store.vault.read(this.requireFile(endpoint.path));
		return blockTask(markdown, endpoint.blockId).checked;
	}

	private async propagate(link: DailyTaskLink, checked: boolean): Promise<void> {
		await Promise.all(endpoints(link).map((endpoint) => this.readChecked(endpoint)));
		for (const endpoint of endpoints(link)) {
			this.assertActive();
			await this.store.vault.process(this.requireFile(endpoint.path), (markdown) => {
				const task = blockTask(markdown, endpoint.blockId);
				if (sameEndpoint(endpoint, link.source)) {
					return Effect.runSync(
						setProjectTaskChecked(markdown, `block:${endpoint.blockId}`, checked),
					);
				}
				return setDailyTaskChecked(markdown, task.lineIndex, checked);
			});
		}
		this.assertActive();
		await this.options.saveLinks(
			this.options
				.links()
				.map((entry) => (sameEndpoint(entry.source, link.source) ? { ...entry, checked } : entry)),
		);
	}

	renameFile(oldPath: string, newPath: string): Promise<void> {
		return this.enqueue(async () => {
			const rename = (endpoint: TaskEndpoint): TaskEndpoint => ({
				...endpoint,
				path:
					endpoint.path === oldPath || endpoint.path.startsWith(`${oldPath}/`)
						? newPath + endpoint.path.slice(oldPath.length)
						: endpoint.path,
			});
			const current = this.options.links();
			const links = current.map((link) => ({
				...link,
				source: rename(link.source),
				copies: link.copies.map(rename),
			}));
			if (JSON.stringify(links) !== JSON.stringify(current)) {
				const mapping = new Map<string, string>();
				for (const link of current) {
					const next = rename(link.source);
					if (next.path !== link.source.path) {
						mapping.set(
							`${link.source.path}::block:${link.source.blockId}`,
							`${next.path}::block:${next.blockId}`,
						);
					}
				}
				await this.options.remapTaskKeys(mapping);
				await this.options.saveLinks(links);
			}
		});
	}

	dispose(): void {
		this.disposed = true;
	}

	private requireFile(path: string): { path: string } {
		const file = this.store.vault.getAbstractFileByPath(path);
		if (!file) {
			throw new Error(`Linked note was not found: ${path}`);
		}
		return file;
	}

	private assertActive(): void {
		if (this.disposed) {
			throw new Error('Daily log service was disposed.');
		}
	}

	private enqueue<Result>(action: () => Promise<Result>): Promise<Result> {
		const previous = this.pending;
		const result = (async () => {
			await previous;
			this.assertActive();
			return action();
		})();
		this.pending = (async () => {
			try {
				await result;
			} catch {
				return;
			}
		})();
		return result;
	}
}

export { DailyLogService };
export type { DailyTaskLink };
