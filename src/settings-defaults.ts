import type { DailyTaskLink } from './daily-log-service';

interface TavernSettings {
	availableTasksCollapsed?: boolean;
	boardTaskKeys: string[];
	dailyLogFolder?: string;
	dailyLogTemplate?: string;
	dailyTaskLinks?: DailyTaskLink[];
	projectFolders: string[];
	sidebarCollapsedSections?: string[];
	tavernName: string;
}

const DEFAULT_SETTINGS: TavernSettings = {
	availableTasksCollapsed: false,
	boardTaskKeys: [],
	dailyLogFolder: '02_Daily_Log/Daily_Log',
	dailyLogTemplate: '',
	dailyTaskLinks: [],
	projectFolders: ['04_Projects'],
	sidebarCollapsedSections: [],
	tavernName: 'Tavern',
};

export { DEFAULT_SETTINGS };
export type { TavernSettings };
