/* eslint-disable eslint/func-style, eslint/no-magic-numbers */
import { Effect } from 'effect';
import {
	buildProjectLibrary,
	filterProjects,
	filterTasks,
	projectTasks,
	selectedProjectTasks,
	taskSelectionKey,
	type ProjectSourceFile,
} from '../src/project-library';

const PI_MARKDOWN = `---
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

## Done

- [x] Add parser
`;

const BLOGGING_MARKDOWN = `---
Status: #project
Category: #manage
Title: Blogging
tavern: project
---
# Blogging

## Backlog

- [ ] Draft launch post
`;

const UNMARKED_MARKDOWN = `---
Status: #project
Title: Hidden
---
# Hidden

## Backlog

- [ ] Should not appear
`;

const MINIMAL_MARKDOWN = `---
tavern: project
---
# Minimal

## Later

- [ ] Ask model
`;

function buildFile(overrides: Partial<ProjectSourceFile>): ProjectSourceFile {
	return {
		markdown: PI_MARKDOWN,
		path: '04_Projects/01_Manage/Active/Pi.md',
		...overrides,
	};
}

describe('project library', () => {
	describe('buildProjectLibrary', () => {
		it('should include only marked project notes inside configured folders', () => {
			const library = Effect.runSync(
				buildProjectLibrary({
					folders: ['04_Projects', '05_Areas'],
					files: [
						buildFile({}),
						buildFile({
							markdown: BLOGGING_MARKDOWN,
							path: '  /04_Projects\\01_Manage\\Backlog\\Blogging.md/  ',
						}),
						buildFile({
							markdown: BLOGGING_MARKDOWN.replace('Title: Blogging', 'Title: Slash'),
							path: '///04_Projects/Slash.md///',
						}),
						buildFile({
							markdown: MINIMAL_MARKDOWN,
							path: '05_Areas',
						}),
						buildFile({
							markdown: UNMARKED_MARKDOWN,
							path: '04_Projects/Hidden.md',
						}),
						buildFile({
							markdown: BLOGGING_MARKDOWN,
							path: '99_Archive/Blogging.md',
						}),
					],
				}),
			);

			expect(library.projects.map((project) => project.title)).toEqual([
				'Blogging',
				'Minimal',
				'Pi',
				'Slash',
			]);
			expect(library.projects.map((project) => project.path)).toEqual([
				'  /04_Projects\\01_Manage\\Backlog\\Blogging.md/  ',
				'05_Areas',
				'04_Projects/01_Manage/Active/Pi.md',
				'///04_Projects/Slash.md///',
			]);
			expect(library.projects.map((project) => project.folderName)).toEqual([
				'Backlog',
				'Projects',
				'Active',
				'Projects',
			]);
		});

		it('should collect unchecked and checked tasks with project metadata', () => {
			const library = Effect.runSync(
				buildProjectLibrary({
					folders: ['04_Projects'],
					files: [buildFile({})],
				}),
			);

			expect(
				projectTasks(library).map((task) => [
					task.projectTitle,
					task.sectionName,
					task.text,
					task.checked,
				]),
			).toEqual([
				['Pi', 'In Progress', 'Wire library', false],
				['Pi', 'Backlog', 'Build board', false],
				['Pi', 'Done', 'Add parser', true],
			]);
		});

		it('should derive sidebar folder names from the immediate parent folder', () => {
			const library = Effect.runSync(
				buildProjectLibrary({
					folders: ['04_Projects', 'Work'],
					files: [
						buildFile({
							markdown: PI_MARKDOWN.replace('Title: Pi', 'Title: Nested'),
							path: '04_Projects/01_Manage/Active/Nested/Nested.md',
						}),
						buildFile({
							markdown: BLOGGING_MARKDOWN.replace('Title: Blogging', 'Title: Waiting'),
							path: '04_Projects/01_Manage/02_Waiting/Waiting.md',
						}),
						buildFile({
							markdown: BLOGGING_MARKDOWN.replace('Title: Blogging', 'Title: Root'),
							path: 'Work/Root.md',
						}),
					],
				}),
			);

			expect(library.projects.map((project) => [project.title, project.folderName])).toEqual([
				['Nested', 'Nested'],
				['Root', 'Projects'],
				['Waiting', 'Waiting'],
			]);
		});
	});

	describe('filterProjects', () => {
		it('should rank projects with fuzzy title and task matches', () => {
			const library = Effect.runSync(
				buildProjectLibrary({
					folders: ['04_Projects'],
					files: [
						buildFile({}),
						buildFile({
							markdown: BLOGGING_MARKDOWN,
							path: '04_Projects/01_Manage/Backlog/Blogging.md',
						}),
					],
				}),
			);

			expect(filterProjects(library, 'blog').map((project) => project.title)).toEqual(['Blogging']);
			expect(filterProjects(library, 'board').map((project) => project.title)).toEqual(['Pi']);
			expect(filterProjects(library, '').map((project) => project.title)).toEqual([
				'Blogging',
				'Pi',
			]);
			expect(filterProjects(library, 'project').map((project) => project.title)).toEqual([
				'Blogging',
				'Pi',
			]);
		});

		it('should sort equal-score task matches by project title', () => {
			const alphaMarkdown = BLOGGING_MARKDOWN.replace('Title: Blogging', 'Title: Alpha');
			const library = Effect.runSync(
				buildProjectLibrary({
					folders: ['04_Projects'],
					files: [
						buildFile({
							markdown: BLOGGING_MARKDOWN,
							path: '04_Projects/Blogging.md',
						}),
						buildFile({
							markdown: alphaMarkdown,
							path: '04_Projects/Alpha.md',
						}),
					],
				}),
			);

			expect(filterProjects(library, 'draft launch post').map((project) => project.title)).toEqual([
				'Alpha',
				'Blogging',
			]);
		});

		it('should rank direct title matches above task-only matches', () => {
			const taskMatchMarkdown = BLOGGING_MARKDOWN.replace('Title: Blogging', 'Title: Alpha');
			const titleMatchMarkdown = `---
Title: Draft
tavern: project
---
# Notes

## Later

- [ ] Ask model
`;
			const library = Effect.runSync(
				buildProjectLibrary({
					folders: ['04_Projects'],
					files: [
						buildFile({
							markdown: taskMatchMarkdown,
							path: '04_Projects/Alpha.md',
						}),
						buildFile({
							markdown: titleMatchMarkdown,
							path: '04_Projects/Draft.md',
						}),
					],
				}),
			);

			expect(filterProjects(library, 'draft').map((project) => project.title)).toEqual([
				'Draft',
				'Alpha',
			]);
		});

		it('should trim and lower-case search queries', () => {
			const library = Effect.runSync(
				buildProjectLibrary({
					folders: ['04_Projects'],
					files: [buildFile({})],
				}),
			);

			expect(filterProjects(library, '  WIRE  ').map((project) => project.title)).toEqual(['Pi']);
		});

		it('should normalize punctuation when searching project tasks', () => {
			const library = Effect.runSync(
				buildProjectLibrary({
					folders: ['04_Projects'],
					files: [
						buildFile({
							markdown: `---
Title: Keyboard
tavern: project
---
# Keyboard

## Backlog

- [ ] Implement CTRL + R fuzzy match
`,
							path: '04_Projects/Keyboard.md',
						}),
					],
				}),
			);

			expect(filterProjects(library, 'ctrl r').map((project) => project.title)).toEqual([
				'Keyboard',
			]);
		});

		it('should match fuzzy acronyms and projects without metadata', () => {
			const library = Effect.runSync(
				buildProjectLibrary({
					folders: ['04_Projects'],
					files: [
						buildFile({
							markdown: MINIMAL_MARKDOWN,
							path: '/04_Projects/Minimal.md',
						}),
					],
				}),
			);

			expect(filterProjects(library, 'am').map((project) => project.title)).toEqual(['Minimal']);
			expect(filterProjects(library, 'zzz')).toEqual([]);
		});
	});

	describe('selectedProjectTasks', () => {
		it('should return board tasks in the selected order', () => {
			const library = Effect.runSync(
				buildProjectLibrary({
					folders: ['04_Projects'],
					files: [
						buildFile({}),
						buildFile({
							markdown: BLOGGING_MARKDOWN,
							path: '04_Projects/01_Manage/Backlog/Blogging.md',
						}),
					],
				}),
			);
			const tasks = projectTasks(library);
			const buildBoardTask = tasks.find((task) => task.text === 'Build board');
			const draftPostTask = tasks.find((task) => task.text === 'Draft launch post');

			const selectedTasks = selectedProjectTasks(library, [
				taskSelectionKey(draftPostTask),
				taskSelectionKey(buildBoardTask),
			]);

			expect(selectedTasks.map((task) => task.text)).toEqual(['Draft launch post', 'Build board']);
		});

		it('should ignore stale selected task keys', () => {
			const library = Effect.runSync(
				buildProjectLibrary({
					folders: ['04_Projects'],
					files: [buildFile({})],
				}),
			);

			expect(selectedProjectTasks(library, ['missing'])).toEqual([]);
			expect(taskSelectionKey(undefined)).toBe('');
		});

		it('should expand selected parent tasks to their nested task tree', () => {
			const library = Effect.runSync(
				buildProjectLibrary({
					folders: ['04_Projects'],
					files: [
						buildFile({
							markdown: `---
Title: Nested
tavern: project
---
# Nested

## Backlog

- [ ] Parent task
  - [ ] Child task
    - [ ] Grandchild task
- [ ] Next task
`,
						}),
					],
				}),
			);
			const parentTask = projectTasks(library).find((task) => task.text === 'Parent task');

			expect(
				selectedProjectTasks(library, [taskSelectionKey(parentTask)]).map((task) => task.text),
			).toEqual(['Parent task', 'Child task', 'Grandchild task']);
		});
	});

	describe('filterTasks', () => {
		it('should fuzzy filter tasks across task text, section, and project metadata', () => {
			const library = Effect.runSync(
				buildProjectLibrary({
					folders: ['04_Projects'],
					files: [
						buildFile({}),
						buildFile({
							markdown: BLOGGING_MARKDOWN,
							path: '04_Projects/Blogging.md',
						}),
					],
				}),
			);

			expect(filterTasks(projectTasks(library), 'draft').map((task) => task.text)).toEqual([
				'Draft launch post',
			]);
			expect(filterTasks(projectTasks(library), 'blogging').map((task) => task.text)).toEqual([
				'Draft launch post',
			]);
			expect(filterTasks(projectTasks(library), 'backlog').map((task) => task.text)).toEqual([
				'Build board',
				'Draft launch post',
			]);
			expect(filterTasks(projectTasks(library), '').map((task) => task.text)).toEqual([
				'Draft launch post',
				'Wire library',
				'Build board',
				'Add parser',
			]);
		});

		it('should rank task text above section and project metadata matches', () => {
			const library = Effect.runSync(
				buildProjectLibrary({
					folders: ['04_Projects'],
					files: [
						buildFile({
							markdown: `---
Title: Work
tavern: project
---
# Work

## Priority

- [ ] Draft brief
`,
							path: '04_Projects/Work.md',
						}),
						buildFile({
							markdown: `---
Title: Draft
tavern: project
---
# Draft

## Backlog

- [ ] Review outline
`,
							path: '04_Projects/Content.md',
						}),
					],
				}),
			);

			expect(filterTasks(projectTasks(library), 'draft').map((task) => task.text)).toEqual([
				'Draft brief',
				'Review outline',
			]);
		});

		it('should not match short queries across arbitrary middle characters', () => {
			const library = Effect.runSync(
				buildProjectLibrary({
					folders: ['04_Projects'],
					files: [
						buildFile({
							markdown: `---
Title: Blogging
tavern: project
---
# Blogging

## Backlog

- [ ] Update site and notes with impeccable skill
`,
							path: '04_Projects/Blogging.md',
						}),
						buildFile({}),
					],
				}),
			);

			expect(filterTasks(projectTasks(library), 'pi').map((task) => task.text)).toEqual([
				'Add parser',
				'Build board',
				'Wire library',
			]);
		});

		it('should sort equal-score task matches by task text', () => {
			const library = Effect.runSync(
				buildProjectLibrary({
					folders: ['04_Projects'],
					files: [
						buildFile({
							markdown: `---
Title: Work
tavern: project
---
# Work

## Backlog

- [ ] Beta task
- [ ] Alpha task
`,
							path: '04_Projects/Work.md',
						}),
					],
				}),
			);

			expect(filterTasks(projectTasks(library), 'task').map((task) => task.text)).toEqual([
				'Alpha task',
				'Beta task',
			]);
		});
	});
});
