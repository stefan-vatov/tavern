/* eslint-disable eslint/max-statements, import/prefer-default-export */
import { TFile, TFolder, normalizePath, type App } from 'obsidian';

interface TemplaterCreator {
	create_new_note_from_template(
		template: TFile,
		folder: TFolder,
		title: string,
		open: boolean,
	): Promise<TFile | undefined>;
}

const getTemplater = (app: App): TemplaterCreator => {
	const registry = (app as App & { plugins?: { getPlugin?: (id: string) => unknown } }).plugins;
	if (typeof registry?.getPlugin !== 'function') {
		throw new Error('Daily log creation requires the installed and enabled Templater plugin.');
	}
	const plugin = registry.getPlugin('templater-obsidian') as
		| { templater?: Partial<TemplaterCreator> }
		| undefined;
	if (typeof plugin?.templater?.create_new_note_from_template !== 'function') {
		throw new Error(
			'Daily log creation requires an enabled Templater plugin with its creation API.',
		);
	}
	return plugin.templater as TemplaterCreator;
};

const getTemplate = (app: App, templatePath: string): TFile => {
	const configuredPath = templatePath.trim();
	if (!configuredPath) {
		throw new Error('Choose a daily log template in Tavern settings before creating a daily log.');
	}
	const path = normalizePath(configuredPath);
	const exact = app.vault.getAbstractFileByPath(path);
	const template = exact ?? app.vault.getAbstractFileByPath(`${path}.md`);
	if (!(template instanceof TFile) || template.extension !== 'md') {
		throw new Error(`Daily log template was not found as a Markdown file: ${path}`);
	}
	return template;
};

const ensureFolder = async (app: App, path: string): Promise<TFolder> => {
	const existing = app.vault.getAbstractFileByPath(path);
	if (existing instanceof TFolder) {
		return existing;
	}
	if (existing) {
		throw new Error(`A file blocks the daily log folder: ${path}`);
	}
	try {
		await app.vault.createFolder(path);
	} catch (error) {
		if (!(app.vault.getAbstractFileByPath(path) instanceof TFolder)) {
			throw error;
		}
	}
	const folder = app.vault.getAbstractFileByPath(path);
	if (!(folder instanceof TFolder)) {
		throw new Error(`Daily log folder was not created: ${path}`);
	}
	return folder;
};

const ensureAncestors = async (app: App, path: string): Promise<TFolder> => {
	const segments = path.split('/');
	segments.pop();
	let folder = app.vault.getRoot();
	const parents: string[] = [];
	for (const segment of segments) {
		parents.push(segment);
		folder = await ensureFolder(app, parents.join('/'));
	}
	return folder;
};

const createDailyNoteFromTemplate = async (
	app: App,
	templatePath: string,
	path: string,
): Promise<void> => {
	const expectedPath = normalizePath(path);
	const existing = app.vault.getAbstractFileByPath(expectedPath);
	if (existing instanceof TFile) {
		return;
	}
	if (existing) {
		throw new Error(`A folder blocks the daily log note: ${expectedPath}`);
	}
	const templater = getTemplater(app);
	const template = getTemplate(app, templatePath);
	const folder = await ensureAncestors(app, expectedPath);
	if (app.vault.getAbstractFileByPath(expectedPath)) {
		throw new Error(`The daily log path appeared during creation: ${expectedPath}. Please retry.`);
	}
	const title = expectedPath.split('/').pop()!.replace(/\.md$/, '');
	const created = await templater.create_new_note_from_template(template, folder, title, false);
	if (!(created instanceof TFile)) {
		throw new Error(`Templater did not create the daily log: ${expectedPath}`);
	}
	if (created.path !== expectedPath) {
		throw new Error(
			`Templater created the note at ${created.path}; Tavern expected ${expectedPath}.`,
		);
	}
	if (app.vault.getAbstractFileByPath(expectedPath) !== created) {
		throw new Error(`The daily log created by Templater was not found: ${expectedPath}`);
	}
};

export { createDailyNoteFromTemplate };
