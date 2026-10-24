import type { DailyLogDropTarget, DailyLogSnapshot } from './daily-log-controller';
import {
	addDailyTask,
	createDailyNote,
	dailyLogPath,
	editDailyTask,
	localDay,
	moveDailyTask,
	parseDailyNote,
	setDailyTaskChecked,
	type DailyTask,
} from './daily-note';
import type { ProjectVault, ProjectVaultFile } from './project-vault';

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

class DailyLogStore {
	constructor(
		public readonly vault: DailyLogVault,
		private readonly folder: () => string,
		private readonly now: () => Date = () => new Date(),
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

	async create(day: string): Promise<void> {
		const path = this.path(day);
		if (this.vault.getAbstractFileByPath(path)) {
			return;
		}
		await this.createAncestors(path);
		try {
			await this.vault.create(path, createDailyNote(day));
		} catch (error) {
			if (!this.vault.getAbstractFileByPath(path)) {
				throw error;
			}
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

export { DailyLogStore };
export type { DailyLogVault };
