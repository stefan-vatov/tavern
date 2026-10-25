/* eslint-disable eslint/func-style, eslint/max-statements, eslint/no-magic-numbers, eslint/no-ternary */
// eslint-disable-next-line import/no-nodejs-modules
import { setTimeout as delay } from 'node:timers/promises';
import { describe, expect, it, vi } from 'vitest';
import { createTaskTextEditor } from '../src/task-text-editor';
import type { TaskEditPlan } from '../src/task-edit';

type TestEvent = Record<string, unknown> & {
	preventDefault: ReturnType<typeof vi.fn>;
	stopPropagation: ReturnType<typeof vi.fn>;
};

class EditorElement {
	children: EditorElement[] = [];
	parent: EditorElement | undefined;
	value = '';
	readOnly = false;
	text = '';
	classes = new Set<string>();
	attributes = new Map<string, string>();
	listeners = new Map<string, ((event: TestEvent) => void)[]>();
	styles = new Map<string, string>();
	style = {
		setProperty: (key: string, value: string) => this.styles.set(key, value),
		getPropertyValue: (key: string) => this.styles.get(key) ?? '',
	};

	constructor(
		readonly tag: string,
		readonly ownerDocument: { activeElement: EditorElement | null },
	) {}

	createEl(
		tag: string,
		options: { value?: string; cls?: string; attr?: Record<string, string> } = {},
	): EditorElement {
		const element = new EditorElement(tag, this.ownerDocument);
		element.value = options.value ?? '';
		element.addClass(options.cls ?? '');
		for (const [key, value] of Object.entries(options.attr ?? {})) {
			element.setAttribute(key, value);
		}
		this.append(element);
		return element;
	}

	append(element: EditorElement): void {
		element.parent = this;
		this.children.push(element);
	}

	empty(): void {
		this.children = [];
		this.text = '';
	}

	addClass(className: string): void {
		this.classes.add(className);
	}

	removeClass(className: string): void {
		this.classes.delete(className);
	}

	setAttribute(key: string, value: string): void {
		this.attributes.set(key, value);
	}

	addEventListener(type: string, listener: (event: TestEvent) => void): void {
		this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
	}

	removeEventListener(type: string, listener: (event: TestEvent) => void): void {
		this.listeners.set(
			type,
			(this.listeners.get(type) ?? []).filter((candidate) => candidate !== listener),
		);
	}

	dispatch(type: string, values: Record<string, unknown> = {}): TestEvent {
		const event = { preventDefault: vi.fn(), stopPropagation: vi.fn(), ...values };
		for (const listener of this.listeners.get(type) ?? []) {
			listener(event);
		}
		return event;
	}

	focus(): void {
		const previous = this.ownerDocument.activeElement;
		this.ownerDocument.activeElement = this;
		if (previous !== this) {
			previous?.dispatch('blur', { relatedTarget: this });
		}
	}

	contains(element: EditorElement | null): boolean {
		return this === element || this.children.some((child) => child.contains(element));
	}

	remove(): void {
		if (this.parent) {
			this.parent.children = this.parent.children.filter((child) => child !== this);
			this.parent = undefined;
		}
	}
}

const settleBlur = () => delay(0);

function fixture({
	isNew = false,
	isCapture = false,
	initialText = 'Original',
	hasExistingChildren = true,
	onCommit = vi.fn(async (_plan: TaskEditPlan) => {}),
} = {}) {
	const document = { activeElement: null as EditorElement | null };
	const list = new EditorElement('div', document);
	const row = list.createEl('div');
	const label = row.createEl('span');
	const savedChild = list.createEl('div');
	const following = list.createEl('div');
	const outside = new EditorElement('button', document);
	const editingChanges = vi.fn();
	const onCancel = vi.fn();
	const captureInput = isNew ? label.createEl('input') : undefined;
	const editor = createTaskTextEditor({
		containerEl: label as unknown as HTMLElement,
		rowEl: row as unknown as HTMLElement,
		text: isNew ? '' : initialText,
		isNew,
		isCapture,
		inputEl: captureInput as unknown as HTMLInputElement | undefined,
		getSubtreeEnd: () => (hasExistingChildren ? savedChild : row) as unknown as HTMLElement,
		renderText: (container, text) => {
			(container as unknown as EditorElement).text = text;
		},
		createDraftRow: (anchor, depth) => {
			const draftRow = new EditorElement('div', document);
			draftRow.style.setProperty('--tavern-task-depth', String(depth));
			draftRow.parent = list;
			list.children.splice(
				list.children.indexOf(anchor as unknown as EditorElement) + 1,
				0,
				draftRow,
			);
			return {
				rowEl: draftRow as unknown as HTMLElement,
				containerEl: draftRow.createEl('span') as unknown as HTMLElement,
			};
		},
		onCommit,
		onCancel,
		onEditingChange: editingChanges,
	});
	editor.open();
	const input = () => document.activeElement!;
	const key = (keyName: string, modifiers: Record<string, unknown> = {}) =>
		input().dispatch('keydown', { key: keyName, ...modifiers });
	return {
		document,
		list,
		row,
		label,
		savedChild,
		following,
		outside,
		editor,
		input,
		key,
		onCommit,
		onCancel,
		editingChanges,
	};
}

describe('inline task editing session', () => {
	it('keeps plain Enter inert and captures arbitrary sibling and nested chains until focus leaves', async () => {
		const session = fixture();
		const originalInput = session.input();
		originalInput.value = 'Parent';
		expect(session.key('Enter').preventDefault).toHaveBeenCalled();
		expect(session.input()).toBe(originalInput);
		expect(session.onCommit).not.toHaveBeenCalled();

		session.key('Enter', { shiftKey: true });
		const childInput = session.input();
		childInput.value = 'Child';
		session.key('Enter', { shiftKey: true });
		session.input().value = 'Grandchild';
		session.key('Enter', { ctrlKey: true });
		session.input().value = 'Next grandchild';
		originalInput.focus();
		session.key('Enter', { ctrlKey: true });
		session.input().value = 'Sibling';
		await settleBlur();
		expect(session.onCommit).not.toHaveBeenCalled();
		expect(session.list.children.indexOf(childInput.parent!.parent!)).toBeLessThan(
			session.list.children.indexOf(session.savedChild),
		);
		expect(session.list.children.indexOf(session.input().parent!.parent!)).toBeGreaterThan(
			session.list.children.indexOf(session.savedChild),
		);
		expect(session.list.children.indexOf(session.input().parent!.parent!)).toBeLessThan(
			session.list.children.indexOf(session.following),
		);

		session.outside.focus();
		await settleBlur();
		expect(session.onCommit).toHaveBeenCalledExactlyOnceWith({
			text: 'Parent',
			children: [
				{
					text: 'Child',
					children: [
						{ text: 'Grandchild', children: [] },
						{ text: 'Next grandchild', children: [] },
					],
				},
			],
			siblings: [{ text: 'Sibling', children: [] }],
		});
		expect(session.editingChanges.mock.calls).toEqual([[true], [false]]);
	});

	it('removes empty drafts on blur and promotes their children into the same visible level', async () => {
		const session = fixture();
		const originalInput = session.input();
		session.key('Enter', { shiftKey: true });
		const childInput = session.input();
		childInput.value = 'Temporary parent';
		const removedRow = childInput.parent!.parent!;
		session.key('Enter', { shiftKey: true });
		const grandchild = session.input();
		grandchild.value = 'Survivor';
		childInput.focus();
		childInput.value = '   ';
		originalInput.focus();
		await settleBlur();
		expect(session.list.children).not.toContain(removedRow);
		expect(grandchild.parent!.parent!.style.getPropertyValue('--tavern-task-depth')).toBe('1');
		await session.editor.commit();
		expect(session.onCommit).toHaveBeenCalledExactlyOnceWith({
			text: 'Original',
			children: [{ text: 'Survivor', children: [] }],
			siblings: [],
		});
	});

	it('commits an empty existing root for deletion and cancels all changes with Escape', async () => {
		const deleting = fixture();
		deleting.input().value = '';
		deleting.outside.focus();
		await settleBlur();
		expect(deleting.onCommit).toHaveBeenCalledExactlyOnceWith({
			text: '',
			children: [],
			siblings: [],
		});

		const cancelling = fixture();
		cancelling.input().value = 'Changed';
		cancelling.key('Enter', { ctrlKey: true });
		cancelling.input().value = 'Draft';
		cancelling.key('Escape');
		await settleBlur();
		expect(cancelling.onCommit).not.toHaveBeenCalled();
		expect(cancelling.onCancel).toHaveBeenCalledOnce();
		expect(cancelling.label.text).toBe('Original');
		expect(cancelling.list.children).toHaveLength(3);
	});

	it('removes an existing task that was already blank when editing began', async () => {
		const session = fixture({ initialText: '   ' });
		session.outside.focus();
		await settleBlur();
		expect(session.onCommit).toHaveBeenCalledExactlyOnceWith({
			text: '',
			children: [],
			siblings: [],
		});
		expect(session.editingChanges.mock.calls).toEqual([[true], [false]]);
	});

	it.each([{}, { shiftKey: true }, { ctrlKey: true }])(
		'submits capture on Enter with %o and retains the focused input for another task',
		async (modifiers) => {
			const session = fixture({ isNew: true, isCapture: true });
			const capture = session.input();
			capture.value = 'Captured';
			session.key('Enter', modifiers);
			await settleBlur();
			expect(session.onCommit).toHaveBeenCalledExactlyOnceWith({
				text: 'Captured',
				children: [],
				siblings: [],
			});
			expect(session.input()).toBe(capture);
			expect(capture.value).toBe('');
			expect(session.list.children).toHaveLength(3);
			capture.value = 'Another';
			session.key('Enter', modifiers);
			await settleBlur();
			expect(session.onCommit).toHaveBeenCalledTimes(2);
			expect(session.onCommit).toHaveBeenLastCalledWith({
				text: 'Another',
				children: [],
				siblings: [],
			});
		},
	);

	it('keeps an empty capture visible through Enter, blur and composition without saving', async () => {
		const session = fixture({ isNew: true, isCapture: true });
		const capture = session.input();
		expect(
			session.key('Enter', { isComposing: true, shiftKey: true }).preventDefault,
		).not.toHaveBeenCalled();
		expect(
			session.key('Enter', { keyCode: 229, ctrlKey: true }).preventDefault,
		).not.toHaveBeenCalled();
		expect(session.input()).toBe(capture);
		for (const modifiers of [{}, { shiftKey: true }, { ctrlKey: true }]) {
			session.key('Enter', modifiers);
		}
		session.outside.focus();
		await settleBlur();
		expect(session.onCommit).not.toHaveBeenCalled();
		expect(session.row.style.getPropertyValue('display')).toBe('');
		expect(session.label.children).toContain(capture);
		expect(session.list.children).toHaveLength(3);
		capture.focus();
		capture.value = 'Composition';
		session.key('Enter', { isComposing: true });
		expect(session.onCommit).not.toHaveBeenCalled();
	});

	it('serializes capture submissions and preserves failed text for a focused retry', async () => {
		let rejectSave: (error: Error) => void = () => {};
		const onCommit = vi.fn(
			(_plan: TaskEditPlan) =>
				// eslint-disable-next-line promise/avoid-new
				new Promise<void>((_resolve, reject) => {
					rejectSave = reject;
				}),
		);
		const session = fixture({ isNew: true, isCapture: true, onCommit });
		const capture = session.input();
		capture.value = 'Keep this';
		session.key('Enter');
		session.key('Enter', { ctrlKey: true });
		session.key('Enter', { shiftKey: true });
		expect(onCommit).toHaveBeenCalledOnce();
		expect(capture.readOnly).toBe(true);
		rejectSave(new Error('Vault unavailable'));
		await settleBlur();
		expect(capture.value).toBe('Keep this');
		expect(capture.readOnly).toBe(false);
		expect(session.input()).toBe(capture);
		onCommit.mockResolvedValueOnce();
		session.key('Enter');
		await settleBlur();
		expect(onCommit).toHaveBeenCalledTimes(2);
		expect(capture.value).toBe('');
		expect(session.input()).toBe(capture);
	});

	it.each(['blur', 'dispose'])(
		'does not reclaim focus when a capture save finishes after %s',
		async (action) => {
			let resolveSave = () => {};
			const onCommit = vi.fn(
				(_plan: TaskEditPlan) =>
					// eslint-disable-next-line promise/avoid-new
					new Promise<void>((resolve) => {
						resolveSave = resolve;
					}),
			);
			const session = fixture({ isNew: true, isCapture: true, onCommit });
			const capture = session.input();
			capture.value = 'Saved while leaving';
			session.key('Enter');
			if (action === 'dispose') {
				session.editor.dispose();
			}
			session.outside.focus();
			resolveSave();
			await settleBlur();
			expect(session.input()).toBe(session.outside);
			expect(onCommit).toHaveBeenCalledOnce();
			if (action === 'blur') {
				capture.focus();
				capture.value = 'Next task';
				onCommit.mockResolvedValueOnce();
				session.key('Enter');
				await settleBlur();
				expect(onCommit).toHaveBeenCalledTimes(2);
			}
		},
	);

	it('retains the complete draft tree after a failed write and retries the same work', async () => {
		const onCommit = vi.fn(async (_plan: TaskEditPlan) => {});
		onCommit.mockRejectedValueOnce(new Error('Vault unavailable'));
		const session = fixture({ onCommit });
		session.input().value = 'Edited parent';
		session.key('Enter', { shiftKey: true });
		session.input().value = 'Draft child';
		await expect(session.editor.commit()).rejects.toThrow('Vault unavailable');
		expect(session.input().value).toBe('Draft child');
		expect(session.editingChanges.mock.calls).toEqual([[true]]);
		await session.editor.commit();
		expect(onCommit).toHaveBeenLastCalledWith({
			text: 'Edited parent',
			children: [{ text: 'Draft child', children: [] }],
			siblings: [],
		});
		expect(onCommit).toHaveBeenCalledTimes(2);
	});
	it('places a new root sibling after the draft descendants when the original has no children', async () => {
		const session = fixture({ hasExistingChildren: false });
		const original = session.input();
		session.key('Enter', { shiftKey: true });
		const child = session.input();
		child.value = 'Child';
		original.focus();
		session.key('Enter', { ctrlKey: true });
		session.input().value = 'Sibling';
		expect(session.list.children.indexOf(child.parent!.parent!)).toBeLessThan(
			session.list.children.indexOf(session.input().parent!.parent!),
		);
		await session.editor.commit();
	});

	it('makes a blank existing row visible again when deleting it fails', async () => {
		const onCommit = vi.fn(async (_plan: TaskEditPlan) => {
			throw new Error('Read only');
		});
		const session = fixture({ onCommit });
		const input = session.input();
		input.value = '';
		session.outside.focus();
		await settleBlur();
		expect(session.row.style.getPropertyValue('display')).toBe('');
		expect(session.label.children).toContain(input);
		expect(session.editingChanges.mock.calls).toEqual([[true]]);
	});
});
