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
			focused = focused.map((key) => mapping.get(key) ?? key);
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
		expect(
			state
				.tasks()
				.slice(0, 2)
				.map((task) => task.id),
		).toEqual(sourceIds);
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
		await expect(state.service.setProjectTaskChecked(state.tasks()[0]!, true)).rejects.toThrow(
			'not linked',
		);
	});
});
