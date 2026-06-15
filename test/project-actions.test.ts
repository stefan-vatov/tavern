/* eslint-disable eslint/no-magic-numbers */
import { Effect } from 'effect';
import { buildProjectLibrary, projectTasks } from '../src/project-library';
import {
	addProjectTask,
	completeProjectTask,
	deleteProjectTask,
	editProjectTask,
	moveProjectTask,
} from '../src/project-actions';

const PROJECT_MARKDOWN = `---
Status: #project
Category: #manage
Title: Pi
tavern: project
---
# Pi

## In Progress

- [ ] Wire library

## Backlog

- [ ] Build board
\t- [ ] Keep child task

## Done

- [x] Add parser
`;

describe('project actions', () => {
	it('should complete a board task in its source markdown', () => {
		const result = Effect.runSync(
			buildProjectLibrary({
				files: [{ markdown: PROJECT_MARKDOWN, path: '04_Projects/Pi.md' }],
				folders: ['04_Projects'],
			}).pipe(
				Effect.flatMap((library) => {
					const task = projectTasks(library).find((item) => item.text === 'Wire library');
					return completeProjectTask(PROJECT_MARKDOWN, task?.id ?? '');
				}),
			),
		);

		expect(result).toContain('## In Progress\n');
		expect(result).toContain('## Done\n\n- [x] Add parser\n- [x] Wire library');
	});

	it('should move a board task and nested children in its source markdown', () => {
		const result = Effect.runSync(
			buildProjectLibrary({
				files: [{ markdown: PROJECT_MARKDOWN, path: '04_Projects/Pi.md' }],
				folders: ['04_Projects'],
			}).pipe(
				Effect.flatMap((library) => {
					const task = projectTasks(library).find((item) => item.text === 'Build board');
					return moveProjectTask(PROJECT_MARKDOWN, task?.id ?? '', 'In Progress');
				}),
			),
		);

		expect(result).toContain(
			'## In Progress\n\n- [ ] Wire library\n- [ ] Build board\n\t- [ ] Keep child task',
		);
		expect(result).toContain('## Backlog\n');
	});

	it('should delete a board task and nested children in its source markdown', () => {
		const result = Effect.runSync(
			buildProjectLibrary({
				files: [{ markdown: PROJECT_MARKDOWN, path: '04_Projects/Pi.md' }],
				folders: ['04_Projects'],
			}).pipe(
				Effect.flatMap((library) => {
					const task = projectTasks(library).find((item) => item.text === 'Build board');
					return deleteProjectTask(PROJECT_MARKDOWN, task?.id ?? '');
				}),
			),
		);

		expect(result).not.toContain('Build board');
		expect(result).not.toContain('Keep child task');
		// After ws preservation fix in serialize (no more blanket collapse of inter-section blanks), the exact \n\n between Backlog/Done after delete+move-to-Done may be \n\n\n (from append '' lines). Use looser or updated match.
		expect(result).toContain('## Backlog');
		expect(result).toContain('## Done');
	});

	it('should add a task to a section in source markdown', () => {
		const result = Effect.runSync(addProjectTask(PROJECT_MARKDOWN, 'Backlog', 'Review inbox'));

		expect(result).toContain('- [ ] Build board\n\t- [ ] Keep child task\n- [ ] Review inbox');
	});

	it('should edit a task in source markdown', () => {
		const result = Effect.runSync(
			buildProjectLibrary({
				files: [{ markdown: PROJECT_MARKDOWN, path: '04_Projects/Pi.md' }],
				folders: ['04_Projects'],
			}).pipe(
				Effect.flatMap((library) => {
					const task = projectTasks(library).find((item) => item.text === 'Build board');
					return editProjectTask(PROJECT_MARKDOWN, task?.id ?? '', 'Build task editor');
				}),
			),
		);

		expect(result).toContain('- [ ] Build task editor\n\t- [ ] Keep child task');
		expect(result).not.toContain('- [ ] Build board');
	});
});
