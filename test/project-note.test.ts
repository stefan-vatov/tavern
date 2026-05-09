/* eslint-disable eslint/no-magic-numbers */
import { Effect, Exit } from 'effect';
import {
	addTaskToSection,
	completeTask,
	deleteTask,
	editTaskText,
	isTavernProjectFrontmatter,
	moveTaskToPosition,
	moveTaskToSection,
	parseProjectNote,
	reorderTask,
	serializeProjectNote,
	TAVERN_PROJECT_FRONTMATTER,
} from '../src/project-note';

const PROJECT_MARKDOWN = `---
Status: #project
Category: #manage
Title: Pi
tavern: project
---
⇱ [[01_Manage]] ▴
# Pi

## Overview

Project notes can have prose.

## In Progress

- [ ] Build parser

## Backlog

- [ ] Implement board
\t- [ ] Keep child task
- [x] Already done

## Notes & Decisions

- Keep arbitrary sections
`;

describe('project note domain', () => {
	describe('isTavernProjectFrontmatter', () => {
		it('should detect the Tavern project property', () => {
			expect(isTavernProjectFrontmatter({ tavern: 'project' })).toBe(true);
			expect(isTavernProjectFrontmatter({ tavern: 'scene' })).toBe(false);
		});
	});

	describe('parseProjectNote', () => {
		it('should parse frontmatter, title, arbitrary sections, and tasks', () => {
			const note = Effect.runSync(parseProjectNote(PROJECT_MARKDOWN));

			expect(note.frontmatter).toEqual({
				Category: '#manage',
				Status: '#project',
				Title: 'Pi',
				tavern: TAVERN_PROJECT_FRONTMATTER,
			});
			expect(note.title).toBe('Pi');
			expect(note.sections.map((section) => section.name)).toEqual([
				'Overview',
				'In Progress',
				'Backlog',
				'Notes & Decisions',
			]);
			expect(note.sections.flatMap((section) => section.tasks).map((task) => task.text)).toEqual([
				'Build parser',
				'Implement board',
				'Keep child task',
				'Already done',
			]);
		});

		it('should fail when the note is not marked as a Tavern project', () => {
			const exit = Effect.runSyncExit(parseProjectNote('# Plain Note'));

			expect(Exit.isFailure(exit)).toBe(true);
		});

		it('should fail when frontmatter is not closed', () => {
			const exit = Effect.runSyncExit(parseProjectNote('---\ntavern: project\n# Broken'));

			expect(Exit.isFailure(exit)).toBe(true);
		});

		it('should parse a project note without sections', () => {
			const note = Effect.runSync(
				parseProjectNote('---\ntavern: project\nTitle: Loose\n---\n# Loose'),
			);

			expect(note.title).toBe('Loose');
			expect(note.sections).toEqual([]);
			expect(serializeProjectNote(note)).toBe('---\ntavern: project\nTitle: Loose\n---\n# Loose');
		});

		it('should not invent sections when a sectionless note has body text', () => {
			const note = Effect.runSync(
				parseProjectNote('---\ntavern: project\n---\n# Loose\n\nbody text'),
			);

			expect(note.preambleLines).toEqual(['# Loose', '', 'body text']);
			expect(note.sections).toEqual([]);
			expect(serializeProjectNote(note)).not.toContain('Stryker was here');
		});

		it('should require frontmatter delimiters at the start and end of their lines', () => {
			const notFrontmatter = Effect.runSyncExit(parseProjectNote('x---\ntavern: project\n---'));
			const brokenProperty = Effect.runSyncExit(
				parseProjectNote('---\ntavern: project trailing\n---\n# Broken'),
			);

			expect(Exit.isFailure(notFrontmatter)).toBe(true);
			expect(Exit.isFailure(brokenProperty)).toBe(true);
		});

		it('should trim frontmatter and ignore markdown that only looks like headings or tasks', () => {
			const note = Effect.runSync(
				parseProjectNote(`---
  tavern  :   project
---
preface # Not the title
# Real Title

prefix ## Not a section
##    Spaced Section

not a task - [ ] nope
- [X] Done uppercase
`),
			);

			expect(note.frontmatter.tavern).toBe('project');
			expect(note.title).toBe('Real Title');
			expect(note.sections.map((section) => section.name)).toEqual(['Spaced Section']);
			expect(note.sections[0]?.tasks).toEqual([
				expect.objectContaining({
					checked: true,
					id: 'spaced-section-2-done-uppercase',
					text: 'Done uppercase',
				}),
			]);
		});

		it('should fall back to the frontmatter title and then untitled project', () => {
			const titled = Effect.runSync(parseProjectNote('---\ntavern: project\nTitle: Fallback\n---'));
			const untitled = Effect.runSync(parseProjectNote('---\ntavern: project\n---'));

			expect(titled.title).toBe('Fallback');
			expect(untitled.title).toBe('Untitled project');
		});
	});

	describe('moveTaskToSection', () => {
		it('should move a task and its nested children into the target section', () => {
			const moved = Effect.runSync(
				parseProjectNote(PROJECT_MARKDOWN).pipe(
					Effect.flatMap((note) =>
						moveTaskToSection(note, note.sections[2]?.tasks[0]?.id ?? '', 'In Progress'),
					),
				),
			);

			const inProgressTasks = moved.sections
				.find((section) => section.name === 'In Progress')
				?.tasks.map((task) => task.text);
			const backlogTasks = moved.sections
				.find((section) => section.name === 'Backlog')
				?.tasks.map((task) => task.text);

			expect(inProgressTasks).toEqual(['Build parser', 'Implement board', 'Keep child task']);
			expect(backlogTasks).toEqual(['Already done']);
		});
	});

	describe('moveTaskToPosition', () => {
		it('should move a task before a target task in another section', () => {
			const serialized = Effect.runSync(
				parseProjectNote(PROJECT_MARKDOWN).pipe(
					Effect.flatMap((note) =>
						moveTaskToPosition({
							note,
							placement: 'before',
							sourceTaskId: note.sections[2]?.tasks[2]?.id ?? '',
							targetTaskId: note.sections[1]?.tasks[0]?.id ?? '',
						}),
					),
					Effect.map(serializeProjectNote),
				),
			);

			expect(serialized).toContain('## In Progress\n\n- [x] Already done\n- [ ] Build parser');
		});

		it('should reorder tasks by dropping after another task in the same list', () => {
			const serialized = Effect.runSync(
				parseProjectNote(PROJECT_MARKDOWN).pipe(
					Effect.flatMap((note) =>
						moveTaskToPosition({
							note,
							placement: 'after',
							sourceTaskId: note.sections[2]?.tasks[0]?.id ?? '',
							targetTaskId: note.sections[2]?.tasks[2]?.id ?? '',
						}),
					),
					Effect.map(serializeProjectNote),
				),
			);

			expect(serialized).toContain(
				'## Backlog\n\n- [x] Already done\n- [ ] Implement board\n\t- [ ] Keep child task',
			);
		});

		it('should nest dropped tasks and keep their children under the new parent', () => {
			const serialized = Effect.runSync(
				parseProjectNote(PROJECT_MARKDOWN).pipe(
					Effect.flatMap((note) =>
						moveTaskToPosition({
							note,
							placement: 'child',
							sourceTaskId: note.sections[2]?.tasks[2]?.id ?? '',
							targetTaskId: note.sections[2]?.tasks[0]?.id ?? '',
						}),
					),
					Effect.map(serializeProjectNote),
				),
			);

			expect(serialized).toContain(
				'## Backlog\n\n- [ ] Implement board\n\t- [x] Already done\n\t- [ ] Keep child task',
			);
		});

		it('should unnest a child when it is dropped after a top-level task', () => {
			const serialized = Effect.runSync(
				parseProjectNote(PROJECT_MARKDOWN).pipe(
					Effect.flatMap((note) =>
						moveTaskToPosition({
							note,
							placement: 'after',
							sourceTaskId: note.sections[2]?.tasks[1]?.id ?? '',
							targetTaskId: note.sections[2]?.tasks[2]?.id ?? '',
						}),
					),
					Effect.map(serializeProjectNote),
				),
			);

			expect(serialized).toContain(
				'## Backlog\n\n- [ ] Implement board\n- [x] Already done\n- [ ] Keep child task',
			);
		});

		it('should ignore dropping a task on itself', () => {
			const serialized = Effect.runSync(
				parseProjectNote(PROJECT_MARKDOWN).pipe(
					Effect.flatMap((note) =>
						moveTaskToPosition({
							note,
							placement: 'child',
							sourceTaskId: note.sections[2]?.tasks[0]?.id ?? '',
							targetTaskId: note.sections[2]?.tasks[0]?.id ?? '',
						}),
					),
					Effect.map(serializeProjectNote),
				),
			);

			expect(serialized).toBe(PROJECT_MARKDOWN);
		});

		it('should fail when either dropped task cannot be found', () => {
			const missingSource = Effect.runSync(
				parseProjectNote(PROJECT_MARKDOWN).pipe(
					Effect.flatMap((note) =>
						moveTaskToPosition({
							note,
							placement: 'after',
							sourceTaskId: 'missing-source',
							targetTaskId: note.sections[2]?.tasks[0]?.id ?? '',
						}),
					),
					Effect.flip,
				),
			);
			const missingTarget = Effect.runSync(
				parseProjectNote(PROJECT_MARKDOWN).pipe(
					Effect.flatMap((note) =>
						moveTaskToPosition({
							note,
							placement: 'after',
							sourceTaskId: note.sections[2]?.tasks[0]?.id ?? '',
							targetTaskId: 'missing-target',
						}),
					),
					Effect.flip,
				),
			);

			if (!('taskId' in missingSource) || !('taskId' in missingTarget)) {
				throw new Error('expected task errors');
			}
			expect(missingSource.taskId).toBe('missing-source');
			expect(missingTarget.taskId).toBe('missing-target');
		});
	});

	describe('addTaskToSection', () => {
		it('should append a new unchecked task to an existing section', () => {
			const added = Effect.runSync(
				parseProjectNote(PROJECT_MARKDOWN).pipe(
					Effect.flatMap((note) => addTaskToSection(note, 'Backlog', 'Review project inbox')),
					Effect.map(serializeProjectNote),
				),
			);

			expect(added).toContain(
				'## Backlog\n\n- [ ] Implement board\n\t- [ ] Keep child task\n- [x] Already done\n- [ ] Review project inbox',
			);
		});

		it('should create a missing section before notes and reject blank task text', () => {
			const added = Effect.runSync(
				parseProjectNote(PROJECT_MARKDOWN).pipe(
					Effect.flatMap((note) => addTaskToSection(note, 'Blocked', 'Follow up')),
					Effect.map(serializeProjectNote),
				),
			);
			const exit = Effect.runSyncExit(
				parseProjectNote(PROJECT_MARKDOWN).pipe(
					Effect.flatMap((note) => addTaskToSection(note, 'Backlog', '   ')),
				),
			);

			expect(added).toContain(
				'## Blocked\n\n- [ ] Follow up\n\n## Notes & Decisions\n\n- Keep arbitrary sections',
			);
			expect(Exit.isFailure(exit)).toBe(true);
		});
	});

	describe('deleteTask', () => {
		it('should delete a task and its nested children', () => {
			const deleted = Effect.runSync(
				parseProjectNote(PROJECT_MARKDOWN).pipe(
					Effect.flatMap((note) => deleteTask(note, note.sections[2]?.tasks[0]?.id ?? '')),
					Effect.map(serializeProjectNote),
				),
			);

			expect(deleted).not.toContain('Implement board');
			expect(deleted).not.toContain('Keep child task');
			expect(deleted).toContain('## Backlog\n\n- [x] Already done');
		});

		it('should fail when deleting a missing task', () => {
			const exit = Effect.runSyncExit(
				parseProjectNote(PROJECT_MARKDOWN).pipe(
					Effect.flatMap((note) => deleteTask(note, 'missing-task')),
				),
			);

			expect(Exit.isFailure(exit)).toBe(true);
		});
	});

	describe('editTaskText', () => {
		it('should edit task text while preserving checked state and indentation', () => {
			const edited = Effect.runSync(
				parseProjectNote(PROJECT_MARKDOWN).pipe(
					Effect.flatMap((note) =>
						editTaskText(note, note.sections[2]?.tasks[2]?.id ?? '', 'Reviewed task'),
					),
					Effect.map(serializeProjectNote),
				),
			);

			expect(edited).toContain('- [x] Reviewed task');
			expect(edited).not.toContain('- [x] Already done');
		});

		it('should reject blank edits and missing tasks', () => {
			const blank = Effect.runSyncExit(
				parseProjectNote(PROJECT_MARKDOWN).pipe(
					Effect.flatMap((note) => editTaskText(note, note.sections[2]?.tasks[0]?.id ?? '', ' ')),
				),
			);
			const missing = Effect.runSyncExit(
				parseProjectNote(PROJECT_MARKDOWN).pipe(
					Effect.flatMap((note) => editTaskText(note, 'missing-task', 'Review')),
				),
			);

			expect(Exit.isFailure(blank)).toBe(true);
			expect(Exit.isFailure(missing)).toBe(true);
		});
	});

	describe('completeTask', () => {
		it('should check a task and move it to Done', () => {
			const completed = Effect.runSync(
				parseProjectNote(PROJECT_MARKDOWN).pipe(
					Effect.flatMap((note) => completeTask(note, note.sections[1]?.tasks[0]?.id ?? '')),
				),
			);

			const doneSection = completed.sections.find((section) => section.name === 'Done');

			expect(
				doneSection?.tasks.map((task) => ({ checked: task.checked, text: task.text })),
			).toEqual([{ checked: true, text: 'Build parser' }]);
		});

		it('should create Done before notes when the section does not exist', () => {
			const markdown = PROJECT_MARKDOWN.replace('\n## Done\n', '\n');
			const completed = Effect.runSync(
				parseProjectNote(markdown).pipe(
					Effect.flatMap((note) => completeTask(note, note.sections[1]?.tasks[0]?.id ?? '')),
					Effect.map(serializeProjectNote),
				),
			);

			expect(completed).toContain(
				'## Done\n\n- [x] Build parser\n\n## Notes & Decisions\n\n- Keep arbitrary sections',
			);
		});

		it('should create Done after existing sections when no notes section exists', () => {
			const markdown = `---
tavern: project
---
# Shipping

## Backlog

- [ ] Release build
`;
			const completed = Effect.runSync(
				parseProjectNote(markdown).pipe(
					Effect.flatMap((note) => completeTask(note, note.sections[0]?.tasks[0]?.id ?? '')),
					Effect.map(serializeProjectNote),
				),
			);

			expect(completed).toBe(`---
tavern: project
---
# Shipping

## Backlog

## Done

- [x] Release build
`);
		});

		it('should fail when task id is not found', () => {
			const error = Effect.runSync(
				parseProjectNote(PROJECT_MARKDOWN).pipe(
					Effect.flatMap((note) => completeTask(note, 'missing-task')),
					Effect.flip,
				),
			);

			expect(error.message).toBe('Task was not found.');
			if (!('taskId' in error)) {
				throw new Error('expected task error');
			}
			expect(error.taskId).toBe('missing-task');
		});
	});

	describe('reorderTask', () => {
		it('should move a task up within its section', () => {
			const serialized = Effect.runSync(
				parseProjectNote(PROJECT_MARKDOWN).pipe(
					Effect.flatMap((note) => reorderTask(note, note.sections[2]?.tasks[2]?.id ?? '', 'up')),
					Effect.map(serializeProjectNote),
				),
			);

			expect(serialized).toContain(
				'## Backlog\n\n- [x] Already done\n- [ ] Implement board\n\t- [ ] Keep child task',
			);
		});

		it('should move a task and its nested children down within its section', () => {
			const markdown = PROJECT_MARKDOWN.replace(
				'- [ ] Implement board\n\t- [ ] Keep child task\n- [x] Already done',
				'- [x] Already done\n- [ ] Implement board\n\t- [ ] Keep child task',
			);
			const serialized = Effect.runSync(
				parseProjectNote(markdown).pipe(
					Effect.flatMap((note) => reorderTask(note, note.sections[2]?.tasks[0]?.id ?? '', 'down')),
					Effect.map(serializeProjectNote),
				),
			);

			expect(serialized).toContain(
				'## Backlog\n\n- [ ] Implement board\n\t- [ ] Keep child task\n- [x] Already done',
			);
		});

		it('should leave the first task in place when moving up', () => {
			const serialized = Effect.runSync(
				parseProjectNote(PROJECT_MARKDOWN).pipe(
					Effect.flatMap((note) => reorderTask(note, note.sections[2]?.tasks[0]?.id ?? '', 'up')),
					Effect.map(serializeProjectNote),
				),
			);

			expect(serialized).toContain(
				'## Backlog\n\n- [ ] Implement board\n\t- [ ] Keep child task\n- [x] Already done',
			);
		});

		it('should leave the last task in place when moving down', () => {
			const serialized = Effect.runSync(
				parseProjectNote(PROJECT_MARKDOWN).pipe(
					Effect.flatMap((note) => reorderTask(note, note.sections[2]?.tasks[2]?.id ?? '', 'down')),
					Effect.map(serializeProjectNote),
				),
			);

			expect(serialized).toContain(
				'## Backlog\n\n- [ ] Implement board\n\t- [ ] Keep child task\n- [x] Already done',
			);
		});

		it('should fail when the task id is not found', () => {
			const error = Effect.runSync(
				parseProjectNote(PROJECT_MARKDOWN).pipe(
					Effect.flatMap((note) => reorderTask(note, 'missing-task', 'up')),
					Effect.flip,
				),
			);

			expect(error.message).toBe('Task was not found.');
			if (!('taskId' in error)) {
				throw new Error('expected task error');
			}
			expect(error.taskId).toBe('missing-task');
		});
	});

	describe('serializeProjectNote', () => {
		it('should preserve markdown while reflecting task moves', () => {
			const serialized = Effect.runSync(
				parseProjectNote(PROJECT_MARKDOWN).pipe(
					Effect.flatMap((note) =>
						moveTaskToSection(note, note.sections[2]?.tasks[0]?.id ?? '', 'In Progress'),
					),
					Effect.map(serializeProjectNote),
				),
			);

			expect(serialized).toContain('tavern: project');
			expect(serialized).toContain('## Notes & Decisions\n\n- Keep arbitrary sections');
			expect(serialized).toContain(
				'## In Progress\n\n- [ ] Build parser\n- [ ] Implement board\n\t- [ ] Keep child task',
			);
			expect(serialized).toContain('## Backlog\n\n- [x] Already done');
		});

		it('should preserve frontmatter and preamble when completing tasks', () => {
			const serialized = Effect.runSync(
				parseProjectNote(PROJECT_MARKDOWN).pipe(
					Effect.flatMap((note) => completeTask(note, note.sections[1]?.tasks[0]?.id ?? '')),
					Effect.map(serializeProjectNote),
				),
			);

			expect(serialized).toContain(
				'Status: #project\nCategory: #manage\nTitle: Pi\ntavern: project',
			);
			expect(serialized).toContain('⇱ [[01_Manage]] ▴\n# Pi');
		});
	});
});
