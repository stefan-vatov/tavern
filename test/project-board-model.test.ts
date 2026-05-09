/* eslint-disable eslint/no-magic-numbers */
import { Effect } from 'effect';
import { buildProjectLibrary, projectTasks, taskSelectionKey } from '../src/project-library';
import { addTaskToFocusQueue, createProjectBoardModel } from '../src/project-board-model';

const PROJECT_MARKDOWN = `---
Title: Pi
tavern: project
---
# Pi

## In Progress

- [ ] Wire model

## Done

- [x] Existing done
`;

const OTHER_MARKDOWN = `---
Title: Blogging
tavern: project
---
# Blogging

## Backlog

- [ ] Draft post
`;

describe('project board model', () => {
	it('should derive visible projects, selected project, task counts, and focus queue', () => {
		const library = Effect.runSync(
			buildProjectLibrary({
				files: [
					{ markdown: PROJECT_MARKDOWN, path: '04_Projects/Pi.md' },
					{ markdown: OTHER_MARKDOWN, path: '04_Projects/Blogging.md' },
				],
				folders: ['04_Projects'],
			}),
		);
		const draftPostTask = projectTasks(library).find((task) => task.text === 'Draft post');
		const model = createProjectBoardModel({
			boardTaskKeys: [taskSelectionKey(draftPostTask)],
			library,
			query: 'draft',
			selectedPath: '04_Projects/Pi.md',
		});

		expect(model.visibleProjects.map((project) => project.title)).toEqual(['Blogging']);
		expect(model.selectedProject?.title).toBe('Pi');
		expect(model.openTaskCount).toBe(2);
		expect(model.doneTaskCount).toBe(1);
		expect(model.focusTasks.map((task) => task.text)).toEqual(['Draft post']);
	});

	it('should add task keys without duplicates', () => {
		expect(addTaskToFocusQueue(['a'], 'a')).toEqual(['a']);
		expect(addTaskToFocusQueue(['a'], 'b')).toEqual(['a', 'b']);
		expect(addTaskToFocusQueue(['a'], '')).toEqual(['a']);
	});

	it('should select the first project when selected path is unavailable', () => {
		const library = Effect.runSync(
			buildProjectLibrary({
				files: [
					{ markdown: PROJECT_MARKDOWN, path: '04_Projects/Pi.md' },
					{ markdown: OTHER_MARKDOWN, path: '04_Projects/Blogging.md' },
				],
				folders: ['04_Projects'],
			}),
		);

		const model = createProjectBoardModel({
			boardTaskKeys: [],
			library,
			query: '',
			selectedPath: '04_Projects/Missing.md',
		});

		expect(model.selectedProject?.title).toBe('Blogging');
	});
});
