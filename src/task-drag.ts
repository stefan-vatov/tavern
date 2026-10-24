import { indentWidth, type ProjectTaskDropPlacement } from './project-note';

const NEST_TASK_OFFSET = 63;
const BEFORE_EDGE_RATIO = 0.33;
const AFTER_EDGE_RATIO = 0.67;
const ROOT_DEPTH = 0;
const PROJECT_INDENT_STEP = 24;
const MAX_VISIBLE_DEPTH = 8;
const SPACES_PER_LEVEL = 2;

const taskNestingDepth = (indent: string): number => indentWidth(indent) / SPACES_PER_LEVEL;

const taskDropPlacement = (
	target: HTMLElement,
	event: DragEvent,
	indentStep = PROJECT_INDENT_STEP,
): ProjectTaskDropPlacement => {
	const rect = target.getBoundingClientRect();
	const relativeY = event.clientY - rect.top;
	if (relativeY <= rect.height * BEFORE_EDGE_RATIO) {
		return 'before';
	}
	if (relativeY >= rect.height * AFTER_EDGE_RATIO) {
		return 'after';
	}
	const nestOffset =
		NEST_TASK_OFFSET +
		Math.min(
			Number(target.style.getPropertyValue('--tavern-task-depth')) || ROOT_DEPTH,
			MAX_VISIBLE_DEPTH,
		) *
			indentStep;
	if (event.clientX - rect.left >= nestOffset) {
		return 'child';
	}
	return 'after';
};

export { taskDropPlacement, taskNestingDepth };
