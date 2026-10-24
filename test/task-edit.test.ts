/* eslint-disable eslint/no-magic-numbers, eslint/max-statements, eslint/no-ternary */
import { Effect } from 'effect';
import {
	addProjectTaskPlan,
	deleteProjectTaskPlan,
	editProjectTaskPlan,
	projectTaskHasChildren,
} from '../src/project-actions';
import { parseProjectNote } from '../src/project-note';
import {
	deleteVaultProjectTaskPlan,
	editVaultProjectTaskPlan,
	type ProjectVault,
} from '../src/project-vault';
import {
	applyTaskDelete,
	applyTaskEdit,
	taskHasChildren,
	type TaskEditPlan,
} from '../src/task-edit';

const emptyPlan = (text: string): TaskEditPlan => ({ text, children: [], siblings: [] });

describe('task edit plans', () => {
	it('inserts draft trees before existing children and after the entire original subtree', () => {
		const markdown =
			'- [X]\tParent ^parent\n  Supporting text.\n  - [ ] Existing ^child\n    - [x] Grandchild\n- [ ] Next\n';
		const result = applyTaskEdit(markdown, 0, {
			text: 'Renamed',
			children: [{ text: 'New child', children: [{ text: 'New grandchild', children: [] }] }],
			siblings: [{ text: 'New sibling', children: [{ text: 'Sibling child', children: [] }] }],
		});
		expect(result.markdown).toBe(
			'- [X]\tRenamed ^parent\n  - [ ] New child\n    - [ ] New grandchild\n  Supporting text.\n  - [ ] Existing ^child\n    - [x] Grandchild\n- [ ] New sibling\n  - [ ] Sibling child\n- [ ] Next\n',
		);
		expect([...result.lineMapping]).toEqual([
			[0, 0],
			[1, 3],
			[2, 4],
			[3, 5],
			[4, 8],
		]);
	});

	it('removes only a blank original row and promotes content, checked descendants and blank draft children', () => {
		const markdown =
			'- [ ] Outer\n  - [ ] Remove ^parent\n    Supporting text.\n    - [x] Keep ^child\n      - [ ] Grandchild\n  - [ ] Next\n';
		const result = applyTaskEdit(markdown, 1, {
			text: '  ',
			children: [{ text: '', children: [{ text: 'Promoted draft', children: [] }] }],
			siblings: [{ text: '', children: [{ text: 'Sibling', children: [] }] }],
		});
		expect(result.markdown).toBe(
			'- [ ] Outer\n  - [ ] Promoted draft\n  Supporting text.\n  - [x] Keep ^child\n    - [ ] Grandchild\n  - [ ] Sibling\n  - [ ] Next\n',
		);
		expect([...result.lineMapping]).toEqual([
			[0, 0],
			[2, 2],
			[3, 3],
			[4, 4],
			[5, 6],
		]);
	});

	it('uses the actual child task level when prose has shallower indentation', () => {
		const result = applyTaskEdit(
			'- [ ] Parent\n Prose.\n  - [ ] Child\n    - [ ] Grandchild\n- [ ] Next\n',
			0,
			emptyPlan(''),
		);
		expect(result.markdown).toBe('Prose.\n- [ ] Child\n  - [ ] Grandchild\n- [ ] Next\n');
	});

	it.each([
		{ parent: '  ', child: '\t', grandchild: '\t  ', promoted: '  ', nested: '    ' },
		{ parent: '\t', child: '      ', grandchild: '        ', promoted: '\t', nested: '\t  ' },
	])(
		'promotes mixed indentation beneath a parent indented with $parent',
		({ parent, child, grandchild, promoted, nested }) => {
			const result = applyTaskEdit(
				`- [ ] Outer\n${parent}- [ ] Remove\n${child}- [x] Child ^child\n\n${grandchild}- [ ] Grandchild\n${parent}- [ ] Peer\n`,
				1,
				emptyPlan(''),
			);
			expect(result.markdown).toBe(
				`- [ ] Outer\n${promoted}- [x] Child ^child\n\n${nested}- [ ] Grandchild\n${parent}- [ ] Peer\n`,
			);
		},
	);

	it('preserves prose-only nested content when removing a task and can remove the sole task entirely', () => {
		expect(
			applyTaskEdit(
				'- [ ] Remove\n\tContinuation.\n\t\tIndented detail.\n\nAfter.',
				0,
				emptyPlan(''),
			).markdown,
		).toBe('Continuation.\n\tIndented detail.\n\nAfter.');
		expect(applyTaskEdit('- [ ] Remove', 0, emptyPlan('')).markdown).toBe('');
	});

	it.each(['\r\n', '\n', '\r'])(
		'preserves metadata, prose, fences and final newline style using %j',
		(ending) => {
			const lines = [
				'---',
				'title: Example',
				'---',
				'Prose.',
				'```md',
				'- [ ] Example',
				'```',
				'### Plan',
				'* [x] Keep ^keep',
				'',
				'### Notes',
				'After.',
			];
			const markdown = lines.join(ending);
			const result = applyTaskEdit(markdown, 8, emptyPlan('Edited'));
			expect(result.markdown).toBe(
				lines.map((line, index) => (index === 8 ? '* [x] Edited ^keep' : line)).join(ending),
			);
			expect([...result.lineMapping]).toEqual(lines.map((_line, index) => [index, index]));
			expect(() => applyTaskEdit(markdown, 5, emptyPlan('Unsafe'))).toThrow('Task was not found');
		},
	);

	it('adds siblings after an unterminated last line without introducing a trailing newline', () => {
		expect(
			applyTaskEdit('- [ ] Last', 0, {
				text: 'Last',
				children: [],
				siblings: [{ text: 'New', children: [] }],
			}).markdown,
		).toBe('- [ ] Last\n- [ ] New');
	});

	it('rejects missing targets and multiline text anywhere in a draft', () => {
		expect(() => applyTaskEdit('- [ ] Keep\n', 2, emptyPlan('Changed'))).toThrow(
			'Task was not found',
		);
		expect(() =>
			applyTaskEdit('- [ ] Keep\n', 0, {
				text: 'Keep',
				children: [],
				siblings: [{ text: 'Invalid\nheading', children: [] }],
			}),
		).toThrow('single line');
	});
});

describe('task deletion', () => {
	it.each([
		{ tail: '  Prose.\n\t- [ ] Child\n', expected: true },
		{ tail: 'Unindented prose.\n  - [ ] Outside\n', expected: false },
		{ tail: '  ### Notes\n  - [ ] Outside\n', expected: false },
		{ tail: '# New section\n  - [ ] Outside\n', expected: false },
		{ tail: '- [ ] Sibling\n  - [ ] Outside\n', expected: false },
		{ tail: '  ```md\n  - [ ] Example\n  ```\n', expected: false },
	])('offers tree deletion only for real descendants before $tail', ({ tail, expected }) => {
		const markdown = `- [ ] Parent\n${tail}`;
		expect(taskHasChildren(markdown, 0)).toBe(expected);
	});

	it.each(['`', '~'])(
		'keeps a nested %s fence whole during item or tree deletion and preserves neighboring fences',
		(marker) => {
			const opening = marker.repeat(4);
			const shorter = marker.repeat(3);
			const other = marker === '`' ? '~~~~' : '````';
			const closing = marker.repeat(5);
			const prefix = '~~~text\nBefore.\n~~~\n';
			const suffix = '- [ ] Neighbor\n```text\nAfter.\n```\n';
			const source = `${prefix}- [ ] Parent\n  ${opening}md\n  # Literal heading\nUnindented literal.\n  ${shorter}\n  ${other}\n  ${opening} not a close\n\n  ${closing}\n  - [x] Child ^child\n${suffix}`;
			expect(taskHasChildren(source, 3)).toBe(true);
			expect(applyTaskDelete(source, 3, 'tree').markdown).toBe(`${prefix}${suffix}`);
			expect(applyTaskDelete(source, 3, 'task').markdown).toBe(
				`${prefix}${opening}md\n# Literal heading\nUnindented literal.\n${shorter}\n${other}\n${opening} not a close\n\n${closing}\n- [x] Child ^child\n${suffix}`,
			);
		},
	);

	it('does not offer tree deletion for a missing task', () => {
		expect(taskHasChildren('- [ ] Parent\n  - [ ] Child\n', 5)).toBe(false);
	});

	it.each(['task', 'tree'] as const)(
		'deletes a %s while preserving mixed-indentation prose boundaries, CRLF and EOF style',
		(mode) => {
			const before = [
				'---',
				'title: Private',
				'---',
				'### Plan',
				'- [ ] Outer',
				'  - [ ] Remove ^parent',
				'\tSupporting prose.',
				'\t- [x] Child ^child',
				'',
				'\t  - [ ] Grandchild',
				'  - [ ] Peer',
				'   ### Notes',
				'  Indented narrative.',
				'- [ ] Later',
			];
			for (const finalEnding of ['', '\r\n']) {
				const result = applyTaskDelete(before.join('\r\n') + finalEnding, 5, mode);
				const preserved =
					mode === 'task'
						? ['  Supporting prose.', '  - [x] Child ^child', '', '    - [ ] Grandchild']
						: [];
				expect(result.markdown).toBe(
					[...before.slice(0, 5), ...preserved, ...before.slice(10)].join('\r\n') + finalEnding,
				);
				expect([...result.lineMapping]).toEqual(
					before.flatMap((_line, index) => {
						if (index === 5 || (mode === 'tree' && index > 5 && index < 10)) {
							return [];
						}
						const removedCount = mode === 'tree' ? 5 : 1;
						const shift = index > 5 ? removedCount : 0;
						return [[index, index - shift]];
					}),
				);
			}
		},
	);

	it.each(['task', 'tree'] as const)(
		'keeps an indented section heading outside a %s deletion and rejects non-task targets',
		(mode) => {
			const source = '- [ ] Remove\n  Detail.\n  ### Notes\n  - [ ] Independent\n';
			expect(applyTaskDelete(source, 0, mode).markdown).toBe(
				`${mode === 'task' ? 'Detail.\n' : ''}  ### Notes\n  - [ ] Independent\n`,
			);
			expect(() => applyTaskDelete(source, 2, mode)).toThrow('Task was not found');
			expect(() => applyTaskDelete(source, 99, mode)).toThrow('Task was not found');
			expect(applyTaskDelete('- [ ] Only', 0, mode).markdown).toBe('');
		},
	);

	it.each(['', '\n'])(
		'deletes a tail tree without changing the original final ending %j',
		(finalEnding) => {
			expect(
				applyTaskDelete(
					`### Plan\n- [ ] Keep\n- [ ] Remove\n  - [ ] Child${finalEnding}`,
					2,
					'tree',
				).markdown,
			).toBe(`### Plan\n- [ ] Keep${finalEnding}`);
		},
	);
});

describe('project task plan persistence', () => {
	const markdown =
		'---\ntavern: project\n---\n# Project\n## Plan\n- [ ] Parent\n  - [ ] Child\n- [ ] Next\n## Notes & Decisions\nText.\n';

	it('checks descendants at their absolute project position across metadata, preamble and earlier sections', async () => {
		const note = await Effect.runPromise(
			parseProjectNote(`${markdown}## Later\n- [ ] Later parent\n  - [ ] Later child\n`),
		);
		const tasks = note.sections.flatMap((section) => section.tasks);
		const parent = tasks.find((task) => task.text === 'Later parent')!;
		const child = tasks.find((task) => task.text === 'Later child')!;
		expect(projectTaskHasChildren(note, parent.id)).toBe(true);
		expect(projectTaskHasChildren(note, child.id)).toBe(false);
		expect(projectTaskHasChildren(note, 'stale')).toBe(false);
	});

	it('maps every surviving project reference through text edits, additions and parent removal', async () => {
		const before = await Effect.runPromise(parseProjectNote(markdown));
		const [parent, child, next] = before.sections[0]!.tasks;
		const result = await Effect.runPromise(
			editProjectTaskPlan(markdown, parent!.id, {
				text: '',
				children: [{ text: 'New', children: [] }],
				siblings: [],
			}),
		);
		const after = await Effect.runPromise(parseProjectNote(result.markdown));
		expect(result.mapping.get(parent!.id)).toBe('');
		expect(result.mapping.get(child!.id)).toBe(after.sections[0]!.tasks[1]!.id);
		expect(result.mapping.get(next!.id)).toBe(after.sections[0]!.tasks[2]!.id);
		expect(result.markdown).toContain('- [ ] New\n- [ ] Child\n- [ ] Next');
	});

	it.each(['task', 'tree'] as const)(
		'maps removed and surviving references across a %s deletion, including later sections',
		async (mode) => {
			const source = `${markdown}## Later\n- [ ] Future\n`;
			const before = await Effect.runPromise(parseProjectNote(source));
			const tasks = before.sections.flatMap((section) => section.tasks);
			const result = await Effect.runPromise(deleteProjectTaskPlan(source, tasks[0]!.id, mode));
			const expected =
				mode === 'task'
					? source.replace('- [ ] Parent\n  - [ ] Child', '- [ ] Child')
					: source.replace('- [ ] Parent\n  - [ ] Child\n', '');
			expect(result.markdown).toBe(expected);
			const surviving = (await Effect.runPromise(parseProjectNote(expected))).sections.flatMap(
				(section) => section.tasks,
			);
			expect([...result.mapping]).toEqual(
				tasks.map((task) => [
					task.id,
					surviving.find((candidate) => candidate.text === task.text)?.id ?? '',
				]),
			);
		},
	);

	it.each(['task', 'tree'] as const)(
		'rejects a stale %s deletion before a write and persists the valid deletion mapping',
		async (mode) => {
			let current = markdown;
			const modify = vi.fn(async (_file, next: string) => {
				current = next;
			});
			const vault: ProjectVault = {
				getMarkdownFiles: () => [{ path: 'Project.md' }],
				read: async () => current,
				modify,
			};
			const note = await Effect.runPromise(parseProjectNote(markdown));
			const task = {
				...note.sections[0]!.tasks[0]!,
				projectPath: 'Project.md',
				projectTitle: 'Project',
			};
			await expect(
				Effect.runPromise(deleteVaultProjectTaskPlan(vault, { ...task, id: 'stale' }, mode)),
			).rejects.toThrow('Task was not found');
			expect(modify).not.toHaveBeenCalled();
			const result = await Effect.runPromise(deleteVaultProjectTaskPlan(vault, task, mode));
			expect(modify).toHaveBeenCalledTimes(1);
			expect(current).not.toContain('Parent');
			expect(current.includes('Child')).toBe(mode === 'task');
			const after = await Effect.runPromise(parseProjectNote(current));
			expect(result.get(task.id)).toBe('');
			expect(result.get(note.sections[0]!.tasks[2]!.id)).toBe(after.sections[0]!.tasks.at(-1)!.id);
		},
	);

	it('captures a draft with a blank root in one plan without persisting the temporary anchor', async () => {
		const result = await Effect.runPromise(
			addProjectTaskPlan(markdown, 'Plan', {
				text: '',
				children: [{ text: 'Captured', children: [{ text: 'Nested', children: [] }] }],
				siblings: [{ text: 'Later', children: [] }],
			}),
		);
		expect(result.markdown).toContain('- [ ] Next\n- [ ] Captured\n  - [ ] Nested\n- [ ] Later');
		expect(result.markdown).not.toContain('Draft');
		expect([...result.mapping].every(([oldId, newId]) => oldId === newId)).toBe(true);
	});

	it('ignores a capture containing only whitespace at every draft level', async () => {
		const result = await Effect.runPromise(
			addProjectTaskPlan(markdown, 'New section', {
				text: ' ',
				children: [{ text: '', children: [{ text: '\t', children: [] }] }],
				siblings: [{ text: '  ', children: [] }],
			}),
		);
		expect(result.markdown).toBe(markdown);
		const note = await Effect.runPromise(parseProjectNote(markdown));
		expect([...result.mapping]).toEqual(
			note.sections.flatMap((section) => section.tasks.map((task) => [task.id, task.id])),
		);
	});

	it('rejects an ambiguous block identity before a vault write', async () => {
		const source = markdown
			.replace('Parent', 'Parent ^duplicate')
			.replace('Next', 'Next ^duplicate');
		const modify = vi.fn(async () => {});
		const vault: ProjectVault = {
			getMarkdownFiles: () => [{ path: 'Project.md' }],
			read: async () => source,
			modify,
		};
		const note = await Effect.runPromise(parseProjectNote(source));
		const task = {
			...note.sections[0]!.tasks[0]!,
			projectPath: 'Project.md',
			projectTitle: 'Project',
		};
		await expect(
			Effect.runPromise(editVaultProjectTaskPlan(vault, task, emptyPlan('Changed'))),
		).rejects.toThrow('ambiguous');
		expect(modify).not.toHaveBeenCalled();
	});

	it.each(['', '\r\n'])(
		'captures into an existing or new section preserving CRLF and final ending %j',
		async (finalEnding) => {
			const before =
				[
					'---',
					'tavern: project',
					'---',
					'# Project',
					'## Plan',
					'*Prose.*',
					'- [ ] Existing',
					'',
					'## Notes & Decisions',
					'Narrative.',
				].join('\r\n') + finalEnding;
			for (const section of ['Plan', 'New section']) {
				const result = await Effect.runPromise(
					addProjectTaskPlan(before, section, {
						text: 'Captured',
						children: [{ text: 'Nested', children: [] }],
						siblings: [],
					}),
				);
				expect(result.markdown).toContain('- [ ] Captured\r\n  - [ ] Nested\r\n');
				expect(result.markdown).toContain('## Plan\r\n*Prose.*\r\n- [ ] Existing\r\n');
				expect(result.markdown).toContain(`## Notes & Decisions\r\nNarrative.${finalEnding}`);
				expect(result.markdown.endsWith('\r\n')).toBe(Boolean(finalEnding));
				expect(result.markdown.replace(/\r\n/g, '')).not.toContain('\n');
			}
		},
	);

	it.each([
		{
			name: 'the first matching section before populated later and duplicate sections',
			section: 'Backlog',
			before:
				'---\ntavern: project\n---\n# Project\nIntro.\n## Backlog\n- [ ] Existing first\n  - [x] Nested ^nested\n\n## Next\n- [ ] Next work\n## Backlog\n- [ ] Later duplicate heading\n## Notes & Decisions\n- [ ] Decision task\n',
			expected:
				'---\ntavern: project\n---\n# Project\nIntro.\n## Backlog\n- [ ] Existing first\n  - [x] Nested ^nested\n- [ ] Captured\n  - [ ] Captured child\n- [ ] Captured sibling\n\n## Next\n- [ ] Next work\n## Backlog\n- [ ] Later duplicate heading\n## Notes & Decisions\n- [ ] Decision task\n',
		},
		{
			name: 'a new section immediately before populated Notes & Decisions',
			section: 'Inbox',
			before:
				'---\ntavern: project\n---\n# Project\n## Backlog\n- [ ] Backlog work\n## Next\n- [ ] Next work\n## Notes & Decisions\n- [ ] Decision task\n## Someday\n- [ ] Future work\n',
			expected:
				'---\ntavern: project\n---\n# Project\n## Backlog\n- [ ] Backlog work\n## Next\n- [ ] Next work\n## Inbox\n\n- [ ] Captured\n  - [ ] Captured child\n- [ ] Captured sibling\n\n## Notes & Decisions\n- [ ] Decision task\n## Someday\n- [ ] Future work\n',
		},
		{
			name: 'an empty section while retaining its whitespace-only lines',
			section: 'Waiting',
			before:
				'---\ntavern: project\n---\n# Project\n## Waiting\n \t \n\n## Next\n- [ ] Next work\n## Notes & Decisions\n- [ ] Decision task\n',
			expected:
				'---\ntavern: project\n---\n# Project\n## Waiting\n- [ ] Captured\n  - [ ] Captured child\n- [ ] Captured sibling\n \t \n\n## Next\n- [ ] Next work\n## Notes & Decisions\n- [ ] Decision task\n',
		},
		{
			name: 'an existing section at unterminated EOF',
			section: 'Plan',
			before: '---\ntavern: project\n---\n# Project\n## Plan\n- [ ] Last existing task',
			expected:
				'---\ntavern: project\n---\n# Project\n## Plan\n- [ ] Last existing task\n- [ ] Captured\n  - [ ] Captured child\n- [ ] Captured sibling',
		},
		{
			name: 'a new section after an unterminated preamble',
			section: 'Inbox',
			before: '---\ntavern: project\n---\n# Project\nHuman prose.',
			expected:
				'---\ntavern: project\n---\n# Project\nHuman prose.\n## Inbox\n\n- [ ] Captured\n  - [ ] Captured child\n- [ ] Captured sibling',
		},
	])(
		'captures into $name and preserves every existing task reference',
		async ({ before, expected, section }) => {
			const result = await Effect.runPromise(
				addProjectTaskPlan(before, section, {
					text: 'Captured',
					children: [{ text: 'Captured child', children: [] }],
					siblings: [{ text: 'Captured sibling', children: [] }],
				}),
			);
			expect(result.markdown).toBe(expected);
			const oldNote = await Effect.runPromise(parseProjectNote(before));
			const expectedNote = await Effect.runPromise(parseProjectNote(expected));
			const expectedTasks = expectedNote.sections.flatMap((item) => item.tasks);
			const expectedReferences = oldNote.sections
				.flatMap((item) => item.tasks)
				.map((task) => {
					const destination = expectedTasks.find((candidate) => candidate.text === task.text)!;
					return [task.id, destination.id];
				});
			expect([...result.mapping]).toEqual(expectedReferences);
		},
	);

	it('rejects a stale task before writing and writes a valid whole plan once', async () => {
		let current = markdown;
		const modify = vi.fn(async (_file, next: string) => {
			current = next;
		});
		const vault: ProjectVault = {
			getMarkdownFiles: () => [{ path: 'Project.md' }],
			read: async () => current,
			modify,
		};
		const note = await Effect.runPromise(parseProjectNote(markdown));
		const task = {
			...note.sections[0]!.tasks[0]!,
			projectPath: 'Project.md',
			projectTitle: 'Project',
		};
		await expect(
			Effect.runPromise(
				editVaultProjectTaskPlan(vault, { ...task, id: 'stale' }, emptyPlan('Changed')),
			),
		).rejects.toThrow('Task was not found');
		expect(modify).not.toHaveBeenCalled();
		await Effect.runPromise(
			editVaultProjectTaskPlan(vault, task, {
				text: 'Renamed',
				children: [],
				siblings: [{ text: 'Added', children: [] }],
			}),
		);
		expect(modify).toHaveBeenCalledTimes(1);
		expect(current).toContain('- [ ] Renamed\n  - [ ] Child\n- [ ] Added\n- [ ] Next');
	});
});
