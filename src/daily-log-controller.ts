import type { DailyNote, DailyTaskDropPlacement } from './daily-note';
import type { ProjectBoardTask } from './project-library';
import type { TaskEditPlan } from './task-edit';

type DailyLogSnapshot = {
	day: string;
	path: string;
	note: DailyNote | null;
};

type DailyLogDropTarget = {
	taskId: string;
	placement: DailyTaskDropPlacement;
};

interface DailyLogController {
	isLinked?(task: ProjectBoardTask): boolean;
	setProjectTaskChecked?(task: ProjectBoardTask, checked: boolean): Promise<void>;
	syncAll?(): Promise<void>;
	editProjectTaskPlan?(task: ProjectBoardTask, plan: TaskEditPlan): Promise<void>;
	addProjectTaskPlan?(projectPath: string, sectionName: string, plan: TaskEditPlan): Promise<void>;
	today(): string;
	read(day: string): Promise<DailyLogSnapshot>;
	create(day: string): Promise<void>;
	addTask(day: string, text: string): Promise<void>;
	addTaskPlan(day: string, plan: TaskEditPlan): Promise<void>;
	editTaskPlan(day: string, taskId: string, plan: TaskEditPlan): Promise<void>;
	editTask(day: string, taskId: string, text: string): Promise<void>;
	setTaskChecked(day: string, taskId: string, checked: boolean): Promise<void>;
	moveTask(day: string, sourceId: string, target: DailyLogDropTarget): Promise<void>;
	copyProjectTask(day: string, task: ProjectBoardTask, target?: DailyLogDropTarget): Promise<void>;
}

export type { DailyLogController, DailyLogDropTarget, DailyLogSnapshot };
