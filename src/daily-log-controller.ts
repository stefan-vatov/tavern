import type { DailyNote, DailyTaskDropPlacement } from './daily-note';
import type { ProjectBoardTask } from './project-library';
import type { ProjectTaskDropPlacement, ProjectTaskReorderDirection } from './project-note';
import type { TaskDeleteMode, TaskEditPlan } from './task-edit';

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
	setProjectTaskChecked?(
		task: ProjectBoardTask,
		checked: boolean,
	): Promise<Map<string, string> | void>;
	moveProjectTask?(
		task: ProjectBoardTask,
		sectionName: string,
	): Promise<Map<string, string> | void>;
	moveProjectTaskToPosition?(
		source: ProjectBoardTask,
		target: ProjectBoardTask,
		placement: ProjectTaskDropPlacement,
	): Promise<Map<string, string> | void>;
	reorderProjectTask?(
		task: ProjectBoardTask,
		direction: ProjectTaskReorderDirection,
	): Promise<Map<string, string> | void>;
	whenIdle?(): Promise<void>;
	onTaskReferencesChanged?(
		listener: (path: string, mapping: Map<string, string>, kind: 'project' | 'daily') => void,
	): () => void;
	syncAll?(): Promise<void>;
	editProjectTaskPlan?(
		task: ProjectBoardTask,
		plan: TaskEditPlan,
	): Promise<Map<string, string> | void>;
	deleteProjectTask?(
		task: ProjectBoardTask,
		mode: TaskDeleteMode,
	): Promise<Map<string, string> | void>;
	addProjectTaskPlan?(
		projectPath: string,
		sectionName: string,
		plan: TaskEditPlan,
	): Promise<Map<string, string> | void>;
	today(): string;
	read(day: string): Promise<DailyLogSnapshot>;
	create(day: string): Promise<void>;
	addTask(day: string, text: string): Promise<void>;
	addTaskPlan(day: string, plan: TaskEditPlan): Promise<Map<string, string> | void>;
	editTaskPlan(
		day: string,
		taskId: string,
		plan: TaskEditPlan,
	): Promise<Map<string, string> | void>;
	deleteTask(
		day: string,
		taskId: string,
		mode: TaskDeleteMode,
	): Promise<Map<string, string> | void>;
	editTask(day: string, taskId: string, text: string): Promise<Map<string, string> | void>;
	setTaskChecked(
		day: string,
		taskId: string,
		checked: boolean,
	): Promise<Map<string, string> | void>;
	moveTask(
		day: string,
		sourceId: string,
		target: DailyLogDropTarget,
	): Promise<Map<string, string> | void>;
	copyProjectTask(day: string, task: ProjectBoardTask, target?: DailyLogDropTarget): Promise<void>;
}

export type { DailyLogController, DailyLogDropTarget, DailyLogSnapshot };
