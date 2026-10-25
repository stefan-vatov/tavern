/* eslint-disable eslint/no-magic-numbers, eslint/max-statements */
import { DailyLogStore, type DailyLogVault } from '../src/daily-log-store';
import type { ProjectVaultFile } from '../src/project-vault';

class MemoryVault implements DailyLogVault {
	readonly files = new Map<string, string>();
	readonly folders = new Set<string>();
	readError: Error | undefined = undefined;
	writeError: Error | undefined = undefined;

	getMarkdownFiles(): ProjectVaultFile[] {
		return [...this.files.keys()].map((path) => ({ path }));
	}

	getAbstractFileByPath(path: string): ProjectVaultFile | null {
		if (this.files.has(path) || this.folders.has(path)) {
			return { path };
		}
		return null;
	}

	async read(file: ProjectVaultFile): Promise<string> {
		if (this.readError) {
			throw this.readError;
		}
		return this.contents(file.path);
	}

	async modify(file: ProjectVaultFile, markdown: string): Promise<void> {
		this.contents(file.path);
		this.write(file.path, markdown);
	}

	async create(path: string, markdown: string): Promise<ProjectVaultFile> {
		this.requireParent(path);
		if (this.getAbstractFileByPath(path)) {
			throw new Error('Path already exists.');
		}
		this.write(path, markdown);
		return { path };
	}

	async createFolder(path: string): Promise<void> {
		this.requireParent(path);
		if (this.getAbstractFileByPath(path)) {
			throw new Error('Path already exists.');
		}
		if (this.writeError) {
			throw this.writeError;
		}
		this.folders.add(path);
	}

	async process(file: ProjectVaultFile, transform: (markdown: string) => string): Promise<string> {
		const next = transform(this.contents(file.path));
		this.write(file.path, next);
		return next;
	}

	private contents(path: string): string {
		const markdown = this.files.get(path);
		if (markdown === undefined) {
			throw new Error('File was not found.');
		}
		return markdown;
	}

	private write(path: string, markdown: string): void {
		if (this.writeError) {
			throw this.writeError;
		}
		this.files.set(path, markdown);
	}

	private requireParent(path: string): void {
		const parent = path.split('/').slice(0, -1).join('/');
		if (parent && !this.folders.has(parent)) {
			throw new Error('Parent folder was not found.');
		}
	}
}

const day = '2026-10-24';
const path = '02_Daily_Log/Daily_Log/2026/10/2026-10-24.md';
const makeStore = (vault: MemoryVault): DailyLogStore =>
	new DailyLogStore(
		vault,
		() => '02_Daily_Log/Daily_Log',
		() => new Date(2026, 9, 24, 23, 59),
	);

describe('daily log vault storage', () => {
	it.each(['- [ ] Duplicated task ^copy', 'Duplicated paragraph ^copy'])(
		'rejects editing and moving an ambiguous daily block shared with %s',
		async (duplicate) => {
			const vault = new MemoryVault();
			const before = `### Plan\n- [ ] First copy ^copy\n${duplicate}\n- [ ] Other ^other\n`;
			vault.files.set(path, before);
			const store = makeStore(vault);
			await expect(store.editTask(day, 'block:copy', 'Wrong edit')).rejects.toThrow('ambiguous');
			for (const mode of ['task', 'tree'] as const) {
				await expect(store.deleteTask(day, 'block:copy', mode)).rejects.toThrow('ambiguous');
			}
			await expect(
				store.moveTask(day, 'block:copy', { taskId: 'block:other', placement: 'after' }),
			).rejects.toThrow('ambiguous');
			await expect(
				store.moveTask(day, 'block:other', { taskId: 'block:copy', placement: 'before' }),
			).rejects.toThrow('ambiguous');
			expect(vault.files.get(path)).toBe(before);
		},
	);
	it('reads the exact local day without creating it or substituting an older note', async () => {
		const vault = new MemoryVault();
		vault.files.set('02_Daily_Log/Daily_Log/2026/10/2026-10-23.md', '- [ ] Yesterday');
		const store = makeStore(vault);

		expect(store.today()).toBe(day);
		expect(await store.read(store.today())).toEqual({ day, path, note: null });
		expect([...vault.files.keys()]).toEqual(['02_Daily_Log/Daily_Log/2026/10/2026-10-23.md']);
		expect(vault.folders.size).toBe(0);
		await expect(store.addTask(day, 'Capture')).rejects.toThrow('Daily note was not found');
	});

	it('creates requested ancestors and survives concurrent creation without replacing content', async () => {
		const vault = new MemoryVault();
		const store = makeStore(vault);
		await Promise.all([store.create(day), makeStore(vault).create(day)]);
		expect(vault.files.get(path)).toBe('# 2026-10-24\n\n## General\n\n### Plan\n\n### Notes\n');
		expect([...vault.folders]).toEqual([
			'02_Daily_Log',
			'02_Daily_Log/Daily_Log',
			'02_Daily_Log/Daily_Log/2026',
			'02_Daily_Log/Daily_Log/2026/10',
		]);
		vault.files.set(path, 'Human-authored note.');
		await store.create(day);
		expect(vault.files.get(path)).toBe('Human-authored note.');
		expect([...vault.files.keys()]).toEqual([path]);
	});

	it('awaits template creation and surfaces failures even when a partial note exists', async () => {
		const vault = new MemoryVault();
		let finish: () => void = () => {};
		// eslint-disable-next-line promise/avoid-new -- Hold template execution to observe whether creation awaits it.
		const ready = new Promise<void>((resolve) => {
			finish = resolve;
		});
		const create = vi.fn(async (target: string, selectedDay: string) => {
			expect(target).toBe(path);
			expect(selectedDay).toBe(day);
			vault.files.set(target, 'Partial template output');
			await ready;
			throw new Error('Template failed');
		});
		const store = new DailyLogStore(vault, () => '02_Daily_Log/Daily_Log', undefined, create);
		let settled = false;
		const observeCreation = async () => {
			try {
				await store.create(day);
			} finally {
				settled = true;
			}
		};
		const result = observeCreation();
		await Promise.resolve();
		expect(settled).toBe(false);
		expect(vault.folders.size).toBe(0);
		finish();
		await expect(result).rejects.toThrow('Template failed');
		expect(vault.files.get(path)).toBe('Partial template output');
		expect(create).toHaveBeenCalledTimes(1);
	});

	it('mutates fresh Markdown atomically while preserving metadata, narrative, IDs and nested task trees', async () => {
		const vault = new MemoryVault();
		const store = makeStore(vault);
		await store.create(day);
		vault.files.set(
			path,
			'---\ntitle: Private log\n---\n### Plan\n- [ ] Parent ^parent\n  - [ ] Child ^child\n- [ ] Other ^other\n### Notes\nAn ordinary paragraph.\n',
		);
		await store.read(day);
		vault.files.set(
			path,
			vault.files.get(path)!.replace('### Plan', 'Fresh outside edit.\n### Plan'),
		);
		vault.readError = new Error('Separate reads are unavailable during a vault process.');

		await store.editTask(day, 'block:parent', 'Renamed');
		await store.setTaskChecked(day, 'block:parent', true);
		await store.moveTask(day, 'block:parent', { taskId: 'block:other', placement: 'after' });
		await store.addTask(day, 'Captured');
		expect(vault.files.get(path)).toBe(
			'---\ntitle: Private log\n---\nFresh outside edit.\n### Plan\n- [ ] Other ^other\n- [x] Renamed ^parent\n  - [ ] Child ^child\n- [ ] Captured\n### Notes\nAn ordinary paragraph.\n',
		);
	});

	it('returns authoritative daily references after clearing a parent and promoting its children', async () => {
		const vault = new MemoryVault();
		const store = makeStore(vault);
		vault.files.set(
			path,
			'### Plan\n- [ ] Parent\n  - [x] Child ^child\n- [ ] Next\n### Notes\n- [ ] Later\n',
		);
		const mapping = await store.editTaskPlan(day, 'line:1', {
			text: '',
			children: [],
			siblings: [],
		});
		expect(vault.files.get(path)).toBe(
			'### Plan\n- [x] Child ^child\n- [ ] Next\n### Notes\n- [ ] Later\n',
		);
		expect([...mapping]).toEqual([
			['line:1', ''],
			['block:child', 'block:child'],
			['line:3', 'line:2'],
			['line:5', 'line:4'],
		]);
	});

	it('maps existing daily drafts through capture staging and returns identity references for an empty capture', async () => {
		const vault = new MemoryVault();
		const store = makeStore(vault);
		vault.files.set(
			path,
			'# Log\n## General\nProse.\n## Other\n\n- [ ] Draft\n  - [ ] Child ^child\n',
		);
		const process = vi.spyOn(vault, 'process');
		const mapping = await store.addTaskPlan(day, {
			text: 'Captured',
			children: [{ text: 'Nested capture', children: [] }],
			siblings: [{ text: 'Next capture', children: [] }],
		});
		expect(vault.files.get(path)).toBe(
			'# Log\n## General\nProse.\n### Plan\n\n- [ ] Captured\n  - [ ] Nested capture\n- [ ] Next capture\n\n## Other\n\n- [ ] Draft\n  - [ ] Child ^child\n',
		);
		expect([...mapping]).toEqual([
			['line:5', 'line:11'],
			['block:child', 'block:child'],
		]);
		const identity = await store.addTaskPlan(day, { text: ' ', children: [], siblings: [] });
		expect([...identity]).toEqual([
			['line:5', 'line:5'],
			['line:6', 'line:6'],
			['line:7', 'line:7'],
			['line:11', 'line:11'],
			['block:child', 'block:child'],
		]);
		expect(process).toHaveBeenCalledTimes(1);
	});

	it.each(['task', 'tree'] as const)(
		'deletes a daily %s from the current note and preserves content added after the last read',
		async (mode) => {
			const vault = new MemoryVault();
			const store = makeStore(vault);
			const source =
				'### Plan\r\n- [ ] Parent ^parent\r\n  - [x] Child ^child\r\n- [ ] Next ^next\r\n### Notes\r\nNarrative.\r\n- [ ] Later';
			vault.files.set(path, source);
			await store.read(day);
			vault.files.set(path, source.replace('### Plan', 'Outside edit.\r\n### Plan'));
			vault.readError = new Error('Deletion must use the current vault process content.');
			const mapping = await store.deleteTask(day, 'block:parent', mode);
			let child = '';
			let childId = '';
			let laterId = 'line:5';
			if (mode === 'task') {
				childId = 'block:child';
				laterId = 'line:6';
				child = '- [x] Child ^child\r\n';
			}
			expect(vault.files.get(path)).toBe(
				`Outside edit.\r\n### Plan\r\n${child}- [ ] Next ^next\r\n### Notes\r\nNarrative.\r\n- [ ] Later`,
			);
			expect([...mapping]).toEqual([
				['block:parent', ''],
				['block:child', childId],
				['block:next', 'block:next'],
				['line:7', laterId],
			]);
			const beforeFailure = vault.files.get(path);
			await expect(store.deleteTask(day, 'block:parent', mode)).rejects.toThrow(
				'Daily task was not found',
			);
			vault.writeError = new Error('Deletion write failed.');
			await expect(store.deleteTask(day, 'block:next', mode)).rejects.toThrow(
				'Deletion write failed',
			);
			expect(vault.files.get(path)).toBe(beforeFailure);
			await expect(store.deleteTask('2026-10-25', 'block:next', mode)).rejects.toThrow(
				'Daily note was not found',
			);
		},
	);

	it('rejects missing task identities and invalid transformations without changing the note', async () => {
		const vault = new MemoryVault();
		const store = makeStore(vault);
		await store.create(day);
		const before = vault.files.get(path);
		await expect(store.editTask(day, 'block:removed', 'New text')).rejects.toThrow(
			'Daily task was not found',
		);
		await expect(store.setTaskChecked(day, 'line:999', true)).rejects.toThrow(
			'Daily task was not found',
		);
		await expect(store.addTask(day, ' ')).rejects.toThrow('Task text was empty');
		expect(vault.files.get(path)).toBe(before);
	});

	it('surfaces vault failures as errors without reporting a missing note or writing a replacement', async () => {
		const vault = new MemoryVault();
		const store = makeStore(vault);
		await store.create(day);
		const before = vault.files.get(path);
		vault.readError = new Error('Disk read failed.');
		await expect(store.read(day)).rejects.toThrow('Disk read failed');
		vault.writeError = new Error('Disk write failed.');
		await expect(store.addTask(day, 'Capture')).rejects.toThrow('Disk write failed');
		await expect(store.create('2026-10-25')).rejects.toThrow('Disk write failed');
		expect(vault.files.get(path)).toBe(before);
		expect(vault.files.has('02_Daily_Log/Daily_Log/2026/10/2026-10-25.md')).toBe(false);
	});
});
