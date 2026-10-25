/* eslint-disable eslint/max-params, eslint/max-statements, eslint/no-magic-numbers */
import { TFile, TFolder, type App } from 'obsidian';
import { createDailyNoteFromTemplate } from '../src/daily-note-creator';

vi.mock('obsidian', () => ({
	TFile: class {},
	TFolder: class {},
	normalizePath: (path: string) =>
		path
			.replace(/\\/g, '/')
			.replace(/\/+/g, '/')
			.replace(/^\/|\/$/g, ''),
}));

const path = 'Daily/2026/10/2026-10-25.md';
const templatePath = 'Templates/Daily.md';
const makeFile = (filePath: string): TFile =>
	Object.assign(new TFile(), { path: filePath, extension: filePath.split('.').pop() });
const makeFolder = (folderPath: string): TFolder =>
	Object.assign(new TFolder(), { path: folderPath });

const setup = () => {
	const template = makeFile(templatePath);
	const entries = new Map<string, TFile | TFolder>([[templatePath, template]]);
	const root = makeFolder('/');
	const vault = {
		getAbstractFileByPath: vi.fn((filePath: string) => entries.get(filePath) ?? null),
		getRoot: vi.fn(() => root),
		createFolder: vi.fn(async (folderPath: string) => {
			const parent = folderPath.split('/').slice(0, -1).join('/');
			if (parent && !(entries.get(parent) instanceof TFolder)) {
				throw new Error('Parent folder does not exist.');
			}
			const folder = makeFolder(folderPath);
			entries.set(folderPath, folder);
			return folder;
		}),
	};
	const create =
		vi.fn<
			(template: TFile, folder: TFolder, title: string, open: boolean) => Promise<TFile | undefined>
		>();
	const templater = { create_new_note_from_template: create };
	const registry = { getPlugin: vi.fn<() => unknown>(() => ({ templater })) };
	const app = { vault, plugins: registry } as unknown as App;
	return { app, entries, vault, template, create, templater, registry };
};

describe('Templater daily note creation boundary', () => {
	it('passes the selected file, requested date title and existing folder to the bound API without opening a note', async () => {
		const fixture = setup();
		const existingFolder = makeFolder('Daily');
		fixture.entries.set('Daily', existingFolder);
		const created = makeFile(path);
		fixture.create.mockImplementation(async () => {
			fixture.entries.set(path, created);
			return created;
		});

		await createDailyNoteFromTemplate(fixture.app, ' /Templates/Daily ', path);

		expect(fixture.registry.getPlugin).toHaveBeenCalledWith('templater-obsidian');
		expect(fixture.create).toHaveBeenCalledExactlyOnceWith(
			fixture.template,
			fixture.entries.get('Daily/2026/10'),
			'2026-10-25',
			false,
		);
		expect(fixture.create.mock.contexts[0]).toBe(fixture.templater);
		expect(fixture.vault.createFolder.mock.calls).toEqual([['Daily/2026'], ['Daily/2026/10']]);
		expect(fixture.entries.get('Daily')).toBe(existingFolder);
	});

	it('uses an exact template path before trying the optional Markdown extension', async () => {
		const fixture = setup();
		const exactTemplate = makeFile('Templates/Exact.md');
		fixture.entries.set('Templates/Exact.md', exactTemplate);
		fixture.entries.set('Templates/Exact.md.md', makeFile('Templates/Exact.md.md'));
		const created = makeFile('2026-10-25.md');
		fixture.create.mockImplementation(async () => {
			fixture.entries.set(created.path, created);
			return created;
		});

		await createDailyNoteFromTemplate(fixture.app, 'Templates/Exact.md', created.path);

		expect(fixture.create).toHaveBeenCalledExactlyOnceWith(
			exactTemplate,
			fixture.vault.getRoot(),
			'2026-10-25',
			false,
		);
		expect(fixture.vault.createFolder).not.toHaveBeenCalled();
	});

	it.each([
		undefined,
		{},
		{ templater: {} },
		{ templater: { create_new_note_from_template: true } },
	])(
		'rejects an unavailable or incompatible Templater plugin before creating folders: %j',
		async (plugin) => {
			const fixture = setup();
			fixture.registry.getPlugin.mockReturnValue(plugin);

			await expect(createDailyNoteFromTemplate(fixture.app, templatePath, path)).rejects.toThrow(
				'Templater',
			);

			expect(fixture.vault.createFolder).not.toHaveBeenCalled();
			expect(fixture.create).not.toHaveBeenCalled();
			expect(fixture.entries.has(path)).toBe(false);
		},
	);

	it.each(['', 'Templates/Missing', 'Templates/Folder', 'Templates/Image.png'])(
		'rejects an unconfigured or invalid template before creating folders: %s',
		async (configuredPath) => {
			const fixture = setup();
			fixture.entries.set('Templates/Folder', makeFolder('Templates/Folder'));
			fixture.entries.set('Templates/Image.png', makeFile('Templates/Image.png'));

			await expect(createDailyNoteFromTemplate(fixture.app, configuredPath, path)).rejects.toThrow(
				/template/i,
			);

			expect(fixture.vault.createFolder).not.toHaveBeenCalled();
			expect(fixture.create).not.toHaveBeenCalled();
		},
	);

	it('leaves an existing note untouched even when Templater is unavailable', async () => {
		const fixture = setup();
		const existing = makeFile(path);
		fixture.entries.set(path, existing);
		fixture.registry.getPlugin.mockReturnValue(undefined);

		await createDailyNoteFromTemplate(fixture.app, templatePath, path);

		expect(fixture.entries.get(path)).toBe(existing);
		expect(fixture.vault.createFolder).not.toHaveBeenCalled();
		expect(fixture.create).not.toHaveBeenCalled();
	});

	it.each([path, 'Daily'])(
		'rejects a folder at the target or a file blocking its ancestors: %s',
		async (collision) => {
			const fixture = setup();
			let entry: TFile | TFolder = makeFile(collision);
			if (collision === path) {
				entry = makeFolder(collision);
			}
			fixture.entries.set(collision, entry);

			await expect(createDailyNoteFromTemplate(fixture.app, templatePath, path)).rejects.toThrow(
				'blocks',
			);

			expect(fixture.vault.createFolder).not.toHaveBeenCalled();
			expect(fixture.create).not.toHaveBeenCalled();
		},
	);

	it('continues after another creator supplies a required folder, but preserves unrelated folder errors', async () => {
		const fixture = setup();
		fixture.vault.createFolder.mockImplementationOnce(async (folderPath) => {
			fixture.entries.set(folderPath, makeFolder(folderPath));
			throw new Error('Already exists.');
		});
		fixture.vault.createFolder.mockRejectedValueOnce(new Error('Disk unavailable.'));

		await expect(createDailyNoteFromTemplate(fixture.app, templatePath, path)).rejects.toThrow(
			'Disk unavailable',
		);

		expect(fixture.vault.createFolder.mock.calls).toEqual([['Daily'], ['Daily/2026']]);
		expect(fixture.create).not.toHaveBeenCalled();
	});

	it('fails visibly when a concurrent creator supplies the target before invoking Templater', async () => {
		const fixture = setup();
		const createFolder = fixture.vault.createFolder.getMockImplementation()!;
		const concurrent = makeFile(path);
		fixture.vault.createFolder.mockImplementation(async (folderPath) => {
			const folder = await createFolder(folderPath);
			fixture.entries.set(path, concurrent);
			return folder;
		});

		await expect(createDailyNoteFromTemplate(fixture.app, templatePath, path)).rejects.toThrow(
			'appeared during creation',
		);

		expect(fixture.entries.get(path)).toBe(concurrent);
		expect(fixture.create).not.toHaveBeenCalled();
	});

	it.each(['undefined', 'reject', 'moved', 'missing', 'replaced'] as const)(
		'surfaces a failed or unverifiable Templater result without attempting a replacement: %s',
		async (outcome) => {
			const fixture = setup();
			let resultPath = path;
			if (outcome === 'moved') {
				resultPath = 'Elsewhere/2026-10-25.md';
			}
			const created = makeFile(resultPath);
			fixture.create.mockImplementation(async () => {
				if (outcome === 'reject') {
					throw new Error('Template script failed.');
				}
				if (outcome === 'undefined') {
					return undefined;
				}
				if (outcome === 'moved') {
					fixture.entries.set(created.path, created);
				}
				if (outcome === 'replaced') {
					fixture.entries.set(path, makeFile(path));
				}
				return created;
			});
			const expectedError = {
				undefined: 'Templater did not create',
				reject: 'Template script failed',
				moved: `Elsewhere/2026-10-25.md; Tavern expected ${path}`,
				missing: 'was not found',
				replaced: 'was not found',
			}[outcome];

			await expect(createDailyNoteFromTemplate(fixture.app, templatePath, path)).rejects.toThrow(
				expectedError,
			);

			expect(fixture.create).toHaveBeenCalledTimes(1);
			if (outcome === 'moved') {
				expect(fixture.entries.get(created.path)).toBe(created);
				expect(fixture.entries.has(path)).toBe(false);
			}
		},
	);
});
