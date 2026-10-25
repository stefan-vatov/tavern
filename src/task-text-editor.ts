/* eslint-disable eslint/func-style, eslint/max-statements, eslint/no-magic-numbers, eslint/no-ternary */
import type { TaskEditPlan, TaskEditTree } from './task-edit';

interface TaskEditorRow {
	rowEl: HTMLElement;
	containerEl: HTMLElement;
}

interface TaskTextEditorOptions extends TaskEditorRow {
	text: string;
	depth?: number;
	subtreeEnd?: HTMLElement;
	getSubtreeEnd?(): HTMLElement;
	inputEl?: HTMLInputElement;
	isNew?: boolean;
	isCapture?: boolean;
	startEditing?: boolean;
	renderText(containerEl: HTMLElement, text: string): void;
	createDraftRow(afterRow: HTMLElement, depth: number): TaskEditorRow;
	onCommit(plan: TaskEditPlan): Promise<void>;
	onEditingChange?(editing: boolean): void;
	onCancel?(): void;
}

interface DraftTask extends TaskEditorRow {
	input: HTMLInputElement;
	parent: DraftTask | undefined;
	children: DraftTask[];
	depth: number;
}

export interface TaskTextEditor {
	open(): void;
	commit(): Promise<void>;
	handleKeydown(event: KeyboardEvent): boolean;
	dispose(): void;
}

export function createTaskTextEditor(options: TaskTextEditorOptions): TaskTextEditor {
	const listeners: (() => void)[] = [];
	let sessionListeners: (() => void)[] = [];
	let root: DraftTask | undefined = undefined;
	let siblings: DraftTask[] = [];
	let saving: Promise<void> | undefined = undefined;
	let disposed = false;
	let editing = false;
	let originalDisplay = '';
	let subtreeEnd: HTMLElement | undefined = undefined;

	const listen = <EventType extends keyof HTMLElementEventMap>(
		element: HTMLElement,
		type: EventType,
		listener: (event: HTMLElementEventMap[EventType]) => void,
	) => {
		element.addEventListener(type, listener);
		sessionListeners.push(() => element.removeEventListener(type, listener));
	};

	const allTasks = (): DraftTask[] => {
		const visit = (task: DraftTask): DraftTask[] => [task, ...task.children.flatMap(visit)];
		return root ? [...visit(root), ...siblings.flatMap(visit)] : [];
	};

	const renderLabel = () => {
		if (options.inputEl) {
			return;
		}
		options.containerEl.empty();
		options.containerEl.removeClass('is-editing');
		options.renderText(options.containerEl, options.text || 'Untitled task');
	};

	const setEditing = (value: boolean) => {
		if (editing !== value) {
			editing = value;
			options.onEditingChange?.(value);
		}
	};

	const finish = (cancelled: boolean) => {
		for (const task of allTasks()) {
			if (task !== root) {
				task.rowEl.remove();
			}
		}
		for (const cleanup of sessionListeners) {
			cleanup();
		}
		sessionListeners = [];
		root = undefined;
		siblings = [];
		options.rowEl.style.setProperty('display', originalDisplay);
		renderLabel();
		if (options.inputEl) {
			options.inputEl.value = '';
		}
		if (cancelled) {
			options.onCancel?.();
		}
		setEditing(false);
	};

	const trees = (tasks: DraftTask[]): TaskEditTree[] =>
		tasks.flatMap((task) => {
			const children = trees(task.children);
			const text = task.input.value.trim();
			return text ? [{ text, children }] : children;
		});

	const commit = (): Promise<void> => {
		if (saving) {
			return saving;
		}
		if (!root || disposed) {
			return Promise.resolve();
		}
		const plan: TaskEditPlan = {
			text: root.input.value.trim(),
			children: trees(root.children),
			siblings: trees(siblings),
		};
		const hasAdditions = plan.children.length > 0 || plan.siblings.length > 0;
		if (
			!hasAdditions &&
			((options.isNew && !plan.text) ||
				(!options.isNew && Boolean(plan.text) && plan.text === options.text.trim()))
		) {
			if (options.isCapture) {
				root.input.value = '';
				setEditing(false);
			} else {
				finish(false);
			}
			return Promise.resolve();
		}
		setEditing(true);
		const pendingInputs = allTasks().map(({ input }) => ({
			input,
			disabled: input.disabled,
			readOnly: input.readOnly,
		}));
		for (const { input } of pendingInputs) {
			if (options.isCapture) {
				input.readOnly = true;
			} else {
				input.disabled = true;
			}
		}
		saving = (async () => {
			try {
				await options.onCommit(plan);
				if (!disposed) {
					if (options.isCapture) {
						root.input.value = '';
						setEditing(false);
					} else {
						finish(false);
					}
				}
			} catch (error) {
				options.rowEl.style.setProperty('display', originalDisplay);
				throw error;
			} finally {
				for (const { input, disabled, readOnly } of pendingInputs) {
					input.disabled = disabled;
					input.readOnly = readOnly;
				}
				saving = undefined;
			}
		})();
		return saving;
	};

	const updateDepth = (task: DraftTask, depth: number) => {
		task.depth = depth;
		task.rowEl.style.setProperty('--tavern-task-depth', String(depth));
		if (depth > 0) {
			task.rowEl.addClass('is-nested');
		} else {
			task.rowEl.removeClass('is-nested');
		}
		for (const child of task.children) {
			updateDepth(child, depth + 1);
		}
	};

	const removeEmpty = (task: DraftTask) => {
		if (task.input.value.trim()) {
			return;
		}
		if (task === root) {
			if (!options.isCapture) {
				options.rowEl.style.setProperty('display', 'none');
			}
			return;
		}
		const group = task.parent ? task.parent.children : siblings;
		const index = group.indexOf(task);
		if (index < 0) {
			return;
		}
		for (const child of task.children) {
			child.parent = task.parent;
			updateDepth(child, task.depth);
		}
		group.splice(index, 1, ...task.children);
		task.children = [];
		task.rowEl.remove();
	};

	const lastRow = (task: DraftTask): HTMLElement => {
		if (task === root && subtreeEnd && subtreeEnd !== task.rowEl) {
			return subtreeEnd;
		}
		const lastChild = task.children[task.children.length - 1];
		return lastChild ? lastRow(lastChild) : task.rowEl;
	};

	const submitCapture = async () => {
		try {
			await commit();
		} catch {
			// Keep the capture available after the caller reports the write failure.
		}
	};

	const handleKeydown = (event: KeyboardEvent): boolean => {
		const task = allTasks().find(
			(candidate) => candidate.input === candidate.input.ownerDocument.activeElement,
		);
		if (!task || (event.key !== 'Enter' && event.key !== 'Escape')) {
			return false;
		}
		event.stopPropagation();
		if (event.isComposing || event.keyCode === 229) {
			return false;
		}
		if (saving) {
			event.preventDefault();
			return true;
		}
		if (event.key === 'Escape') {
			event.preventDefault();
			finish(true);
			if (options.inputEl) {
				open();
			} else {
				options.containerEl.focus();
			}
			return true;
		}
		event.preventDefault();
		if (options.isCapture) {
			void submitCapture();
		} else if (event.ctrlKey || event.shiftKey) {
			addTask(task, Boolean(event.shiftKey && !event.ctrlKey));
		}
		return true;
	};

	const bindInput = (task: DraftTask) => {
		listen(task.input, 'click', (event) => event.stopPropagation());
		listen(task.input, 'input', () => {
			if (options.isCapture) {
				setEditing(Boolean(task.input.value.trim()));
			}
			if (task === root && task.input.value.trim()) {
				options.rowEl.style.setProperty('display', originalDisplay);
			}
		});
		listen(task.input, 'keydown', (event) => {
			event.stopPropagation();
			handleKeydown(event);
		});
		listen(task.input, 'blur', (event) => {
			const destination = event.relatedTarget;
			queueMicrotask(async () => {
				if (!root || disposed || saving || !allTasks().includes(task)) {
					return;
				}
				const active = task.input.ownerDocument.activeElement;
				const inside = allTasks().some(
					(candidate) =>
						candidate.containerEl.contains(destination as Node | null) ||
						candidate.containerEl.contains(active),
				);
				removeEmpty(task);
				if (!inside) {
					try {
						await commit();
					} catch {
						// Keep the session available after the caller reports the write failure.
					}
				}
			});
		});
	};

	const addTask = (task: DraftTask, child: boolean) => {
		const parent = child ? task : task.parent;
		const depth = child ? task.depth + 1 : task.depth;
		const row = options.createDraftRow(child ? task.rowEl : lastRow(task), depth);
		const input = row.containerEl.createEl('input', {
			attr: { 'aria-label': 'Task text for new task' },
			cls: 'tavern-task-edit-input',
			type: 'text',
		});
		row.containerEl.addClass('is-editing');
		const next: DraftTask = { ...row, input, parent, depth, children: [] };
		const group = parent ? parent.children : siblings;
		const index = child || task === root ? 0 : group.indexOf(task) + 1;
		group.splice(index, 0, next);
		updateDepth(next, depth);
		bindInput(next);
		input.focus();
	};

	const open = () => {
		if (root || disposed) {
			return;
		}
		originalDisplay = options.rowEl.style.getPropertyValue('display');
		subtreeEnd = options.getSubtreeEnd?.() ?? options.subtreeEnd;
		if (!options.inputEl) {
			options.containerEl.empty();
			options.containerEl.addClass('is-editing');
		}
		const input =
			options.inputEl ??
			options.containerEl.createEl('input', {
				attr: { 'aria-label': `Task text for ${options.text || 'Untitled task'}` },
				cls: 'tavern-task-edit-input',
				type: 'text',
				value: options.text,
			});
		root = { ...options, input, parent: undefined, depth: options.depth ?? 0, children: [] };
		bindInput(root);
		if (!options.isCapture || input.value.trim()) {
			setEditing(true);
		}
		input.focus();
	};

	if (!options.inputEl) {
		options.containerEl.setAttribute('aria-label', `Edit ${options.text || 'Untitled task'}`);
		options.containerEl.setAttribute('title', 'Click to edit task');
		options.containerEl.setAttribute('tabindex', '0');
		options.containerEl.addClass('tavern-editable-task-text');
		renderLabel();
		listen(options.containerEl, 'click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			open();
		});
		listen(options.containerEl, 'keydown', (event) => {
			if (event.key === 'Enter' && !root) {
				event.preventDefault();
				event.stopPropagation();
				open();
			}
		});
	}
	listeners.push(...sessionListeners);
	sessionListeners = [];
	if (options.startEditing) {
		open();
	}

	return {
		open,
		commit,
		handleKeydown,
		dispose: () => {
			disposed = true;
			if (root) {
				finish(true);
			}
			for (const cleanup of listeners) {
				cleanup();
			}
		},
	};
}
