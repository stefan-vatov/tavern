/* eslint-disable eslint/no-magic-numbers, eslint/max-statements */
import {
	addDailyTask,
	createDailyNote,
	dailyLogPath,
	editDailyTask,
	insertDailyTaskTree,
	localDay,
	moveDailyTask,
	parseDailyNote,
	setDailyTaskChecked,
	shiftDay,
} from '../src/daily-note';

describe('daily log Markdown', () => {
	it('locates a local calendar day and steps across month, year and daylight-saving boundaries', () => {
		expect(localDay(new Date(2026, 9, 24, 23, 59))).toBe('2026-10-24');
		expect(dailyLogPath('02_Daily_Log/Daily_Log/', '2026-10-24')).toBe(
			'02_Daily_Log/Daily_Log/2026/10/2026-10-24.md',
		);
		expect(shiftDay('2026-10-25', 1)).toBe('2026-10-26');
		expect(shiftDay('2026-03-29', -1)).toBe('2026-03-28');
		expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01');
		expect(shiftDay('2024-03-01', -1)).toBe('2024-02-29');
		expect(() => shiftDay('2026-02-30', 1)).toThrow('Invalid daily note day');
	});

	it('creates only the requested day and the plain General, Plan and Notes skeleton', () => {
		expect(createDailyNote('2026-10-24')).toBe(
			'# 2026-10-24\n\n## General\n\n### Plan\n\n### Notes\n',
		);
	});

	it('exposes absolute task positions and narrative while excluding metadata, title and fenced examples', () => {
		const markdown = [
			'---',
			'title: daily',
			'- [ ] Metadata',
			'---',
			'# 2026-10-24',
			'## General',
			'### Plan',
			'- [ ] Parent ^stable-id',
			'\t- [X] Child',
			'### Notes',
			'An ordinary paragraph.',
			'```md',
			'### Fake heading',
			'- [ ] Example',
			'```',
			'~~~',
			'- [ ] Another example',
			'~~~',
			'- [ ] Real task',
		].join('\n');
		const note = parseDailyNote(markdown);
		expect(note.tasks).toEqual([
			{
				checked: false,
				id: 'block:stable-id',
				blockId: 'stable-id',
				indent: '',
				lineIndex: 7,
				sectionName: 'Plan',
				text: 'Parent',
			},
			{
				checked: true,
				id: 'line:8',
				indent: '\t',
				lineIndex: 8,
				sectionName: 'Plan',
				text: 'Child',
			},
			{
				checked: false,
				id: 'line:18',
				indent: '',
				lineIndex: 18,
				sectionName: 'Notes',
				text: 'Real task',
			},
		]);
		expect(note.items.filter((item) => item.type === 'heading')).toEqual([
			{ type: 'heading', level: 2, text: 'General', lineIndex: 5 },
			{ type: 'heading', level: 3, text: 'Plan', lineIndex: 6 },
			{ type: 'heading', level: 3, text: 'Notes', lineIndex: 9 },
		]);
		expect(note.items).toContainEqual({
			type: 'text',
			raw: 'An ordinary paragraph.',
			lineIndex: 10,
		});
		expect(note.items.some((item) => item.type === 'text' && item.lineIndex < 5)).toBe(false);
	});

	it('changes only the selected checkbox or task text, retaining block IDs, whitespace and mixed line endings', () => {
		const original =
			'---\r\nkind: log\r\n---\n# Day\r\n### Plan\r\n\t- [X]  Original  ^task-1  \r\n### Notes\nNarrative without a final newline';
		expect(setDailyTaskChecked(original, 5, false)).toBe(original.replace('[X]', '[ ]'));
		const edited = editDailyTask(original, 5, '  Revised  ');
		expect(edited).toBe(original.replace('Original', 'Revised'));
		expect(parseDailyNote(edited).tasks[0]?.id).toBe('block:task-1');
		expect(() => editDailyTask(original, 5, '  ')).toThrow('Task text was empty');
		expect(() => setDailyTaskChecked(original, 6, true)).toThrow('Daily task was not found');
		expect(() => addDailyTask(original, 'one\ntwo')).toThrow('single line');
	});

	it.each(['###', '####'])(
		'appends visibly within Plan before %s Notes without moving narrative and supplies missing headings',
		(heading) => {
			const original = `# Day\n## General\n### Plan\n- [ ] Existing\n\n${heading} Notes\nKeep this.\n`;
			expect(addDailyTask(original, 'Next')).toBe(
				`# Day\n## General\n### Plan\n- [ ] Existing\n- [ ] Next\n\n${heading} Notes\nKeep this.\n`,
			);
			const missing = addDailyTask('# Day\nUnstructured prose.\n', 'Captured');
			expect(missing).toContain('# Day\nUnstructured prose.\n');
			expect(missing).toContain('## General\n\n### Plan\n\n- [ ] Captured');
		},
	);

	it('moves a complete parent subtree including its indented prose and retains unrelated narrative', () => {
		const markdown =
			'# Day\n### Plan\n- [ ] Parent ^p\n  Supporting prose.\n  - [x] Child ^c\n- [ ] Next ^n\n### Notes\nKeep this.\n';
		const moved = moveDailyTask(markdown, 2, 5, 'after');
		expect(moved).toBe(
			'# Day\n### Plan\n- [ ] Next ^n\n- [ ] Parent ^p\n  Supporting prose.\n  - [x] Child ^c\n### Notes\nKeep this.\n',
		);
		expect(parseDailyNote(moved).tasks.map((task) => task.id)).toEqual([
			'block:n',
			'block:p',
			'block:c',
		]);
		expect(() => moveDailyTask(markdown, 2, 4, 'child')).toThrow('own children');
		expect(moveDailyTask(markdown, 2, 2, 'before')).toBe(markdown);
	});

	it('reindents a parent and its children when nesting and restores it to sibling level', () => {
		const original =
			'### Plan\n- [ ] Parent ^p\n  - [ ] Child ^c\n- [ ] Target ^t\n### Notes\nNarrative\n';
		const nested = moveDailyTask(original, 1, 3, 'child');
		expect(nested).toBe(
			'### Plan\n- [ ] Target ^t\n  - [ ] Parent ^p\n    - [ ] Child ^c\n### Notes\nNarrative\n',
		);
		expect(moveDailyTask(nested, 2, 1, 'before')).toBe(original);
	});
	it('retains a missing final newline when reordering the last task', () => {
		const markdown = '### Plan\n- [ ] First ^a\n- [ ] Last ^b';
		expect(moveDailyTask(markdown, 1, 2, 'after')).toBe('### Plan\n- [ ] Last ^b\n- [ ] First ^a');
	});

	it('copies a task tree into Plan without changing source text or the surrounding note', () => {
		const source = '\t- [ ] Imported \u005elinked\n\t  Supporting prose.\n\t  - [x] Child\n';
		const note =
			'---\r\nkind: log\r\n---\r\n### Plan\r\n- [ ] Existing\r\n\r\n### Notes\r\nKeep this.\n';
		const result = insertDailyTaskTree(note, source);
		expect(result.markdown).toBe(
			'---\r\nkind: log\r\n---\r\n### Plan\r\n- [ ] Existing\r\n- [ ] Imported ^linked\r\n  Supporting prose.\r\n  - [x] Child\r\n\r\n### Notes\r\nKeep this.\n',
		);
		expect([...result.lineMapping]).toEqual([
			[0, 0],
			[1, 1],
			[2, 2],
			[3, 3],
			[4, 4],
			[5, 8],
			[6, 9],
			[7, 10],
		]);
		expect(insertDailyTaskTree('# Day\nNarrative.\n', '- [ ] ### Task text').markdown).toBe(
			'# Day\nNarrative.\n\n## General\n\n### Plan\n\n- [ ] ### Task text\n\n',
		);
	});

	it.each([
		['before', '- [ ] Imported\n  - [ ] Nested\n- [ ] Target\n\t- [ ] Existing child\n'],
		['after', '- [ ] Target\n\t- [ ] Existing child\n- [ ] Imported\n  - [ ] Nested\n'],
		['child', '- [ ] Target\n\t- [ ] Imported\n\t  - [ ] Nested\n\t- [ ] Existing child\n'],
	] as const)('inserts %s relative to the full destination subtree', (placement, tasks) => {
		const note = '### Plan\n- [ ] Target\n\t- [ ] Existing child\n### Notes\nNarrative';
		expect(
			insertDailyTaskTree(note, '- [ ] Imported\n  - [ ] Nested', { lineIndex: 1, placement })
				.markdown,
		).toBe(`### Plan\n${tasks}### Notes\nNarrative`);
	});

	it.each([
		{
			name: 'spaces parent and mixed child',
			targetIndent: '    ',
			existingIndent: '\t  ',
			childIndent: '\t  ',
		},
		{
			name: 'tab parent and spaces child',
			targetIndent: '\t',
			existingIndent: '      ',
			childIndent: '      ',
		},
		{
			name: 'four-space parent without children',
			targetIndent: '    ',
			existingIndent: undefined,
			childIndent: '    \t',
		},
		{
			name: 'tab parent without children',
			targetIndent: '\t',
			existingIndent: undefined,
			childIndent: '\t\t',
		},
		{
			name: 'two-space parent without children',
			targetIndent: '  ',
			existingIndent: undefined,
			childIndent: '    ',
		},
		{
			name: 'unindented parent without children',
			targetIndent: '',
			existingIndent: undefined,
			childIndent: '  ',
		},
	] as const)(
		'nests moved and copied trees using the destination child level: $name',
		({ targetIndent, existingIndent, childIndent }) => {
			const source =
				'\t- [ ] Imported ^imported\r\n\t  Supporting prose.\r\n\t  - [x] Nested ^nested';
			const existing: string[] = [];
			if (existingIndent !== undefined) {
				existing.push(`${existingIndent}- [ ] Existing ^existing`);
			}
			const destination = [
				'- [ ] Outer ^outer',
				`${targetIndent}- [ ] Target ^target`,
				...existing,
				'### Notes',
				'Narrative',
			].join('\r\n');
			const expected = [
				'### Plan',
				'- [ ] Outer ^outer',
				`${targetIndent}- [ ] Target ^target`,
				`${childIndent}- [ ] Imported ^imported`,
				`${childIndent}  Supporting prose.`,
				`${childIndent}  - [x] Nested ^nested`,
				...existing,
				'### Notes',
				'Narrative',
			].join('\r\n');
			expect
				.soft(moveDailyTask(`### Plan\r\n${source}\r\n${destination}`, 1, 5, 'child'))
				.toBe(expected);
			expect
				.soft(
					insertDailyTaskTree(`### Plan\r\n${destination}`, source, {
						lineIndex: 2,
						placement: 'child',
					}).markdown,
				)
				.toBe(expected);
		},
	);

	it('rejects non-task destinations and sources rather than inserting raw text as note structure', () => {
		const note = '### Plan\n- [ ] Target\n### Notes\nNarrative';
		expect(() =>
			insertDailyTaskTree(note, '- [ ] Imported', { lineIndex: 2, placement: 'before' }),
		).toThrow('Daily task was not found');
		for (const source of ['', '### Raw title', '- [ ]   ']) {
			expect(() => insertDailyTaskTree(note, source)).toThrow('must start with a nonempty task');
		}
	});

	it('rejects invalid calendar input and multiline task edits before producing replacement Markdown', () => {
		const note = '### Plan\n- [ ] Keep this ^keep\n### Notes\nNarrative';
		expect(() => localDay(new Date(Number.NaN))).toThrow('Invalid daily note date');
		expect(() => dailyLogPath('Daily', '24-10-2026')).toThrow('Invalid daily note day');
		expect(() => createDailyNote('2026-13-01')).toThrow('Invalid daily note day');
		expect(() => shiftDay('2026-10-24', 0.5)).toThrow('must be an integer');
		expect(() => editDailyTask(note, 1, 'First\rSecond')).toThrow('must be a single line');
		expect(() => addDailyTask(note, ' ')).toThrow('Task text was empty');
	});

	it('keeps headings and tasks inside fences literal until a matching closing fence', () => {
		const note =
			'## General\n~~~~md\n### Not a section\n- [ ] Example\n```\n~~~\n- [ ] Still example\n~~~~\n### Plan ###\n- [ ] Real\n';
		const parsed = parseDailyNote(note);
		expect(parsed.tasks.map((task) => task.text)).toEqual(['Real']);
		expect(parsed.items.filter((item) => item.type === 'heading')).toEqual([
			{ type: 'heading', level: 2, text: 'General', lineIndex: 0 },
			{ type: 'heading', level: 3, text: 'Plan', lineIndex: 8 },
		]);
		expect(parsed.items).toContainEqual({ type: 'text', raw: '### Not a section', lineIndex: 2 });
	});

	it.each(['absent', 'hidden'])(
		'creates visible Plan inside the existing General section without swallowing narrative when Plan is %s',
		(kind) => {
			let hiddenPlan = '';
			if (kind === 'hidden') {
				hiddenPlan = '#### Plan\n- [ ] Existing hidden\n';
			}
			const note = `# Day\n## General\nAn intro.\n### Notes\nKeep notes.\n${hiddenPlan}## Other\nOther prose.\n`;
			expect(insertDailyTaskTree(note, '- [ ] Captured\n  - [x] Detail').markdown).toBe(
				`# Day\n## General\nAn intro.\n### Notes\nKeep notes.\n${hiddenPlan}### Plan\n\n- [ ] Captured\n  - [x] Detail\n\n## Other\nOther prose.\n`,
			);
		},
	);

	it('reindents a moved tab-indented subtree with space-indented children while retaining CRLF and final prose', () => {
		const note =
			'### Plan\r\n\t- [ ] Parent\r\n      - [x] Child\r\n- [ ] Target\r\n### Notes\r\nNarrative';
		expect(moveDailyTask(note, 1, 3, 'after')).toBe(
			'### Plan\r\n- [ ] Target\r\n- [ ] Parent\r\n  - [x] Child\r\n### Notes\r\nNarrative',
		);
	});
});
