/* eslint-disable eslint/func-style, eslint/max-statements, eslint/no-continue, eslint/no-magic-numbers, eslint/no-ternary */
import { Effect } from 'effect';
import type {
	DailyLogController,
	DailyLogDropTarget,
	DailyLogSnapshot,
} from './daily-log-controller';
import { addDailyTaskPlan, DailyLogStore } from './daily-log-store';
import { addProjectTaskPlan } from './project-actions';
import {
	LinkedTaskOperations,
	endpoints,
	sameEndpoint,
	type DailyTaskLink,
	type TaskEndpoint,
	type TaskReference,
} from './linked-task-operations';
import type { ProjectBoardTask } from './project-library';
import type { ProjectTaskDropPlacement, ProjectTaskReorderDirection } from './project-note';
import { hasTaskEditContent, type TaskDeleteMode, type TaskEditPlan } from './task-edit';

type DailyLogServiceOptions = {
	links: () => DailyTaskLink[];
	saveLinks: (links: DailyTaskLink[]) => Promise<void>;
	remapTaskKeys: (mapping: Map<string, string>) => Promise<() => Promise<void>>;
};

const projectReference = (task: ProjectBoardTask): TaskReference => ({
	path: task.projectPath,
	id: task.id,
	project: true,
});

class DailyLogService implements DailyLogController {
	private pending: Promise<unknown> = Promise.resolve();
	private disposed = false;
	private readonly referenceListeners = new Set<
		(path: string, mapping: Map<string, string>, kind: 'project' | 'daily') => void
	>();

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
	async addTask(day: string, text: string): Promise<void> {
		if (!text.trim()) {
			throw new Error('Task text was empty.');
		}
		await this.addTaskPlan(day, { text, children: [], siblings: [] });
	}
	addTaskPlan(day: string, plan: TaskEditPlan): Promise<Map<string, string>> {
		return this.enqueue(async () => {
			if (!hasTaskEditContent(plan) && !(await this.store.read(day)).note) {
				return new Map();
			}
			const reference = { path: this.store.path(day), id: '' };
			return this.operation(reference, async (engine) => {
				const document = await engine.document(reference.path);
				document.apply(addDailyTaskPlan(document.markdown(), plan));
			});
		});
	}

	editTask(day: string, taskId: string, text: string): Promise<Map<string, string>> {
		return this.editTaskPlan(day, taskId, { text, children: [], siblings: [] });
	}

	editTaskPlan(day: string, taskId: string, plan: TaskEditPlan): Promise<Map<string, string>> {
		const reference = { path: this.store.path(day), id: taskId };
		return this.enqueue(() => this.operation(reference, (engine) => engine.edit(reference, plan)));
	}

	editProjectTaskPlan(task: ProjectBoardTask, plan: TaskEditPlan): Promise<Map<string, string>> {
		const reference = projectReference(task);
		return this.enqueue(() => this.operation(reference, (engine) => engine.edit(reference, plan)));
	}

	addProjectTaskPlan(
		projectPath: string,
		sectionName: string,
		plan: TaskEditPlan,
	): Promise<Map<string, string>> {
		const reference = { path: projectPath, id: '', project: true };
		return this.enqueue(() =>
			this.operation(reference, async (engine) => {
				const document = await engine.document(projectPath);
				document.apply(
					await Effect.runPromise(addProjectTaskPlan(document.markdown(), sectionName, plan)),
				);
			}),
		);
	}

	deleteProjectTask(task: ProjectBoardTask, mode: TaskDeleteMode): Promise<Map<string, string>> {
		const reference = projectReference(task);
		return this.enqueue(() =>
			this.operation(reference, (engine) => engine.delete(reference, mode)),
		);
	}

	deleteTask(day: string, taskId: string, mode: TaskDeleteMode): Promise<Map<string, string>> {
		const reference = { path: this.store.path(day), id: taskId };
		return this.enqueue(() =>
			this.operation(reference, (engine) => engine.delete(reference, mode)),
		);
	}

	moveTask(
		day: string,
		sourceId: string,
		target: DailyLogDropTarget,
	): Promise<Map<string, string>> {
		const reference = { path: this.store.path(day), id: sourceId };
		return this.enqueue(() =>
			this.operation(reference, (engine) =>
				engine.move(reference, { path: reference.path, id: target.taskId }, target.placement),
			),
		);
	}

	moveProjectTask(task: ProjectBoardTask, sectionName: string): Promise<Map<string, string>> {
		const reference = projectReference(task);
		return this.enqueue(() =>
			this.operation(reference, (engine) => engine.section(reference, sectionName)),
		);
	}

	moveProjectTaskToPosition(
		source: ProjectBoardTask,
		target: ProjectBoardTask,
		placement: ProjectTaskDropPlacement,
	): Promise<Map<string, string>> {
		const reference = projectReference(source);
		return this.enqueue(() =>
			this.operation(reference, (engine) =>
				engine.move(reference, projectReference(target), placement),
			),
		);
	}

	reorderProjectTask(
		task: ProjectBoardTask,
		direction: ProjectTaskReorderDirection,
	): Promise<Map<string, string>> {
		const reference = projectReference(task);
		return this.enqueue(() =>
			this.operation(reference, (engine) => engine.reorder(reference, direction)),
		);
	}

	setTaskChecked(day: string, taskId: string, checked: boolean): Promise<Map<string, string>> {
		const reference = { path: this.store.path(day), id: taskId };
		return this.enqueue(() =>
			this.operation(reference, (engine) => engine.checked(reference, checked)),
		);
	}

	setProjectTaskChecked(task: ProjectBoardTask, checked: boolean): Promise<Map<string, string>> {
		const reference = projectReference(task);
		return this.enqueue(() =>
			this.operation(reference, (engine) => engine.checked(reference, checked)),
		);
	}

	isLinked(task: ProjectBoardTask): boolean {
		return this.options
			.links()
			.some((link) =>
				endpoints(link).some(
					(endpoint) =>
						endpoint.path === task.projectPath && `block:${endpoint.blockId}` === task.id,
				),
			);
	}

	copyProjectTask(day: string, task: ProjectBoardTask, target?: DailyLogDropTarget): Promise<void> {
		const reference = projectReference(task);
		return this.enqueue(async () => {
			await this.operation(reference, (engine) =>
				engine.copy(
					reference,
					this.store.path(day),
					target ? { id: target.taskId, placement: target.placement } : undefined,
				),
			);
		});
	}

	private async operation(
		reference: TaskReference,
		prepare: (engine: LinkedTaskOperations) => Promise<void>,
	): Promise<Map<string, string>> {
		const originalLinks = structuredClone(this.options.links());
		const engine = new LinkedTaskOperations(this.store.vault, originalLinks);
		await prepare(engine);
		const origin = await engine.document(reference.path);
		const mapping = origin.mapping(reference.project);
		const changed = [...engine.documents.values()].filter(
			(document) => document.original !== document.markdown(),
		);
		const queueMapping = new Map<string, string>();
		for (const document of [...engine.documents.values()].filter(
			(candidate) => candidate.isProject,
		)) {
			for (const [before, after] of document.mapping(true)) {
				queueMapping.set(`${document.path}::${before}`, after ? `${document.path}::${after}` : '');
			}
		}
		for (const document of changed) {
			if ((await this.store.vault.read(this.requireFile(document.path))) !== document.original) {
				throw new Error(`Note changed while preparing the task operation: ${document.path}`);
			}
		}
		const written: typeof changed = [];
		let undoKeys: (() => Promise<void>) | undefined = undefined;
		let savedLinks = false;
		try {
			this.assertActive();
			if (JSON.stringify(engine.links) !== JSON.stringify(originalLinks)) {
				await this.options.saveLinks(engine.links);
				savedLinks = true;
			}
			if (queueMapping.size) {
				undoKeys = await this.options.remapTaskKeys(queueMapping);
			}
			for (const document of changed) {
				this.assertActive();
				await this.store.vault.modify(this.requireFile(document.path), document.markdown());
				written.push(document);
			}
		} catch (error) {
			const failures: unknown[] = [];
			for (const document of written.reverse()) {
				try {
					await this.store.vault.modify(this.requireFile(document.path), document.original);
				} catch (failure) {
					failures.push(failure);
				}
			}
			try {
				await undoKeys?.();
			} catch (failure) {
				failures.push(failure);
			}
			if (savedLinks) {
				try {
					await this.options.saveLinks(originalLinks);
				} catch (failure) {
					failures.push(failure);
				}
			}
			if (failures.length) {
				throw Object.assign(
					new Error(
						[error, ...failures]
							.map((failure) => (failure instanceof Error ? failure.message : String(failure)))
							.join('; '),
					),
					{ cause: error },
				);
			}
			throw error;
		}
		for (const document of engine.documents.values()) {
			this.publishReferences(document.path, document.mapping(), 'daily');
			if (document.isProject) {
				this.publishReferences(document.path, document.mapping(true), 'project');
			}
		}
		return mapping;
	}

	private async readChecked(endpoint: TaskEndpoint): Promise<boolean> {
		const engine = new LinkedTaskOperations(this.store.vault, this.options.links());
		return (await engine.document(endpoint.path)).block(endpoint.blockId).checked;
	}

	private async synchronize(link: DailyTaskLink, checked: boolean): Promise<void> {
		const reference = { path: link.source.path, id: `block:${link.source.blockId}` };
		await this.operation(reference, (engine) => engine.checked(reference, checked, false));
	}

	syncFile(path: string): Promise<void> {
		return this.enqueue(async () => {
			for (const link of this.options.links()) {
				const changed = endpoints(link).filter((endpoint) => endpoint.path === path);
				const states = await Promise.all(changed.map((endpoint) => this.readChecked(endpoint)));
				const delta = states.find((checked) => checked !== link.checked);
				if (delta !== undefined) {
					await this.synchronize(link, delta);
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
					await this.synchronize(link, delta);
				}
			}
		});
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
					if (!sameEndpoint(next, link.source)) {
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

	onTaskReferencesChanged(
		listener: (path: string, mapping: Map<string, string>, kind: 'project' | 'daily') => void,
	): () => void {
		this.referenceListeners.add(listener);
		return () => {
			this.referenceListeners.delete(listener);
		};
	}

	private publishReferences(
		path: string,
		mapping: Map<string, string>,
		kind: 'project' | 'daily',
	): void {
		for (const listener of this.referenceListeners) {
			try {
				listener(path, new Map(mapping), kind);
			} catch (error) {
				// eslint-disable-next-line eslint/no-console
				console.error('Tavern: task reference listener failed.', error);
			}
		}
	}

	async whenIdle(): Promise<void> {
		await this.pending;
	}
	dispose(): void {
		this.disposed = true;
		this.referenceListeners.clear();
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
