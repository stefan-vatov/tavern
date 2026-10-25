import type { DailyLogDropTarget, DailyLogSnapshot } from './daily-log-controller';
import {
	addDailyTask,
	createDailyNote,
	dailyLogPath,
	editDailyTask,
	localDay,
	insertDailyTaskTree,
	moveDailyTask,
	parseDailyNote,
	setDailyTaskChecked,
	type DailyTask,
} from './daily-note';
import type { ProjectVault, ProjectVaultFile } from './project-vault';
import {
	applyTaskDelete,
	applyTaskEdit,
	hasTaskEditContent,
	type TaskDeleteMode,
	type TaskEditPlan,
	type TaskEditResult,
} from './task-edit';

interface DailyLogVault extends ProjectVault {
	getAbstractFileByPath(path: string): ProjectVaultFile | null;
	create(path: string, markdown: string): Promise<ProjectVaultFile>;
	createFolder(path: string): Promise<unknown>;
	process(file: ProjectVaultFile, transform: (markdown: string) => string): Promise<string>;
}

const UNIQUE_TASK_COUNT = 1;

const findDailyTask = (markdown: string, taskId: string): DailyTask => {
	const matches = parseDailyNote(markdown).tasks.filter((candidate) => candidate.id === taskId);
	const [task] = matches;
	if (!task) {
		throw new Error('Daily task was not found.');
	}
	const blocks = markdown.split(/\r\n|\n|\r/).filter((line) => {
		const [, blockId] = line.match(/(?:^|\s)\^([A-Za-z0-9-]+)\s*$/) ?? [];
		return blockId === task.blockId;
	});
	if (matches.length > UNIQUE_TASK_COUNT || (task.blockId && blocks.length !== UNIQUE_TASK_COUNT)) {
		throw new Error('Daily task identity is ambiguous.');
	}
	return task;
};

const mapDailyTasks = (
	before: DailyTask[],
	transformed: TaskEditResult,
	staged = before,
): Map<string, string> => {
	const byLine = new Map(
		parseDailyNote(transformed.markdown).tasks.map((task) => [task.lineIndex, task.id]),
	);
	return new Map(
		before.map((task, index) => {
			const line = transformed.lineMapping.get(staged[index]!.lineIndex);
			let id = '';
			if (line !== undefined) {
				id = byLine.get(line) ?? '';
			}
			return [task.id, id];
		}),
	);
};

const addDailyTaskPlan = (markdown: string, plan: TaskEditPlan): TaskEditResult => {
	const before = parseDailyNote(markdown).tasks;
	if (!hasTaskEditContent(plan)) {
		const lines = Array.from(markdown.matchAll(/([^\r\n]*)(\r\n|\n|\r|$)/g)).filter(
			([matched]) => matched !== '',
		);
		return { markdown, lineMapping: new Map(lines.map((_line, index) => [index, index])) };
	}
	let anchorText = 'Draft';
	while (before.some((task) => task.text === anchorText)) {
		anchorText += ' draft';
	}
	const staged = insertDailyTaskTree(markdown, `- [ ] ${anchorText}`);
	const transformed = applyTaskEdit(
		staged.markdown,
		parseDailyNote(staged.markdown).tasks.find((task) => task.text === anchorText)!.lineIndex,
		plan,
	);
	return {
		markdown: transformed.markdown,
		lineMapping: new Map(
			[...staged.lineMapping].flatMap(([beforeLine, stagedLine]) => {
				const afterLine = transformed.lineMapping.get(stagedLine);
				if (afterLine === undefined) {
					return [];
				}
				return [[beforeLine, afterLine]];
			}),
		),
	};
};

class DailyLogStore {
	// eslint-disable-next-line eslint/max-params -- Preserve the injected clock while adding the production note creator.
	constructor(
		public readonly vault: DailyLogVault,
		private readonly folder: () => string,
		private readonly now: () => Date = () => new Date(),
		private readonly createNote?: (path: string, day: string) => Promise<boolean>,
	) {}

	today(): string {
		return localDay(this.now());
	}

	path(day: string): string {
		return dailyLogPath(this.folder(), day);
	}

	async read(day: string): Promise<DailyLogSnapshot> {
		const path = this.path(day);
		const file = this.vault.getAbstractFileByPath(path);
		if (!file) {
			return { day, path, note: null };
		}
		return { day, path, note: parseDailyNote(await this.vault.read(file)) };
	}

	async create(day: string): Promise<boolean> {
		const path = this.path(day);
		if (this.createNote) {
			return this.createNote(path, day);
		}
		return this.createBasicNote(path, day);
	}

	private async createBasicNote(path: string, day: string): Promise<boolean> {
		if (this.vault.getAbstractFileByPath(path)) {
			return false;
		}
		await this.createAncestors(path);
		try {
			await this.vault.create(path, createDailyNote(day));
			return true;
		} catch (error) {
			if (!this.vault.getAbstractFileByPath(path)) {
				throw error;
			}
			return false;
		}
	}

	private async createAncestors(path: string): Promise<void> {
		const ancestors = path.split('/');
		ancestors.pop();
		const segments: string[] = [];
		for (const segment of ancestors) {
			segments.push(segment);
			await this.createFolder(segments.join('/'));
		}
	}

	private async createFolder(path: string): Promise<void> {
		if (this.vault.getAbstractFileByPath(path)) {
			return;
		}
		try {
			await this.vault.createFolder(path);
		} catch (error) {
			if (!this.vault.getAbstractFileByPath(path)) {
				throw error;
			}
		}
	}

	async update(day: string, transform: (markdown: string) => string): Promise<void> {
		const file = this.vault.getAbstractFileByPath(this.path(day));
		if (!file) {
			throw new Error('Daily note was not found.');
		}
		await this.vault.process(file, transform);
	}

	async addTask(day: string, text: string): Promise<void> {
		await this.update(day, (markdown) => addDailyTask(markdown, text));
	}

	async editTask(day: string, taskId: string, text: string): Promise<void> {
		await this.update(day, (markdown) =>
			editDailyTask(markdown, findDailyTask(markdown, taskId).lineIndex, text),
		);
	}

	async deleteTask(
		day: string,
		taskId: string,
		mode: TaskDeleteMode,
	): Promise<Map<string, string>> {
		let mapping = new Map<string, string>();
		await this.update(day, (markdown) => {
			const transformed = applyTaskDelete(
				markdown,
				findDailyTask(markdown, taskId).lineIndex,
				mode,
			);
			mapping = mapDailyTasks(parseDailyNote(markdown).tasks, transformed);
			return transformed.markdown;
		});
		return mapping;
	}

	async editTaskPlan(
		day: string,
		taskId: string,
		plan: TaskEditPlan,
	): Promise<Map<string, string>> {
		let mapping = new Map<string, string>();
		await this.update(day, (markdown) => {
			const transformed = applyTaskEdit(markdown, findDailyTask(markdown, taskId).lineIndex, plan);
			mapping = mapDailyTasks(parseDailyNote(markdown).tasks, transformed);
			return transformed.markdown;
		});
		return mapping;
	}

	async addTaskPlan(day: string, plan: TaskEditPlan): Promise<Map<string, string>> {
		if (!hasTaskEditContent(plan)) {
			const snapshot = await this.read(day);
			return new Map(snapshot.note?.tasks.map((task) => [task.id, task.id]));
		}
		let mapping = new Map<string, string>();
		await this.update(day, (markdown) => {
			const transformed = addDailyTaskPlan(markdown, plan);
			mapping = mapDailyTasks(parseDailyNote(markdown).tasks, transformed);
			return transformed.markdown;
		});
		return mapping;
	}

	async setTaskChecked(day: string, taskId: string, checked: boolean): Promise<void> {
		await this.update(day, (markdown) =>
			setDailyTaskChecked(markdown, findDailyTask(markdown, taskId).lineIndex, checked),
		);
	}

	async moveTask(day: string, sourceId: string, target: DailyLogDropTarget): Promise<void> {
		await this.update(day, (markdown) =>
			moveDailyTask(
				markdown,
				findDailyTask(markdown, sourceId).lineIndex,
				findDailyTask(markdown, target.taskId).lineIndex,
				target.placement,
			),
		);
	}
}

export { addDailyTaskPlan, DailyLogStore };
export type { DailyLogVault };
