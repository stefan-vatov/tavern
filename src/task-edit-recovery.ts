import { Modal, type App } from 'obsidian';
import type { TaskEditPlan, TaskEditTree } from './task-edit';

const draftLines = (tasks: TaskEditTree[], indent = ''): string[] =>
	tasks.flatMap((task) => {
		if (!task.text.trim()) {
			return draftLines(task.children, indent);
		}
		return [`${indent}- [ ] ${task.text}`, ...draftLines(task.children, `${indent}  `)];
	});

const showTaskEditRecovery = (app: App, plan: TaskEditPlan): void => {
	const modal = new Modal(app);
	modal.titleEl.setText('Task edits could not be saved');
	modal.contentEl.createEl('p', {
		text: 'Tavern closed before these edits could be saved. Copy this draft before closing this message.',
	});
	const text = modal.contentEl.createEl('textarea', {
		cls: 'tavern-task-recovery-text',
		attr: { 'aria-label': 'Unsaved task edits', rows: '10', readonly: '' },
	});
	text.value = draftLines([{ text: plan.text, children: plan.children }, ...plan.siblings]).join(
		'\n',
	);
	modal.open();
	text.focus();
	text.select();
};

export default showTaskEditRecovery;
