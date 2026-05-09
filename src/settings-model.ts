import { DEFAULT_SETTINGS } from './settings-defaults';

const EMPTY_LENGTH = 0;

const normalizeTavernName = (value: string): string => value.trim() || DEFAULT_SETTINGS.tavernName;

const normalizeProjectFolders = (folders: string[]): string[] => {
	const normalized = folders
		.map((folder) => folder.trim())
		.filter((folder) => folder.length > EMPTY_LENGTH);

	if (normalized.length === EMPTY_LENGTH) {
		return [...DEFAULT_SETTINGS.projectFolders];
	}

	return normalized;
};

const parseProjectFolders = (value: string): string[] => normalizeProjectFolders(value.split(','));

export { normalizeTavernName, parseProjectFolders };
