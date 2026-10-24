import type { Menu } from 'obsidian';
import type { TaskDeleteMode } from './task-edit';

const addTaskDeleteItems = (
	menu: Menu,
	hasChildren: boolean,
	onDelete: (mode: TaskDeleteMode) => Promise<void>,
): void => {
	menu.addItem((item) => {
		item
			.setTitle('Delete item')
			.setIcon('trash')
			.onClick(() => void onDelete('task'));
	});
	if (hasChildren) {
		menu.addItem((item) => {
			item
				.setTitle('Delete tree')
				.setIcon('trash')
				.onClick(() => void onDelete('tree'));
		});
	}
};

export default addTaskDeleteItems;
