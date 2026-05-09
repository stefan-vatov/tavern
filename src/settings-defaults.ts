interface TavernSettings {
	boardTaskKeys: string[];
	projectFolders: string[];
	sidebarCollapsedSections?: string[];
	tavernName: string;
}

const DEFAULT_SETTINGS: TavernSettings = {
	boardTaskKeys: [],
	projectFolders: ['04_Projects'],
	sidebarCollapsedSections: [],
	tavernName: 'Tavern',
};

export { DEFAULT_SETTINGS };
export type { TavernSettings };
