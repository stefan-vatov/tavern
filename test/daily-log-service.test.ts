/* eslint-disable eslint/no-magic-numbers, eslint/max-statements, eslint/no-ternary */
import { Effect } from 'effect';
import { DailyLogService, type DailyTaskLink } from '../src/daily-log-service';
import { DailyLogStore, type DailyLogVault } from '../src/daily-log-store';
import { parseDailyNote } from '../src/daily-note';
import { parseProjectNote } from '../src/project-note';
import type { ProjectBoardTask } from '../src/project-library';
import type { ProjectVaultFile } from '../src/project-vault';

class MemoryVault implements DailyLogVault {
	readonly files = new Map<string, string>();
	readonly folders = new Set<string>();
	failWritePath: string | undefined = undefined;

	getMarkdownFiles(): ProjectVaultFile[] {
		return [...this.files.keys()].map((path) => ({ path }));
	}
	getAbstractFileByPath(path: string): ProjectVaultFile | null {
		return this.files.has(path) || this.folders.has(path) ? { path } : null;
	}
	async read(file: ProjectVaultFile): Promise<string> {
		return this.contents(file.path);
	}
	async modify(file: ProjectVaultFile, markdown: string): Promise<void> {
		this.contents(file.path);
		if (this.failWritePath === file.path) {
			throw new Error('Disk write failed.');
		}
		this.files.set(file.path, markdown);
	}
	async create(path: string, markdown: string): Promise<ProjectVaultFile> {
		if (this.getAbstractFileByPath(path)) {
			throw new Error('Path exists.');
		}
		this.files.set(path, markdown);
		return { path };
	}
	async createFolder(path: string): Promise<void> {
		if (this.getAbstractFileByPath(path)) {
			throw new Error('Path exists.');
		}
		this.folders.add(path);
	}
	async process(file: ProjectVaultFile, transform: (markdown: string) => string): Promise<string> {
		const result = transform(this.contents(file.path));
		if (this.failWritePath === file.path) {
			throw new Error('Disk write failed.');
		}
		this.files.set(file.path, result);
		return result;
	}
	private contents(path: string): string {
		const markdown = this.files.get(path);
		if (markdown === undefined) {
			throw new Error('File missing.');
		}
		return markdown;
	}
}

const sourcePath = '04_Projects/Project.md';
const day = '2026-10-24';
const dailyPath = 'Daily/2026/10/2026-10-24.md';

const fixture = async () => {
	const vault = new MemoryVault();
	vault.files.set(
		sourcePath,
		'---\ntavern: project\n---\n# Project\n## Work\n- [ ] Same title\n  - [ ] Child\n- [ ] Same title\n',
	);
	const store = new DailyLogStore(vault, () => 'Daily');
	let links: DailyTaskLink[] = [];
	let focused: string[] = [];
	const options = {
		links: () => links,
		saveLinks: async (next: DailyTaskLink[]) => {
			links = structuredClone(next);
		},
		remapTaskKeys: async (mapping: Map<string, string>) => {
			const previous = focused;
			focused = focused.map((key) => mapping.get(key) ?? key).filter(Boolean);
			return async () => {
				focused = previous;
			};
		},
	};
	const service = new DailyLogService(store, options);
	await service.create(day);
	const tasks = (): ProjectBoardTask[] =>
		Effect.runSync(parseProjectNote(vault.files.get(sourcePath)!))
			.sections.flatMap((section) => section.tasks)
			.map((task) => ({ ...task, projectPath: sourcePath, projectTitle: 'Project' }));
	return {
		vault,
		store,
		service,
		options,
		tasks,
		links: () => links,
		focused: () => focused,
		focus: (keys: string[]) => {
			focused = keys;
		},
	};
};

describe('linked daily log tasks', () => {
	it('delivers cross-note reference changes before a mirrored save resolves so a pending daily drag stays valid', async () => {
		const state = await fixture();
		await state.service.copyProjectTask(day, state.tasks()[0]!);
		state.vault.files.set(
			dailyPath,
			state.vault.files
				.get(dailyPath)!
				.replace('### Notes', '- [ ] Drag source\n- [ ] Drop target\n### Notes'),
		);
		const before = parseDailyNote(state.vault.files.get(dailyPath)!);
		let sourceId = before.tasks.find((task) => task.text === 'Drag source')!.id;
		let targetId = before.tasks.find((task) => task.text === 'Drop target')!.id;
		let resolved = false;
		const received: {
			path: string;
			kind: string;
			mapping: Map<string, string>;
			resolved: boolean;
		}[] = [];
		const unsubscribe = state.service.onTaskReferencesChanged((path, mapping, kind) => {
			received.push({ path, kind, mapping, resolved });
			if (path === dailyPath && kind === 'daily') {
				sourceId = mapping.get(sourceId) ?? sourceId;
				targetId = mapping.get(targetId) ?? targetId;
			}
		});
		const origin = await state.service.editProjectTaskPlan(state.tasks()[0]!, {
			text: 'Renamed',
			children: [{ text: 'Inserted', children: [{ text: 'Nested', children: [] }] }],
			siblings: [],
		});
		resolved = true;
		expect(received.every((receipt) => !receipt.resolved)).toBe(true);
		expect(
			received.find((receipt) => receipt.path === sourcePath && receipt.kind === 'project')!
				.mapping,
		).toEqual(origin);
		expect(
			received.some((receipt) => receipt.path === sourcePath && receipt.kind === 'daily'),
		).toBe(true);
		expect(sourceId).not.toBe(before.tasks.find((task) => task.text === 'Drag source')!.id);
		expect(targetId).not.toBe(before.tasks.find((task) => task.text === 'Drop target')!.id);
		await state.service.moveTask(day, sourceId, { taskId: targetId, placement: 'child' });
		expect(
			parseDailyNote(state.vault.files.get(dailyPath)!).tasks.find(
				(task) => task.text === 'Drag source',
			)!.indent,
		).toBe('  ');
		unsubscribe();
		const count = received.length;
		await state.service.addTaskPlan(day, { text: 'After unsubscribe', children: [], siblings: [] });
		expect(received).toHaveLength(count);
	});

	it('publishes both reference interpretations for standalone captures, including raw project rows outside the project task parser', async () => {
		const state = await fixture();
		state.vault.files.set(
			sourcePath,
			`${state.vault.files.get(sourcePath)!}## Notes & Decisions\n+ [ ] Untouched plus\n- [ ] Later\n`,
		);
		const sourceBefore = parseDailyNote(state.vault.files.get(sourcePath)!).tasks.find(
			(task) => task.text === 'Untouched plus',
		)!;
		state.vault.files.set(
			dailyPath,
			'---\ntavern: project\n---\n## Plan\n- [ ] Existing\n## Notes\n- [ ] Later\n',
		);
		const dailyBefore = parseDailyNote(state.vault.files.get(dailyPath)!).tasks.find(
			(task) => task.text === 'Later',
		)!;
		const received: { path: string; kind: string; mapping: Map<string, string> }[] = [];
		state.service.onTaskReferencesChanged((path, mapping, kind) => {
			received.push({ path, mapping, kind });
		});
		await state.service.addProjectTaskPlan(sourcePath, 'Work', {
			text: 'Captured project',
			children: [],
			siblings: [],
		});
		const sourceAfter = parseDailyNote(state.vault.files.get(sourcePath)!).tasks.find(
			(task) => task.text === 'Untouched plus',
		)!;
		expect(
			received
				.find((receipt) => receipt.path === sourcePath && receipt.kind === 'daily')!
				.mapping.get(sourceBefore.id),
		).toBe(sourceAfter.id);
		expect(sourceAfter.id).not.toBe(sourceBefore.id);
		await state.service.addTaskPlan(day, {
			text: 'Captured daily',
			children: [{ text: 'Child', children: [] }],
			siblings: [],
		});
		const dailyAfter = parseDailyNote(state.vault.files.get(dailyPath)!).tasks.find(
			(task) => task.text === 'Later',
		)!;
		expect(
			received
				.find((receipt) => receipt.path === dailyPath && receipt.kind === 'daily')!
				.mapping.get(dailyBefore.id),
		).toBe(dailyAfter.id);
		expect(dailyAfter.id).not.toBe(dailyBefore.id);
		expect(
			received.filter((receipt) => receipt.kind === 'project').map((receipt) => receipt.path),
		).toEqual([sourcePath, dailyPath]);
	});

	it('does not publish a reference receipt for failed or rolled-back operations', async () => {
		const state = await fixture();
		await state.service.copyProjectTask(day, state.tasks()[0]!);
		const listener = vi.fn();
		state.service.onTaskReferencesChanged(listener);
		const before = new Map(state.vault.files);
		state.vault.failWritePath = dailyPath;
		await expect(
			state.service.editProjectTaskPlan(state.tasks()[0]!, {
				text: 'Rejected',
				children: [],
				siblings: [],
			}),
		).rejects.toThrow('Disk write failed');
		expect(state.vault.files).toEqual(before);
		expect(listener).not.toHaveBeenCalled();
		state.vault.failWritePath = undefined;
		state.options.remapTaskKeys = async () => {
			throw new Error('Reference save failed.');
		};
		await expect(
			state.service.addProjectTaskPlan(sourcePath, 'Work', {
				text: 'Rejected capture',
				children: [],
				siblings: [],
			}),
		).rejects.toThrow('Reference save failed');
		expect(state.vault.files).toEqual(before);
		expect(listener).not.toHaveBeenCalled();
	});

	it('isolates a failed subscriber from successful writes and other reference subscribers', async () => {
		const state = await fixture();
		vi.spyOn(console, 'error').mockImplementation(() => {});
		state.service.onTaskReferencesChanged(() => {
			throw new Error('Subscriber failed.');
		});
		const received = vi.fn();
		state.service.onTaskReferencesChanged(received);
		await expect(
			state.service.editProjectTaskPlan(state.tasks()[0]!, {
				text: 'Saved',
				children: [],
				siblings: [],
			}),
		).resolves.toBeInstanceOf(Map);
		expect(state.tasks()[0]!.text).toBe('Saved');
		expect(received).toHaveBeenCalled();
		state.service.dispose();
		const calls = received.mock.calls.length;
		await expect(
			state.service.addTaskPlan(day, { text: 'After disposal', children: [], siblings: [] }),
		).rejects.toThrow('disposed');
		expect(received).toHaveBeenCalledTimes(calls);
	});

	it('removes the old queue selection when a cleared row is replaced by an identical draft', async () => {
		const state = await fixture();
		const task = state.tasks().at(-1)!;
		const before = state.vault.files.get(sourcePath);
		const receipts: Map<string, string>[] = [];
		state.service.onTaskReferencesChanged((path, mapping, kind) => {
			if (path === sourcePath && kind === 'project') {
				receipts.push(mapping);
			}
		});
		state.focus([`${sourcePath}::${task.id}`]);
		const mapping = await state.service.editProjectTaskPlan(task, {
			text: '',
			children: [],
			siblings: [{ text: task.text, children: [] }],
		});
		expect(state.vault.files.get(sourcePath)).toBe(before);
		expect(mapping.get(task.id)).toBe('');
		expect(receipts[0]!.get(task.id)).toBe('');
		expect(state.focused()).toEqual([]);
	});

	it.each(['task', 'tree'] as const)(
		'deletes a linked project %s from every endpoint and preserves surviving references',
		async (mode) => {
			const state = await fixture();
			await state.service.copyProjectTask(day, state.tasks()[0]!);
			const [parent, child] = structuredClone(state.links());
			state.focus(state.tasks().map((task) => `${sourcePath}::${task.id}`));
			await state.service.deleteProjectTask(state.tasks()[0]!, mode);
			expect(state.tasks().map(({ text, indent }) => ({ text, indent }))).toEqual(
				mode === 'task'
					? [
							{ text: 'Child', indent: '' },
							{ text: 'Same title', indent: '' },
						]
					: [{ text: 'Same title', indent: '' }],
			);
			expect(
				parseDailyNote(state.vault.files.get(dailyPath)!).tasks.map((task) => ({
					text: task.text,
					indent: task.indent,
				})),
			).toEqual(mode === 'task' ? [{ text: 'Child', indent: '' }] : []);
			expect(state.links()).toEqual(mode === 'task' ? [child] : []);
			expect(state.links().some((link) => link.source.blockId === parent!.source.blockId)).toBe(
				false,
			);
			expect(state.focused()).toEqual(state.tasks().map((task) => `${sourcePath}::${task.id}`));
			if (mode === 'task') {
				await state.service.setTaskChecked(day, `block:${child!.copies[0]!.blockId}`, true);
				expect(state.tasks().find((task) => task.blockId === child!.source.blockId)!.checked).toBe(
					true,
				);
			}
			await expect(state.service.syncAll()).resolves.toBeUndefined();
		},
	);

	it.each(['task', 'tree'] as const)(
		'deletes a daily %s from its source and both copies of the group in the same note',
		async (mode) => {
			const state = await fixture();
			await state.service.copyProjectTask(day, state.tasks()[0]!);
			await state.service.copyProjectTask(day, state.tasks()[0]!);
			const [parent, child] = structuredClone(state.links());
			await state.service.deleteTask(day, `block:${parent!.copies[0]!.blockId}`, mode);
			expect(
				parseDailyNote(state.vault.files.get(dailyPath)!).tasks.map((task) => ({
					text: task.text,
					indent: task.indent,
				})),
			).toEqual(
				mode === 'task'
					? [
							{ text: 'Child', indent: '' },
							{ text: 'Child', indent: '' },
						]
					: [],
			);
			expect(state.tasks().map((task) => task.text)).toEqual(
				mode === 'task' ? ['Child', 'Same title'] : ['Same title'],
			);
			expect(state.links()).toEqual(mode === 'task' ? [child] : []);
			if (mode === 'task') {
				await state.service.setTaskChecked(day, `block:${child!.copies[1]!.blockId}`, true);
				expect(state.tasks().find((task) => task.blockId === child!.source.blockId)!.checked).toBe(
					true,
				);
			}
			await expect(state.service.syncAll()).resolves.toBeUndefined();
		},
	);

	it.each(['project', 'daily'] as const)(
		'restores references after a failed %s tree deletion and permits retry',
		async (origin) => {
			const state = await fixture();
			await state.service.copyProjectTask(day, state.tasks()[0]!);
			state.focus(state.tasks().map((task) => `${sourcePath}::${task.id}`));
			const links = structuredClone(state.links());
			const focused = [...state.focused()];
			const path = origin === 'project' ? sourcePath : dailyPath;
			const before = state.vault.files.get(path);
			state.vault.failWritePath = path;
			const remove = () =>
				origin === 'project'
					? state.service.deleteProjectTask(state.tasks()[0]!, 'tree')
					: state.service.deleteTask(day, `block:${links[0]!.copies[0]!.blockId}`, 'tree');
			await expect(remove()).rejects.toThrow('Disk write failed');
			expect(state.vault.files.get(path)).toBe(before);
			expect(state.links()).toEqual(links);
			expect(state.focused()).toEqual(focused);
			state.vault.failWritePath = undefined;
			await remove();
			await expect(state.service.syncAll()).resolves.toBeUndefined();
		},
	);

	it('keeps a linked source retryable when reference settings fail, and rolls references back on note-write failure', async () => {
		const state = await fixture();
		await state.service.copyProjectTask(day, state.tasks()[0]!);
		state.focus(state.tasks().map((task) => `${sourcePath}::${task.id}`));
		const source = state.vault.files.get(sourcePath);
		const links = structuredClone(state.links());
		const keys = [...state.focused()];
		const remap = state.options.remapTaskKeys;
		state.options.remapTaskKeys = async () => {
			throw new Error('Settings failed');
		};
		const plan = { text: '', children: [], siblings: [] };
		await expect(state.service.editProjectTaskPlan(state.tasks()[0]!, plan)).rejects.toThrow(
			'Settings failed',
		);
		expect(state.vault.files.get(sourcePath)).toBe(source);
		expect(state.links()).toEqual(links);
		expect(state.focused()).toEqual(keys);
		state.options.remapTaskKeys = remap;
		state.vault.failWritePath = sourcePath;
		await expect(state.service.editProjectTaskPlan(state.tasks()[0]!, plan)).rejects.toThrow(
			'Disk write failed',
		);
		expect(state.vault.files.get(sourcePath)).toBe(source);
		expect(state.links()).toEqual(links);
		expect(state.focused()).toEqual(keys);
		state.options.remapTaskKeys = async (mapping) => {
			const undo = await remap(mapping);
			return async () => {
				await undo();
				throw new Error('Queue rollback failed');
			};
		};
		await expect(state.service.editProjectTaskPlan(state.tasks()[0]!, plan)).rejects.toThrow(
			'Queue rollback failed',
		);
		expect(state.links()).toEqual(links);
		expect(state.vault.files.get(sourcePath)).toBe(source);
		state.options.remapTaskKeys = remap;
		state.vault.failWritePath = undefined;
		await state.service.editProjectTaskPlan(state.tasks()[0]!, plan);
		expect(state.tasks()[0]!.text).toBe('Child');
		await expect(state.service.syncAll()).resolves.toBeUndefined();
	});

	it('clears a parent at every endpoint and retains its promoted child link', async () => {
		const state = await fixture();
		await state.service.copyProjectTask(day, state.tasks()[0]!);
		const [parent, child] = structuredClone(state.links());
		await state.service.editTaskPlan(day, `block:${parent!.copies[0]!.blockId}`, {
			text: '',
			children: [],
			siblings: [],
		});
		const daily = parseDailyNote(state.vault.files.get(dailyPath)!);
		expect(daily.tasks.map(({ text, indent }) => ({ text, indent }))).toEqual([
			{ text: 'Child', indent: '' },
		]);
		expect(state.tasks()[0]!.text).toBe('Child');
		expect(state.links()).toEqual([child]);
		await state.service.setTaskChecked(day, daily.tasks[0]!.id, true);
		expect(state.tasks().find((task) => task.blockId === child!.source.blockId)!.checked).toBe(
			true,
		);
		await expect(state.service.syncAll()).resolves.toBeUndefined();
	});

	it('clears a project parent, mirrors its sibling draft, and remaps surviving duplicate queue selections', async () => {
		const state = await fixture();
		await state.service.copyProjectTask(day, state.tasks()[0]!);
		const [parent, child] = structuredClone(state.links());
		state.focus(state.tasks().map((task) => `${sourcePath}::${task.id}`));
		await state.service.editProjectTaskPlan(state.tasks()[0]!, {
			text: '',
			children: [],
			siblings: [{ text: 'New sibling', children: [] }],
		});
		expect(state.tasks().map(({ text, indent }) => ({ text, indent }))).toEqual([
			{ text: 'Child', indent: '' },
			{ text: 'New sibling', indent: '' },
			{ text: 'Same title', indent: '' },
		]);
		expect(state.focused()).toEqual(
			[state.tasks()[0], state.tasks()[2]].map((task) => `${sourcePath}::${task!.id}`),
		);
		expect(state.links()[0]).toEqual(child);
		expect(state.links()).toHaveLength(2);
		expect(
			parseDailyNote(state.vault.files.get(dailyPath)!).tasks.map((task) => task.text),
		).toEqual(['Child', 'New sibling']);
		expect(state.links().some((link) => link.source.blockId === parent!.source.blockId)).toBe(
			false,
		);
		await state.service.setTaskChecked(day, `block:${child!.copies[0]!.blockId}`, true);
		expect(state.tasks().find((task) => task.blockId === child!.source.blockId)!.checked).toBe(
			true,
		);
		await expect(state.service.syncAll()).resolves.toBeUndefined();
	});

	it('retains links and source content when clearing a daily row fails to write', async () => {
		const state = await fixture();
		await state.service.copyProjectTask(day, state.tasks()[0]!);
		const links = structuredClone(state.links());
		const before = state.vault.files.get(dailyPath);
		state.vault.failWritePath = dailyPath;
		await expect(
			state.service.editTaskPlan(day, `block:${links[0]!.copies[0]!.blockId}`, {
				text: '',
				children: [],
				siblings: [],
			}),
		).rejects.toThrow('Disk write failed');
		expect(state.vault.files.get(dailyPath)).toBe(before);
		expect(state.links()).toEqual(links);
	});

	it('keeps a parent’s indented prose and children together when completing its daily copy', async () => {
		const state = await fixture();
		state.vault.files.set(
			sourcePath,
			'---\ntavern: project\n---\n# Project\n## Work\n- [ ] Parent\n  Supporting prose\n\n  - [ ] Child\n- [ ] Sibling\n',
		);
		await state.service.copyProjectTask(day, state.tasks()[0]!);
		const [parent] = state.links();
		await state.service.setTaskChecked(day, `block:${parent!.copies[0]!.blockId}`, true);
		const source = state.vault.files.get(sourcePath)!;
		expect(source).toContain('## Work\n- [ ] Sibling');
		expect(source).toContain(
			`- [x] Parent ^${parent!.source.blockId}\n  Supporting prose\n\n  - [ ] Child ^${state.links()[1]!.source.blockId}`,
		);
		expect(state.tasks().find((task) => task.text === 'Child')).toMatchObject({
			sectionName: 'Done',
			checked: false,
		});
	});
	it.each([
		{ target: 'own copy', placement: 'child' },
		{ target: 'own descendant', placement: 'child' },
		{ target: 'own descendant', placement: 'before' },
		{ target: 'own descendant', placement: 'after' },
		{ target: 'transitive descendant', placement: 'child' },
	] as const)(
		'rejects a copy that nests its logical tree at $placement of $target before any persistence',
		async ({ target, placement }) => {
			const state = await fixture();
			await state.service.copyProjectTask(day, state.tasks()[0]!);
			const links = structuredClone(state.links());
			let targetId = `block:${links[0]!.copies[0]!.blockId}`;
			if (target === 'own descendant') {
				targetId = `block:${links[1]!.copies[0]!.blockId}`;
			}
			if (target === 'transitive descendant') {
				state.vault.files.set(
					'Other.md',
					'- [ ] External child ^external-b\n  - [ ] Deep child ^deep-c1\n',
				);
				state.vault.files.set(
					dailyPath,
					`${state.vault.files.get(dailyPath)!}- [ ] Deep copy ^deep-c2\n`,
				);
				links[1]!.copies.push({ path: 'Other.md', blockId: 'external-b' });
				links.push({
					source: { path: 'Other.md', blockId: 'deep-c1' },
					copies: [{ path: dailyPath, blockId: 'deep-c2' }],
					checked: false,
				});
				await state.options.saveLinks(links);
				targetId = 'block:deep-c2';
			}
			state.focus(state.tasks().map((task) => `${sourcePath}::${task.id}`));
			const before = new Map(state.vault.files);
			const focused = [...state.focused()];
			const save = vi.spyOn(state.options, 'saveLinks');
			const remap = vi.spyOn(state.options, 'remapTaskKeys');
			const listener = vi.fn();
			state.service.onTaskReferencesChanged(listener);
			await expect(
				state.service.copyProjectTask(day, state.tasks()[0]!, { taskId: targetId, placement }),
			).rejects.toThrow('Cannot move a task inside its own children.');
			expect(state.vault.files).toEqual(before);
			expect(state.links()).toEqual(links);
			expect(state.focused()).toEqual(focused);
			expect(save).not.toHaveBeenCalled();
			expect(remap).not.toHaveBeenCalled();
			expect(listener).not.toHaveBeenCalled();
		},
	);

	it.each(['before', 'after'] as const)(
		'allows a parallel copy %s its own root counterpart',
		async (placement) => {
			const state = await fixture();
			await state.service.copyProjectTask(day, state.tasks()[0]!);
			const root = state.links()[0]!;
			const source = state.vault.files.get(sourcePath);
			await state.service.copyProjectTask(day, state.tasks()[0]!, {
				taskId: `block:${root.copies[0]!.blockId}`,
				placement,
			});
			expect(state.vault.files.get(sourcePath)).toBe(source);
			expect(state.links().every((link) => link.copies.length === 2)).toBe(true);
			expect(
				parseDailyNote(state.vault.files.get(dailyPath)!).tasks.map((task) => ({
					text: task.text,
					indent: task.indent,
				})),
			).toEqual([
				{ text: 'Same title', indent: '' },
				{ text: 'Child', indent: '  ' },
				{ text: 'Same title', indent: '' },
				{ text: 'Child', indent: '  ' },
			]);
		},
	);

	it('copies a whole subtree with distinct standard IDs, keeps duplicate-title siblings independent and migrates focus', async () => {
		const state = await fixture();
		const [parent, child] = state.tasks();
		state.focus([`${sourcePath}::${parent!.id}`, `${sourcePath}::${child!.id}`]);
		await state.service.copyProjectTask(day, parent!);
		const copied = parseDailyNote(state.vault.files.get(dailyPath)!).tasks;
		const source = state.tasks();
		expect(copied.map((task) => task.text)).toEqual(['Same title', 'Child']);
		expect(source.map((task) => task.text)).toEqual(['Same title', 'Child', 'Same title']);
		expect(source[2]!.blockId).toBeUndefined();
		expect(state.focused()).toEqual(source.slice(0, 2).map((task) => `${sourcePath}::${task.id}`));
		expect(new Set([...source.slice(0, 2), ...copied].map((task) => task.blockId)).size).toBe(4);
		expect(state.links()).toHaveLength(2);
		await state.service.copyProjectTask(day, state.tasks()[0]!);
		expect(state.links().map((link) => link.copies.length)).toEqual([2, 2]);
		expect(state.tasks()[0]!.id).toBe(source[0]!.id);
	});

	it('synchronizes regular editor changes both directions after reload and source rename, including unchecking in place', async () => {
		const state = await fixture();
		await state.service.copyProjectTask(day, state.tasks()[0]!);
		const link = state.links()[0]!;
		const copyId = link.copies[0]!.blockId;
		const reloaded = new DailyLogService(state.store, state.options);
		state.vault.files.set(
			dailyPath,
			state.vault.files
				.get(dailyPath)!
				.replace(`- [ ] Same title ^${copyId}`, `- [x] Same title ^${copyId}`),
		);
		await reloaded.syncAll();
		expect(state.tasks().find((task) => task.blockId === link.source.blockId)).toMatchObject({
			checked: true,
			sectionName: 'Done',
		});
		const renamed = '04_Projects/Renamed.md';
		state.vault.files.set(
			renamed,
			state.vault.files
				.get(sourcePath)!
				.replace(
					`- [x] Same title ^${link.source.blockId}`,
					`- [ ] Revised in editor ^${link.source.blockId}`,
				),
		);
		state.vault.files.delete(sourcePath);
		await reloaded.renameFile(sourcePath, renamed);
		await reloaded.syncFile(renamed);
		expect(
			parseDailyNote(state.vault.files.get(dailyPath)!).tasks.find(
				(task) => task.blockId === copyId,
			),
		).toMatchObject({ checked: false, text: 'Same title' });
		expect(
			Effect.runSync(parseProjectNote(state.vault.files.get(renamed)!)).sections.find(
				(section) => section.name === 'Done',
			)!.tasks[0],
		).toMatchObject({ checked: false, text: 'Revised in editor' });
		expect(state.links()[0]!.source.path).toBe(renamed);
	});

	it('updates all copies from either UI endpoint and leaves unlinked daily tasks local', async () => {
		const state = await fixture();
		await state.service.copyProjectTask(day, state.tasks()[0]!);
		await state.service.copyProjectTask(day, state.tasks()[0]!);
		await state.service.setTaskChecked(day, `block:${state.links()[0]!.copies[1]!.blockId}`, true);
		expect(
			parseDailyNote(state.vault.files.get(dailyPath)!)
				.tasks.filter((task) => task.text === 'Same title')
				.map((task) => task.checked),
		).toEqual([true, true]);
		const linkedSource = state
			.tasks()
			.find((task) => task.blockId === state.links()[0]!.source.blockId)!;
		expect(state.service.isLinked(linkedSource)).toBe(true);
		await state.service.setProjectTaskChecked(linkedSource, false);
		expect(
			parseDailyNote(state.vault.files.get(dailyPath)!).tasks.every((task) => !task.checked),
		).toBe(true);
		await state.service.addTask(day, 'Local');
		const local = parseDailyNote(state.vault.files.get(dailyPath)!).tasks.find(
			(task) => task.text === 'Local',
		)!;
		await state.service.setTaskChecked(day, local.id, true);
		expect(
			(await state.service.read(day)).note!.tasks.find((task) => task.id === local.id),
		).toMatchObject({ text: 'Local', checked: true });
		expect(state.tasks().find((task) => task.blockId === linkedSource.blockId)!.checked).toBe(
			false,
		);
		state.vault.files.delete(sourcePath);
		await state.service.setTaskChecked(day, local.id, false);
		expect(
			(await state.service.read(day)).note!.tasks.find((task) => task.id === local.id),
		).toMatchObject({ text: 'Local', checked: false });
	});

	it('mirrors text and nested draft trees across a source and two copies in one note', async () => {
		const state = await fixture();
		await state.service.copyProjectTask(day, state.tasks()[0]!);
		await state.service.copyProjectTask(day, state.tasks()[0]!);
		const parent = state.links()[0]!;
		await state.service.editTaskPlan(day, `block:${parent.copies[1]!.blockId}`, {
			text: 'Renamed everywhere',
			children: [{ text: 'New child', children: [{ text: 'New grandchild', children: [] }] }],
			siblings: [],
		});
		const source = state.tasks();
		expect(source.map((task) => task.text)).toEqual([
			'Renamed everywhere',
			'New child',
			'New grandchild',
			'Child',
			'Same title',
		]);
		const daily = parseDailyNote(state.vault.files.get(dailyPath)!);
		expect(daily.tasks.map((task) => task.text)).toEqual([
			'Renamed everywhere',
			'New child',
			'New grandchild',
			'Child',
			'Renamed everywhere',
			'New child',
			'New grandchild',
			'Child',
		]);
		expect(state.links()).toHaveLength(4);
		expect(state.links().every((link) => link.copies.length === 2)).toBe(true);
		const ids = [...source, ...daily.tasks].flatMap((task) => (task.blockId ? [task.blockId] : []));
		expect(new Set(ids).size).toBe(ids.length);
		const newChild = state.links().find((link) => link.source.blockId === source[1]!.blockId)!;
		await state.service.editTask(day, `block:${newChild.copies[0]!.blockId}`, 'Edited child');
		expect(state.tasks()[1]!.text).toBe('Edited child');
		expect(
			parseDailyNote(state.vault.files.get(dailyPath)!).tasks.filter(
				(task) => task.text === 'Edited child',
			),
		).toHaveLength(2);
	});

	it('adopts an older unlinked child inside a linked copy before editing it', async () => {
		const state = await fixture();
		await state.service.copyProjectTask(day, state.tasks()[0]!);
		await state.service.copyProjectTask(day, state.tasks()[0]!);
		const parent = state.links()[0]!;
		state.vault.files.set(
			dailyPath,
			state.vault.files
				.get(dailyPath)!
				.replace(
					`- [ ] Same title ^${parent.copies[0]!.blockId}`,
					`- [ ] Same title ^${parent.copies[0]!.blockId}\n  - [ ] Older child ^older`,
				),
		);
		await state.service.editTask(day, 'block:older', 'Now shared');
		expect(state.tasks().filter((task) => task.text === 'Now shared')).toHaveLength(1);
		expect(
			parseDailyNote(state.vault.files.get(dailyPath)!).tasks.filter(
				(task) => task.text === 'Now shared',
			),
		).toHaveLength(2);
		const link = state
			.links()
			.find((entry) =>
				[entry.source, ...entry.copies].some((endpoint) => endpoint.blockId === 'older'),
			)!;
		expect(link.source.path).toBe(sourcePath);
		expect(link.copies).toHaveLength(2);
	});

	it('creates a missing destination and its ancestors before nesting every linked tree', async () => {
		const state = await fixture();
		await state.service.copyProjectTask(day, state.tasks()[0]!);
		await state.service.copyProjectTask(day, state.tasks()[0]!);
		state.vault.files.set(
			sourcePath,
			`${state.vault.files.get(sourcePath)!}## Destination\n- [ ] Destination parent\n  - [ ] Target\n`,
		);
		const root = state.tasks()[0]!;
		const target = state.tasks().find((task) => task.text === 'Target')!;
		await state.service.moveProjectTaskToPosition(root, target, 'child');
		const source = state.tasks();
		expect(source.find((task) => task.blockId === root.blockId)!.indent).toBe('    ');
		const daily = parseDailyNote(state.vault.files.get(dailyPath)!);
		expect(daily.tasks.filter((task) => task.text === 'Destination parent')).toHaveLength(2);
		expect(daily.tasks.filter((task) => task.text === 'Target')).toHaveLength(2);
		expect(
			daily.tasks.filter((task) => task.text === 'Same title').map((task) => task.indent),
		).toEqual(['    ', '    ']);
		expect(daily.tasks.filter((task) => task.text === 'Child').map((task) => task.indent)).toEqual([
			'      ',
			'      ',
		]);
		expect(state.vault.files.get(dailyPath)).toContain('### Notes');
	});

	it('mirrors section moves and sibling reordering while preserving unrelated narrative', async () => {
		const state = await fixture();
		await state.service.copyProjectTask(day, state.tasks()[0]!);
		const parent = state.tasks()[0]!;
		await state.service.moveProjectTask(parent, 'Waiting');
		expect(state.tasks().find((task) => task.blockId === parent.blockId)!.sectionName).toBe(
			'Waiting',
		);
		expect(parseDailyNote(state.vault.files.get(dailyPath)!).tasks[0]!.sectionName).toBe('Waiting');
		const other = state.tasks().find((task) => !task.blockId)!;
		await state.service.moveProjectTask(other, 'Waiting');
		await state.service.reorderProjectTask(
			state.tasks().find((task) => task.blockId === parent.blockId)!,
			'down',
		);
		expect(
			state
				.tasks()
				.filter((task) => task.sectionName === 'Waiting')
				.map((task) => task.text),
		).toEqual(['Same title', 'Same title', 'Child']);
		expect(
			parseDailyNote(state.vault.files.get(dailyPath)!).tasks.map((task) => task.text),
		).toEqual(['Same title', 'Same title', 'Child']);
	});

	it('places each same-note copy beneath its own corresponding destination group', async () => {
		const state = await fixture();
		state.vault.files.set(
			sourcePath,
			'---\ntavern: project\n---\n## Work\n- [ ] Move me\n  - [ ] Moving child\n- [ ] Destination\n  - [ ] Existing child\n',
		);
		await state.service.copyProjectTask(day, state.tasks()[0]!);
		await state.service.copyProjectTask(
			day,
			state.tasks().find((task) => task.text === 'Destination')!,
		);
		await state.service.copyProjectTask(day, state.tasks()[0]!);
		await state.service.copyProjectTask(
			day,
			state.tasks().find((task) => task.text === 'Destination')!,
		);
		const moving = state
			.links()
			.find(
				(link) =>
					state.tasks().find((task) => task.blockId === link.source.blockId)?.text === 'Move me',
			)!;
		const target = state
			.links()
			.find(
				(link) =>
					state.tasks().find((task) => task.blockId === link.source.blockId)?.text ===
					'Destination',
			)!;
		await state.service.moveTask(day, `block:${moving.copies[0]!.blockId}`, {
			taskId: `block:${target.copies[0]!.blockId}`,
			placement: 'child',
		});
		const rows = parseDailyNote(state.vault.files.get(dailyPath)!).tasks;
		for (let index = 0; index < 2; index += 1) {
			const root = rows.findIndex((task) => task.blockId === target.copies[index]!.blockId);
			expect(rows[root + 1]!.blockId).toBe(moving.copies[index]!.blockId);
			expect(rows[root + 1]!.indent).toBe('  ');
			expect(rows[root + 2]!.text).toBe('Moving child');
			expect(rows[root + 3]!.text).toBe('Existing child');
		}
	});

	it('mirrors queue copies added inside a linked parent while retaining the original source position', async () => {
		const state = await fixture();
		await state.service.copyProjectTask(day, state.tasks()[0]!);
		await state.service.copyProjectTask(day, state.tasks()[0]!);
		const parent = state.links()[0]!;
		const standalone = state.tasks().at(-1)!;
		await state.service.copyProjectTask(day, standalone, {
			taskId: `block:${parent.copies[1]!.blockId}`,
			placement: 'child',
		});
		const original = state.tasks().at(-1)!;
		expect(original.indent).toBe('');
		const added = state.links().find((link) => link.source.blockId === original.blockId)!;
		expect(added.copies).toHaveLength(3);
		expect(added.copies.filter((endpoint) => endpoint.path === sourcePath)).toHaveLength(1);
		expect(
			parseDailyNote(state.vault.files.get(dailyPath)!).tasks.filter(
				(task) => task.text === 'Same title' && task.indent === '  ',
			),
		).toHaveLength(2);
		await state.service.deleteTask(
			day,
			`block:${added.copies.find((endpoint) => endpoint.path === dailyPath)!.blockId}`,
			'tree',
		);
		expect(state.tasks().map((task) => task.text)).toEqual(['Same title', 'Child']);
	});

	it('adopts and mirrors a standalone tree moved into a linked parent', async () => {
		const state = await fixture();
		await state.service.copyProjectTask(day, state.tasks()[0]!);
		await state.service.copyProjectTask(day, state.tasks()[0]!);
		const parent = state.tasks()[0]!;
		await state.service.moveProjectTaskToPosition(state.tasks().at(-1)!, parent, 'child');
		expect(state.tasks().map((task) => ({ text: task.text, indent: task.indent }))).toEqual([
			{ text: 'Same title', indent: '' },
			{ text: 'Same title', indent: '  ' },
			{ text: 'Child', indent: '  ' },
		]);
		expect(
			parseDailyNote(state.vault.files.get(dailyPath)!).tasks.map((task) => task.text),
		).toEqual(['Same title', 'Same title', 'Child', 'Same title', 'Same title', 'Child']);
		expect(state.links()).toHaveLength(3);
		expect(state.links().every((link) => link.copies.length === 2)).toBe(true);
	});

	it('moves an unlinked parent together with linked descendants and their originally separate sources', async () => {
		const state = await fixture();
		state.vault.files.set(
			dailyPath,
			'### Plan\n- [ ] Local parent ^local-parent\n- [ ] Destination ^destination\n### Notes\nKeep this narrative.\n',
		);
		await state.service.copyProjectTask(day, state.tasks()[0]!, {
			taskId: 'block:local-parent',
			placement: 'child',
		});
		const source = state.tasks()[0]!;
		expect(source.indent).toBe('');
		await state.service.moveTask(day, 'block:local-parent', {
			taskId: 'block:destination',
			placement: 'child',
		});
		expect(state.tasks().find((task) => task.blockId === source.blockId)!.indent).toBe('    ');
		expect(state.tasks().filter((task) => task.text === 'Local parent')).toHaveLength(1);
		expect(state.vault.files.get(dailyPath)).toContain('### Notes\nKeep this narrative.');
		expect(
			parseDailyNote(state.vault.files.get(dailyPath)!).tasks.find(
				(task) => task.text === 'Same title',
			)!.indent,
		).toBe('    ');
	});

	it.each([
		{ operation: 'delete', missing: false },
		{ operation: 'move', missing: false },
		{ operation: 'delete', missing: true },
		{ operation: 'move', missing: true },
	])(
		'preflights and follows recursively linked subtrees for $operation with missing endpoint $missing',
		async ({ operation, missing }) => {
			const state = await fixture();
			const otherPath = 'Other.md';
			state.vault.files.set(
				sourcePath,
				'---\ntavern: project\n---\n## Work\n- [ ] A ^a\n  - [ ] B ^b1\n- [ ] Keep\n',
			);
			state.vault.files.set(
				dailyPath,
				'### Plan\n- [ ] B ^b2\n  - [ ] C ^c1\n### Notes\nDaily narrative.\n',
			);
			state.vault.files.set(
				otherPath,
				`- [ ] C ^${missing ? 'missing' : 'c2'}\n- [ ] Unrelated ^unrelated\n`,
			);
			const links = [
				{
					source: { path: sourcePath, blockId: 'b1' },
					copies: [{ path: dailyPath, blockId: 'b2' }],
					checked: false,
				},
				{
					source: { path: dailyPath, blockId: 'c1' },
					copies: [{ path: otherPath, blockId: 'c2' }],
					checked: false,
				},
			];
			await state.options.saveLinks(links);
			const before = new Map(state.vault.files);
			const mutate = () =>
				operation === 'delete'
					? state.service.deleteProjectTask(state.tasks()[0]!, 'tree')
					: state.service.moveProjectTask(state.tasks()[0]!, 'Waiting');
			if (missing) {
				const save = vi.spyOn(state.options, 'saveLinks');
				const remap = vi.spyOn(state.options, 'remapTaskKeys');
				await expect(mutate()).rejects.toThrow('missing or ambiguous');
				expect(state.vault.files).toEqual(before);
				expect(state.links()).toEqual(links);
				expect(save).not.toHaveBeenCalled();
				expect(remap).not.toHaveBeenCalled();
				return;
			}
			await mutate();
			if (operation === 'delete') {
				expect(state.tasks().map((task) => task.text)).toEqual(['Keep']);
				expect(state.vault.files.get(dailyPath)).toBe('### Plan\n### Notes\nDaily narrative.\n');
				expect(state.vault.files.get(otherPath)).toBe('- [ ] Unrelated ^unrelated\n');
				expect(state.links()).toEqual([]);
			} else {
				for (const path of [sourcePath, dailyPath, otherPath]) {
					const tree = parseDailyNote(state.vault.files.get(path)!).tasks.filter((task) =>
						['A', 'B', 'C'].includes(task.text),
					);
					expect(
						tree.map((task) => ({
							text: task.text,
							indent: task.indent,
							section: task.sectionName,
						})),
					).toEqual([
						{ text: 'A', indent: '', section: 'Waiting' },
						{ text: 'B', indent: '  ', section: 'Waiting' },
						{ text: 'C', indent: '    ', section: 'Waiting' },
					]);
				}
				expect(state.vault.files.get(dailyPath)).toContain('### Notes\nDaily narrative.');
				expect(state.vault.files.get(otherPath)).toContain('- [ ] Unrelated ^unrelated');
			}
		},
	);

	it('adopts an older unlinked addition in a recursively reached counterpart before moving the tree', async () => {
		const state = await fixture();
		state.vault.files.set(
			sourcePath,
			'---\ntavern: project\n---\n## Work\n- [ ] A ^a\n  - [ ] B ^b1\n',
		);
		state.vault.files.set(
			dailyPath,
			'### Plan\n- [ ] B ^b2\n  - [ ] Older C\n### Notes\nKeep this.\n',
		);
		await state.options.saveLinks([
			{
				source: { path: sourcePath, blockId: 'b1' },
				copies: [{ path: dailyPath, blockId: 'b2' }],
				checked: false,
			},
		]);
		await state.service.moveProjectTask(state.tasks()[0]!, 'Waiting');
		for (const path of [sourcePath, dailyPath]) {
			const tree = parseDailyNote(state.vault.files.get(path)!).tasks;
			expect(tree.map((task) => ({ text: task.text, indent: task.indent }))).toEqual([
				{ text: 'A', indent: '' },
				{ text: 'B', indent: '  ' },
				{ text: 'Older C', indent: '    ' },
			]);
		}
		const added = state
			.links()
			.find((link) =>
				state
					.tasks()
					.some((task) => task.text === 'Older C' && task.blockId === link.source.blockId),
			)!;
		expect(added.source.path).toBe(sourcePath);
		expect(added.copies).toHaveLength(1);
		expect(added.copies[0]!.path).toBe(dailyPath);
		expect(added.source.blockId).not.toBe(added.copies[0]!.blockId);
	});

	it.each(['section', 'complete'] as const)(
		'preserves displaced sibling order during a linked tree %s',
		async (operation) => {
			const state = await fixture();
			const otherPath = '04_Projects/Other.md';
			state.vault.files.set(
				sourcePath,
				'---\ntavern: project\n---\n## Work\n- [ ] Parent ^parent\n  - [ ] A ^a-copy\n  - [ ] B ^b-copy\n',
			);
			state.vault.files.set(
				otherPath,
				'---\ntavern: project\n---\n## Work\n- [ ] A ^a-source\n- [ ] B ^b-source\n## Notes & Decisions\nKeep this.\n',
			);
			await state.options.saveLinks([
				{
					source: { path: otherPath, blockId: 'a-source' },
					copies: [{ path: sourcePath, blockId: 'a-copy' }],
					checked: false,
				},
				{
					source: { path: otherPath, blockId: 'b-source' },
					copies: [{ path: sourcePath, blockId: 'b-copy' }],
					checked: false,
				},
			]);
			if (operation === 'section') {
				await state.service.moveProjectTask(state.tasks()[0]!, 'Waiting');
			} else {
				await state.service.setProjectTaskChecked(state.tasks()[0]!, true);
			}
			for (const path of [sourcePath, otherPath]) {
				const { tasks } = parseDailyNote(state.vault.files.get(path)!);
				expect(
					tasks.map((task) => ({ text: task.text, indent: task.indent, checked: task.checked })),
				).toEqual([
					{ text: 'Parent', indent: '', checked: operation === 'complete' },
					{ text: 'A', indent: '  ', checked: false },
					{ text: 'B', indent: '  ', checked: false },
				]);
			}
			expect(state.vault.files.get(otherPath)).toContain('## Notes & Decisions\nKeep this.');
		},
	);

	it('rejects contradictory linked nesting cycles before persisting a tree move', async () => {
		const state = await fixture();
		state.vault.files.set(
			sourcePath,
			'---\ntavern: project\n---\n## Work\n- [ ] A ^a1\n  - [ ] B ^b1\n',
		);
		state.vault.files.set(dailyPath, '### Plan\n- [ ] B ^b2\n  - [ ] A ^a2\n');
		const links = [
			{
				source: { path: sourcePath, blockId: 'a1' },
				copies: [{ path: dailyPath, blockId: 'a2' }],
				checked: false,
			},
			{
				source: { path: sourcePath, blockId: 'b1' },
				copies: [{ path: dailyPath, blockId: 'b2' }],
				checked: false,
			},
		];
		await state.options.saveLinks(links);
		const before = new Map(state.vault.files);
		await expect(state.service.moveProjectTask(state.tasks()[0]!, 'Waiting')).rejects.toThrow(
			'inside its own children',
		);
		expect(state.vault.files).toEqual(before);
		expect(state.links()).toEqual(links);
	});

	it('keeps all notes unchanged if a related endpoint is missing and rolls back an earlier note after a later write fails', async () => {
		const state = await fixture();
		await state.service.copyProjectTask(day, state.tasks()[0]!);
		const parent = state.links()[0]!;
		const original = new Map(state.vault.files);
		state.vault.files.set(
			dailyPath,
			state.vault.files.get(dailyPath)!.replace(`^${parent.copies[0]!.blockId}`, '^missing'),
		);
		const source = state.tasks()[0]!;
		await expect(
			state.service.editProjectTaskPlan(source, { text: 'No write', children: [], siblings: [] }),
		).rejects.toThrow('missing or ambiguous');
		expect(state.vault.files.get(sourcePath)).toBe(original.get(sourcePath));
		state.vault.files.set(dailyPath, original.get(dailyPath)!);
		state.vault.failWritePath = dailyPath;
		await expect(
			state.service.editProjectTaskPlan(source, { text: 'No write', children: [], siblings: [] }),
		).rejects.toThrow('Disk write failed');
		expect(state.vault.files).toEqual(original);
	});

	it('retains unresolved links and rejects missing or duplicated blocks before changing another endpoint', async () => {
		const state = await fixture();
		await state.service.copyProjectTask(day, state.tasks()[0]!);
		const link = state.links()[0]!;
		const before = state.vault.files.get(dailyPath)!;
		state.vault.files.set(
			sourcePath,
			`${state.vault.files.get(sourcePath)!}- [ ] Collision ^${link.source.blockId}\n`,
		);
		await expect(
			state.service.setTaskChecked(day, `block:${link.copies[0]!.blockId}`, true),
		).rejects.toThrow('missing or ambiguous');
		expect(state.vault.files.get(dailyPath)).toBe(before);
		state.vault.files.delete(sourcePath);
		await expect(state.service.syncAll()).rejects.toThrow('Linked note was not found');
		expect(state.links()).toHaveLength(2);
		expect(state.vault.files.get(dailyPath)).toBe(before);
	});

	it('cancels failed copy relations, permits a retry with stable source IDs and stops queued work on disposal', async () => {
		const state = await fixture();
		const before = state.vault.files.get(dailyPath);
		state.vault.failWritePath = dailyPath;
		await expect(state.service.copyProjectTask(day, state.tasks()[0]!)).rejects.toThrow(
			'Disk write failed',
		);
		expect(state.vault.files.get(dailyPath)).toBe(before);
		expect(state.links()).toEqual([]);
		const sourceIds = state
			.tasks()
			.slice(0, 2)
			.map((task) => task.id);
		state.vault.failWritePath = undefined;
		await state.service.copyProjectTask(day, state.tasks()[0]!);
		expect(sourceIds.every((id) => !id.startsWith('block:'))).toBe(true);
		expect(
			state
				.tasks()
				.slice(0, 2)
				.every((task) => task.id.startsWith('block:')),
		).toBe(true);
		expect(state.links()).toHaveLength(2);
		const copied = state.vault.files.get(dailyPath);
		const queued = state.service.addTask(day, 'Do not write');
		state.service.dispose();
		await expect(queued).rejects.toThrow('disposed');
		expect(state.vault.files.get(dailyPath)).toBe(copied);
	});

	it('rejects generated IDs already used by an unrelated destination block before persisting a relation', async () => {
		const state = await fixture();
		const id = '00000000-0000-4000-8000-000000000001';
		const source = state.vault.files.get(sourcePath)!;
		const destination = `### Plan\n- [x] Unrelated ^tavern-${id}\n`;
		state.vault.files.set(dailyPath, destination);
		vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(id);
		await expect(state.service.copyProjectTask(day, state.tasks()[0]!)).rejects.toThrow(
			'Generated task block ID already exists',
		);
		expect(state.links()).toEqual([]);
		expect(state.vault.files.get(sourcePath)).toBe(source);
		expect(state.vault.files.get(dailyPath)).toBe(destination);
		await state.service.syncAll();
		expect(state.vault.files.get(dailyPath)).toBe(destination);
	});

	it.each([
		{ parent: '  ', child: '\t' },
		{ parent: '\t', child: '      ' },
	])(
		'copies beneath a target using its actual child indentation for $parent and $child',
		async ({ parent, child }) => {
			const state = await fixture();
			state.vault.files.set(
				dailyPath,
				`# Day\r\n## General\r\n### Plan\r\n- [ ] Outer ^outer\r\n${parent}- [ ] Target ^target\r\n${child}- [ ] Existing ^existing\r\n### Notes\r\nNarrative.`,
			);
			state.focus(state.tasks().map((task) => `${sourcePath}::${task.id}`));
			await state.service.copyProjectTask(day, state.tasks()[0]!, {
				taskId: 'block:target',
				placement: 'child',
			});
			expect(state.vault.files.get(dailyPath)!.replace(/ \^[A-Za-z0-9-]+/g, '')).toBe(
				`# Day\r\n## General\r\n### Plan\r\n- [ ] Outer\r\n${parent}- [ ] Target\r\n${child}- [ ] Same title\r\n${child}  - [ ] Child\r\n${child}- [ ] Existing\r\n### Notes\r\nNarrative.`,
			);
			expect(state.focused()).toEqual(state.tasks().map((task) => `${sourcePath}::${task.id}`));
			await state.service.editTask(day, 'block:target', 'Edited target');
			expect(
				parseDailyNote(state.vault.files.get(dailyPath)!).tasks.find(
					(task) => task.id === 'block:existing',
				)!.indent,
			).toBe(child);
		},
	);

	it('copies into a missing Plan beneath General while retaining later sections', async () => {
		const state = await fixture();
		state.vault.files.set(
			dailyPath,
			'# Day\n## General\nIntro.\n### Notes\nKeep notes.\n## Other\nOther prose.\n',
		);
		await state.service.copyProjectTask(day, state.tasks()[0]!);
		expect(state.vault.files.get(dailyPath)!.replace(/ \^[A-Za-z0-9-]+/g, '')).toBe(
			'# Day\n## General\nIntro.\n### Notes\nKeep notes.\n### Plan\n\n- [ ] Same title\n  - [ ] Child\n\n## Other\nOther prose.\n',
		);
	});

	it('places a project subtree under a nested daily target without disturbing surrounding narrative', async () => {
		const state = await fixture();
		state.vault.files.set(
			dailyPath,
			'### Plan\n- [ ] Daily parent ^daily-parent\n\t- [ ] Target ^target\n\t\t- [ ] Existing ^existing\n### Notes\nKeep this.\n',
		);
		await state.service.copyProjectTask(day, state.tasks()[0]!, {
			taskId: 'block:target',
			placement: 'child',
		});
		expect(state.vault.files.get(dailyPath)!.replace(/ \^[A-Za-z0-9-]+/g, '')).toBe(
			'### Plan\n- [ ] Daily parent\n\t- [ ] Target\n\t\t- [ ] Same title\n\t\t  - [ ] Child\n\t\t- [ ] Existing\n### Notes\nKeep this.\n',
		);
		expect(state.links().map((link) => link.copies[0]!.path)).toEqual([dailyPath, dailyPath]);
	});

	it.each([
		'missing day',
		'missing source',
		'duplicate source',
		'missing target',
		'duplicate target',
	] as const)(
		'rejects a %s before changing project content or saving relations',
		async (invalid) => {
			const state = await fixture();
			if (invalid === 'duplicate source') {
				state.vault.files.set(
					sourcePath,
					'---\ntavern: project\n---\n## Work\n- [ ] One ^same\n- [ ] Two ^same\n',
				);
			}
			if (invalid === 'duplicate target') {
				state.vault.files.set(dailyPath, '### Plan\n- [ ] One ^target\n- [ ] Two ^target\n');
			}
			const task = state.tasks()[0]!;
			const before = state.vault.files.get(sourcePath);
			const beforeDaily = state.vault.files.get(dailyPath);
			const target = invalid.includes('target')
				? { taskId: 'block:target', placement: 'child' as const }
				: undefined;
			const source = invalid === 'missing source' ? { ...task, id: 'block:removed' } : task;
			const message = {
				'missing day': 'Linked note was not found',
				'missing source': 'Source project task was missing or ambiguous',
				'duplicate source': 'Source project task was missing or ambiguous',
				'missing target': 'missing or ambiguous',
				'duplicate target': 'missing or ambiguous',
			}[invalid];
			await expect(
				state.service.copyProjectTask(
					invalid === 'missing day' ? '2026-10-25' : day,
					source,
					target,
				),
			).rejects.toThrow(message);
			expect(state.vault.files.get(sourcePath)).toBe(before);
			expect(state.vault.files.get(dailyPath)).toBe(beforeDaily);
			expect(state.links()).toEqual([]);
		},
	);

	it('propagates a live project-editor completion and ignores later unrelated file changes', async () => {
		const state = await fixture();
		await state.service.copyProjectTask(day, state.tasks()[0]!);
		const link = state.links()[0]!;
		state.vault.files.set(
			sourcePath,
			state.vault.files
				.get(sourcePath)!
				.replace(
					`- [ ] Same title ^${link.source.blockId}`,
					`- [x] Same title ^${link.source.blockId}`,
				),
		);
		await state.service.syncFile(sourcePath);
		expect(
			parseDailyNote(state.vault.files.get(dailyPath)!).tasks.map((task) => task.checked),
		).toEqual([true, false]);
		expect(state.tasks().find((task) => task.blockId === link.source.blockId)).toMatchObject({
			checked: true,
			sectionName: 'Done',
		});
		const before = state.vault.files.get(dailyPath);
		await state.service.syncFile('An unrelated note.md');
		await state.service.syncFile(sourcePath);
		expect(state.vault.files.get(dailyPath)).toBe(before);
	});

	it('edits and rearranges local daily tasks through the service without changing project content', async () => {
		const state = await fixture();
		state.vault.files.set(
			dailyPath,
			'### Plan\n- [ ] First ^first\n- [ ] Second ^second\n### Notes\nNarrative\n',
		);
		const before = state.vault.files.get(sourcePath);
		await state.service.editTask(day, 'block:second', 'Revised second');
		await state.service.moveTask(day, 'block:second', {
			taskId: 'block:first',
			placement: 'before',
		});
		const snapshot = await state.service.read(day);
		expect(snapshot.note!.tasks.map((task) => task.text)).toEqual(['Revised second', 'First']);
		expect(state.vault.files.get(dailyPath)).toBe(
			'### Plan\n- [ ] Revised second ^second\n- [ ] First ^first\n### Notes\nNarrative\n',
		);
		expect(state.vault.files.get(sourcePath)).toBe(before);
		expect(state.service.isLinked(state.tasks()[0]!)).toBe(false);
		await state.service.setProjectTaskChecked(state.tasks()[0]!, true);
		expect(state.tasks().find((task) => task.checked)?.sectionName).toBe('Done');
	});
});

const nextDay = '2026-10-25';
const nextDailyPath = 'Daily/2026/10/2026-10-25.md';
const carryTemplate =
	'# New day\n### Plan\n- [ ] Template item ^template\n### Notes\nNew narrative.\n';

const carryFixture = async (template = carryTemplate) => {
	const state = await fixture();
	const render = vi.fn(async (path: string) => {
		await state.vault.create(path, template);
		return true;
	});
	const store = new DailyLogStore(
		state.vault,
		() => 'Daily',
		() => new Date(),
		render,
	);
	const service = new DailyLogService(store, state.options);
	return { ...state, store, service, render };
};

describe('daily creation carry-forward', () => {
	it('moves whole unfinished task trees after template items while preserving completed trees and surrounding Markdown', async () => {
		const template = carryTemplate.replace(/\n/g, '\r\n');
		const state = await carryFixture(template);
		const openTree =
			'- [ ] Open parent ^open\r\n  continuation **body**\r\n  - [x] Checked child ^checked-child\r\n\t- [ ] Open child ^open-child\r\n';
		const checkedParentTree =
			'- [x] Checked parent ^checked-parent\r\n  - [ ] Unfinished child ^unfinished-child\r\n    detail ^detail\r\n';
		const before = [
			'---\r\nexample: "- [ ] YAML text"\r\n---\r\n# Previous day\r\n### Plan\r\nIntro.\r\n',
			openTree,
			'- [x] Finished parent ^finished\r\n  - [x] Finished child ^finished-child\r\n',
			checkedParentTree,
			'### Notes\r\nKeep narrative.\r\n```md\r\n- [ ] Fenced example\r\n```\r\n',
		].join('');
		state.vault.files.set(dailyPath, before);
		await state.service.create(nextDay);
		expect(state.vault.files.get(dailyPath)).toBe(
			before.replace(openTree, '').replace(checkedParentTree, ''),
		);
		expect(state.vault.files.get(nextDailyPath)).toBe(
			template.replace('### Notes', `${openTree}${checkedParentTree}### Notes`),
		);
		expect(state.links()).toEqual([]);
	});

	it.each([true, false])(
		'removes only the new template placeholder when work carries over: %s',
		async (carry) => {
			const template =
				'# New day\n### Plan\n- [ ] Task\n- [x] Task\n- [ ] Task ^intentional\n- [ ] Task details\n### Notes\n```md\n- [ ] Task\n```\n';
			const state = await carryFixture(template);
			const previous = carry
				? '### Plan\n- [ ] Task\n  - [x] Existing detail ^detail\n'
				: '### Plan\n- [x] Finished work\n';
			state.vault.files.set(dailyPath, previous);
			await state.service.create(nextDay);
			let expected = template;
			if (carry) {
				expected =
					'# New day\n### Plan\n- [x] Task\n- [ ] Task ^intentional\n- [ ] Task details\n- [ ] Task\n  - [x] Existing detail ^detail\n### Notes\n```md\n- [ ] Task\n```\n';
			}
			expect(state.vault.files.get(nextDailyPath)).toBe(expected);
			expect(state.vault.files.get(dailyPath)).toBe(carry ? '### Plan\n' : previous);
		},
	);

	it('relocates only selected daily source and copy endpoints and keeps edits and checking synchronized in both directions', async () => {
		const state = await carryFixture();
		const peerDay = '2026-10-20';
		const peerPath = 'Daily/2026/10/2026-10-20.md';
		const project =
			'---\ntavern: project\n---\n## Work\n- [ ] Project source ^project-source\n- [x] Completed source ^completed-source\n';
		const peer = '### Plan\n- [ ] Daily origin ^origin-peer\n';
		state.vault.files.set(sourcePath, project);
		state.vault.files.set(peerPath, peer);
		state.vault.files.set(
			dailyPath,
			'### Plan\n- [ ] Standalone\n- [ ] Daily copy ^daily-copy\n- [ ] Daily origin ^daily-origin\n- [x] Completed copy ^completed-copy\n',
		);
		const links: DailyTaskLink[] = [
			{
				source: { path: sourcePath, blockId: 'project-source' },
				copies: [{ path: dailyPath, blockId: 'daily-copy' }],
				checked: false,
			},
			{
				source: { path: dailyPath, blockId: 'daily-origin' },
				copies: [{ path: peerPath, blockId: 'origin-peer' }],
				checked: false,
			},
			{
				source: { path: sourcePath, blockId: 'completed-source' },
				copies: [{ path: dailyPath, blockId: 'completed-copy' }],
				checked: true,
			},
		];
		await state.options.saveLinks(links);
		await state.service.create(nextDay);
		expect(state.vault.files.get(sourcePath)).toBe(project);
		expect(state.vault.files.get(peerPath)).toBe(peer);
		expect(state.vault.files.get(dailyPath)).toBe(
			'### Plan\n- [x] Completed copy ^completed-copy\n',
		);
		expect(state.links()).toEqual([
			{ ...links[0], copies: [{ path: nextDailyPath, blockId: 'daily-copy' }] },
			{ ...links[1], source: { path: nextDailyPath, blockId: 'daily-origin' } },
			links[2],
		]);
		await state.service.editTask(nextDay, 'block:daily-copy', 'Edited from new day');
		expect(state.tasks().find((task) => task.blockId === 'project-source')!.text).toBe(
			'Edited from new day',
		);
		await state.service.editProjectTaskPlan(
			state.tasks().find((task) => task.blockId === 'project-source')!,
			{ text: 'Edited from project', children: [], siblings: [] },
		);
		expect(state.vault.files.get(nextDailyPath)).toContain('Edited from project ^daily-copy');
		await state.service.setTaskChecked(nextDay, 'block:daily-copy', true);
		expect(state.tasks().find((task) => task.blockId === 'project-source')!.checked).toBe(true);
		await state.service.setProjectTaskChecked(
			state.tasks().find((task) => task.blockId === 'project-source')!,
			false,
		);
		expect(state.vault.files.get(nextDailyPath)).toContain('- [ ] Edited from project ^daily-copy');
		await state.service.editTask(nextDay, 'block:daily-origin', 'Edited origin');
		expect(state.vault.files.get(peerPath)).toContain('Edited origin ^origin-peer');
		await state.service.editTask(peerDay, 'block:origin-peer', 'Edited peer');
		expect(state.vault.files.get(nextDailyPath)).toContain('Edited peer ^daily-origin');
		await state.service.setTaskChecked(peerDay, 'block:origin-peer', true);
		expect(state.vault.files.get(nextDailyPath)).toContain('- [x] Edited peer ^daily-origin');
		await state.service.setTaskChecked(nextDay, 'block:daily-origin', false);
		expect(state.vault.files.get(peerPath)).toContain('- [ ] Edited peer ^origin-peer');
	});

	it('leaves a destination created by another writer untouched when the creator reports no ownership', async () => {
		const state = await carryFixture();
		const previous = '### Plan\n- [ ] Previous work ^previous\n';
		state.vault.files.set(dailyPath, previous);
		state.render.mockImplementationOnce(async (path) => {
			state.vault.files.set(path, 'Another writer created this note.\n');
			return false;
		});
		const modify = vi.spyOn(state.vault, 'modify');
		await state.service.create(nextDay);
		expect(state.vault.files.get(nextDailyPath)).toBe('Another writer created this note.\n');
		expect(state.vault.files.get(dailyPath)).toBe(previous);
		expect(modify).not.toHaveBeenCalled();
	});

	it.each(['missing previous day', 'existing destination', 'template failure'] as const)(
		'leaves older work untouched for %s',
		async (scenario) => {
			const state = await carryFixture();
			const previous = '### Plan\n- [ ] Yesterday ^yesterday\n';
			const olderPath = 'Daily/2026/10/2026-10-23.md';
			const older = '### Plan\n- [ ] Older work ^older\n';
			state.vault.files.set(dailyPath, previous);
			state.vault.files.set(olderPath, older);
			if (scenario === 'missing previous day') {
				state.vault.files.delete(dailyPath);
			}
			if (scenario === 'existing destination') {
				state.vault.files.set(nextDailyPath, 'Existing note.\n');
			}
			if (scenario === 'template failure') {
				state.render.mockRejectedValueOnce(new Error('Templater failed.'));
				await expect(state.service.create(nextDay)).rejects.toThrow('Templater failed');
				expect(state.vault.files.has(nextDailyPath)).toBe(false);
			} else {
				await state.service.create(nextDay);
				expect(state.vault.files.get(nextDailyPath)).toBe(
					scenario === 'existing destination' ? 'Existing note.\n' : carryTemplate,
				);
			}
			expect(state.vault.files.get(olderPath)).toBe(older);
			expect(state.vault.files.get(dailyPath)).toBe(
				scenario === 'missing previous day' ? undefined : previous,
			);
			if (scenario === 'existing destination') {
				expect(state.render).not.toHaveBeenCalled();
			}
			expect(state.links()).toEqual([]);
		},
	);

	it.each(['task', 'prose'] as const)(
		'rejects a destination %s block collision before changing notes or relations',
		async (kind) => {
			const template = carryTemplate.replace(
				'### Notes',
				`${kind === 'task' ? '- [ ] Collision' : 'A paragraph'} ^collision\n### Notes`,
			);
			const state = await carryFixture(template);
			const previous = '### Plan\n- [ ] First ^first\n- [ ] Second ^collision\n';
			state.vault.files.set(dailyPath, previous);
			const modify = vi.spyOn(state.vault, 'modify');
			const save = vi.spyOn(state.options, 'saveLinks');
			await expect(state.service.create(nextDay)).rejects.toThrow('already exists');
			expect(state.vault.files.get(dailyPath)).toBe(previous);
			expect(state.vault.files.get(nextDailyPath)).toBe(template);
			expect(modify).not.toHaveBeenCalled();
			expect(save).not.toHaveBeenCalled();
			expect(state.links()).toEqual([]);
		},
	);

	it.each([
		'ambiguous selected block',
		'missing peer note',
		'missing peer block',
		'ambiguous peer block',
	] as const)('preflights every selected tree and linked counterpart with %s', async (invalid) => {
		const state = await carryFixture();
		let previous =
			'### Plan\n- [ ] First ^first\n- [x] Parent ^parent\n  - [ ] Linked child ^child\n';
		if (invalid === 'ambiguous selected block') {
			previous += 'Conflicting paragraph ^child\n';
		}
		state.vault.files.set(dailyPath, previous);
		state.vault.files.set(sourcePath, '- [ ] Peer ^peer\n');
		const otherPath = 'Other.md';
		if (invalid !== 'missing peer note') {
			state.vault.files.set(
				otherPath,
				invalid === 'missing peer block'
					? '- [ ] Missing ^other\n'
					: `- [ ] Other peer ^other-peer\n${invalid === 'ambiguous peer block' ? 'Conflicting paragraph ^other-peer\n' : ''}`,
			);
		}
		const links: DailyTaskLink[] = [
			{
				source: { path: sourcePath, blockId: 'peer' },
				copies: [
					{ path: dailyPath, blockId: 'child' },
					{ path: otherPath, blockId: 'other-peer' },
				],
				checked: false,
			},
		];
		await state.options.saveLinks(links);
		const before = new Map(state.vault.files);
		const modify = vi.spyOn(state.vault, 'modify');
		const save = vi.spyOn(state.options, 'saveLinks');
		await expect(state.service.create(nextDay)).rejects.toThrow(
			invalid === 'missing peer note' ? 'Linked note was not found' : 'missing or ambiguous',
		);
		expect(state.vault.files).toEqual(new Map([...before, [nextDailyPath, carryTemplate]]));
		expect(state.links()).toEqual(links);
		expect(modify).not.toHaveBeenCalled();
		expect(save).not.toHaveBeenCalled();
	});

	it.each(['settings', 'destination write', 'previous write'] as const)(
		'restores the template baseline and previous work after a failed %s',
		async (failure) => {
			const template = carryTemplate.replace('- [ ] Template item ^template', '- [ ] Task');
			const state = await carryFixture(template);
			const previous = '### Plan\n- [ ] Linked work ^daily-copy\n';
			state.vault.files.set(dailyPath, previous);
			const links: DailyTaskLink[] = [
				{
					source: { path: sourcePath, blockId: 'project-source' },
					copies: [{ path: dailyPath, blockId: 'daily-copy' }],
					checked: false,
				},
			];
			state.vault.files.set(sourcePath, '- [ ] Project work ^project-source\n');
			await state.options.saveLinks(links);
			const before = new Map(state.vault.files);
			const modify = vi.spyOn(state.vault, 'modify');
			if (failure === 'settings') {
				vi.spyOn(state.options, 'saveLinks').mockRejectedValueOnce(new Error('Settings failed.'));
			} else {
				state.vault.failWritePath = failure === 'destination write' ? nextDailyPath : dailyPath;
			}
			await expect(state.service.create(nextDay)).rejects.toThrow(
				failure === 'settings' ? 'Settings failed' : 'Disk write failed',
			);
			expect(state.vault.files).toEqual(new Map([...before, [nextDailyPath, template]]));
			expect(state.links()).toEqual(links);
			if (failure === 'settings') {
				expect(modify).not.toHaveBeenCalled();
			} else {
				expect(modify.mock.calls.map(([file]) => file.path)).toEqual(
					failure === 'destination write'
						? [nextDailyPath]
						: [nextDailyPath, dailyPath, nextDailyPath],
				);
			}
		},
	);
});
