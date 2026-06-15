/* eslint-disable eslint/func-style, eslint/max-statements */
import { Effect } from 'effect';
import { projectTasks } from '../src/project-library';
import {
	addVaultProjectTask,
	completeVaultProjectTask,
	deleteVaultProjectTask,
	editVaultProjectTask,
	loadVaultProjectLibrary,
	moveVaultProjectTask,
	moveVaultProjectTaskToPosition,
	type ProjectVault,
} from '../src/project-vault';

const PROJECT_MARKDOWN = `---
Title: Pi
tavern: project
---
# Pi

## In Progress

- [ ] Wire vault

## Backlog

- [ ] Move me

## Done
`;

function buildVault(files: Record<string, string>): {
	files: Record<string, string>;
	vault: ProjectVault;
} {
	return {
		files,
		vault: {
			getMarkdownFiles: () => Object.keys(files).map((path) => ({ path })),
			modify: async (file, markdown) => {
				files[file.path] = markdown;
			},
			read: async (file) => files[file.path] ?? '',
		},
	};
}

describe('project vault adapter', () => {
	it('should load a project library from vault markdown files', async () => {
		const { vault } = buildVault({
			'04_Projects/Pi.md': PROJECT_MARKDOWN,
			'Notes/Other.md': PROJECT_MARKDOWN,
		});

		const library = await Effect.runPromise(loadVaultProjectLibrary(vault, ['04_Projects']));

		expect(library.projects.map((project) => project.path)).toEqual(['04_Projects/Pi.md']);
	});

	it('should complete a board task through vault modify', async () => {
		const { files, vault } = buildVault({
			'04_Projects/Pi.md': PROJECT_MARKDOWN,
		});
		const library = await Effect.runPromise(loadVaultProjectLibrary(vault, ['04_Projects']));
		const task = projectTasks(library).find((item) => item.text === 'Wire vault');

		await Effect.runPromise(completeVaultProjectTask(vault, task));

		expect(files['04_Projects/Pi.md']).toContain('## Done\n\n- [x] Wire vault');
	});

	it('should move a board task through vault modify', async () => {
		const { files, vault } = buildVault({
			'04_Projects/Pi.md': PROJECT_MARKDOWN,
		});
		const library = await Effect.runPromise(loadVaultProjectLibrary(vault, ['04_Projects']));
		const task = projectTasks(library).find((item) => item.text === 'Move me');

		await Effect.runPromise(moveVaultProjectTask(vault, task, 'In Progress'));

		expect(files['04_Projects/Pi.md']).toContain(
			'## In Progress\n\n- [ ] Wire vault\n- [ ] Move me',
		);
	});

	it('should move a board task to a target task position through vault modify', async () => {
		const { files, vault } = buildVault({
			'04_Projects/Pi.md': PROJECT_MARKDOWN,
		});
		const library = await Effect.runPromise(loadVaultProjectLibrary(vault, ['04_Projects']));
		const sourceTask = projectTasks(library).find((item) => item.text === 'Move me');
		const targetTask = projectTasks(library).find((item) => item.text === 'Wire vault');

		await Effect.runPromise(
			moveVaultProjectTaskToPosition({
				placement: 'before',
				sourceTask,
				targetTask,
				vault,
			}),
		);

		expect(files['04_Projects/Pi.md']).toContain(
			'## In Progress\n\n- [ ] Move me\n- [ ] Wire vault',
		);
	});

	it('should delete a board task through vault modify', async () => {
		const { files, vault } = buildVault({
			'04_Projects/Pi.md': PROJECT_MARKDOWN,
		});
		const library = await Effect.runPromise(loadVaultProjectLibrary(vault, ['04_Projects']));
		const task = projectTasks(library).find((item) => item.text === 'Move me');

		await Effect.runPromise(deleteVaultProjectTask(vault, task));

		expect(files['04_Projects/Pi.md']).not.toContain('Move me');
	});

	it('should edit a board task through vault modify', async () => {
		const { files, vault } = buildVault({
			'04_Projects/Pi.md': PROJECT_MARKDOWN,
		});
		const library = await Effect.runPromise(loadVaultProjectLibrary(vault, ['04_Projects']));
		const task = projectTasks(library).find((item) => item.text === 'Move me');

		await Effect.runPromise(editVaultProjectTask(vault, task, 'Move edited task'));

		expect(files['04_Projects/Pi.md']).toContain('- [ ] Move edited task');
		expect(files['04_Projects/Pi.md']).not.toContain('- [ ] Move me');
	});

	it('should add a task through vault modify', async () => {
		const { files, vault } = buildVault({
			'04_Projects/Pi.md': PROJECT_MARKDOWN,
		});

		await Effect.runPromise(
			addVaultProjectTask({
				projectPath: '04_Projects/Pi.md',
				sectionName: 'Backlog',
				taskText: 'Review vault inbox',
				vault,
			}),
		);

		expect(files['04_Projects/Pi.md']).toContain('- [ ] Move me\n- [ ] Review vault inbox');
	});

	it('should fail when adding a task to a missing project file', async () => {
		const { vault } = buildVault({
			'04_Projects/Pi.md': PROJECT_MARKDOWN,
		});

		const error = await Effect.runPromise(
			Effect.flip(
				addVaultProjectTask({
					projectPath: '04_Projects/Missing.md',
					sectionName: 'Backlog',
					taskText: 'Review',
					vault,
				}),
			),
		);

		expect(error.message).toBe('Project file was not found.');
	});

	it('should fail when reading a project file for task creation fails', async () => {
		const vault: ProjectVault = {
			getMarkdownFiles: () => [{ path: '04_Projects/Pi.md' }],
			modify: async () => {},
			read: async () => {
				throw new Error('read failed');
			},
		};

		const error = await Effect.runPromise(
			Effect.flip(
				addVaultProjectTask({
					projectPath: '04_Projects/Pi.md',
					sectionName: 'Backlog',
					taskText: 'Review',
					vault,
				}),
			),
		);

		expect(error.message).toBe('Unable to read project file.');
	});

	it('should fail when writing a project file for task creation fails', async () => {
		const vault: ProjectVault = {
			getMarkdownFiles: () => [{ path: '04_Projects/Pi.md' }],
			modify: async () => {
				throw new Error('write failed');
			},
			read: async () => PROJECT_MARKDOWN,
		};

		const error = await Effect.runPromise(
			Effect.flip(
				addVaultProjectTask({
					projectPath: '04_Projects/Pi.md',
					sectionName: 'Backlog',
					taskText: 'Review',
					vault,
				}),
			),
		);

		expect(error.message).toBe('Unable to write project file.');
	});

	it('should fail when completing an unavailable task', async () => {
		const { vault } = buildVault({
			'04_Projects/Pi.md': PROJECT_MARKDOWN,
		});

		const error = await Effect.runPromise(Effect.flip(completeVaultProjectTask(vault, undefined)));

		expect(error.message).toBe('Task was not provided.');
	});

	it('should fail when positioned move tasks are missing or from different projects', async () => {
		const { vault } = buildVault({
			'04_Projects/Pi.md': PROJECT_MARKDOWN,
			'04_Projects/Other.md': PROJECT_MARKDOWN.replace('Title: Pi', 'Title: Other'),
		});
		const library = await Effect.runPromise(loadVaultProjectLibrary(vault, ['04_Projects']));
		const sourceTask = projectTasks(library).find(
			(item) => item.projectTitle === 'Pi' && item.text === 'Wire vault',
		);
		const otherTask = projectTasks(library).find(
			(item) => item.projectTitle === 'Other' && item.text === 'Move me',
		);

		const missingError = await Effect.runPromise(
			Effect.flip(
				moveVaultProjectTaskToPosition({
					placement: 'after',
					sourceTask: undefined,
					targetTask: sourceTask,
					vault,
				}),
			),
		);
		const crossProjectError = await Effect.runPromise(
			Effect.flip(
				moveVaultProjectTaskToPosition({
					placement: 'after',
					sourceTask,
					targetTask: otherTask,
					vault,
				}),
			),
		);

		expect(missingError.message).toBe('Task was not provided.');
		expect(crossProjectError.message).toBe('Tasks must belong to the same project.');
	});

	it('should fail when the task source file is missing', async () => {
		const { vault } = buildVault({
			'04_Projects/Pi.md': PROJECT_MARKDOWN,
		});
		const library = await Effect.runPromise(loadVaultProjectLibrary(vault, ['04_Projects']));
		const task = projectTasks(library).find((item) => item.text === 'Wire vault');

		if (task) {
			task.projectPath = '04_Projects/Missing.md';
		}

		const error = await Effect.runPromise(Effect.flip(completeVaultProjectTask(vault, task)));

		expect(error.message).toBe('Project file was not found.');
		if (!('path' in error)) {
			throw new Error('expected vault error');
		}
		expect(error.path).toBe('04_Projects/Missing.md');
	});

	it('should fail when reading a project file fails', async () => {
		const vault: ProjectVault = {
			getMarkdownFiles: () => [{ path: '04_Projects/Pi.md' }],
			modify: async () => {},
			read: async () => {
				throw new Error('read failed');
			},
		};

		// Graceful degradation for reads (fix for whole-board poisoning on any md read error): load now succeeds with empty projects instead of flipping a read error.
		// (Action-level reads in updateProjectSource still fail as before for task ops on unreadable files.)
		const library = await Effect.runPromise(loadVaultProjectLibrary(vault, ['04_Projects']));
		expect(library.projects).toEqual([]);
	});

	it('should fail when writing a project file fails', async () => {
		const vault: ProjectVault = {
			getMarkdownFiles: () => [{ path: '04_Projects/Pi.md' }],
			modify: async () => {
				throw new Error('write failed');
			},
			read: async () => PROJECT_MARKDOWN,
		};
		const library = await Effect.runPromise(loadVaultProjectLibrary(vault, ['04_Projects']));
		const task = projectTasks(library).find((item) => item.text === 'Wire vault');

		const error = await Effect.runPromise(Effect.flip(completeVaultProjectTask(vault, task)));

		expect(error.message).toBe('Unable to write project file.');
		if (!('path' in error)) {
			throw new Error('expected vault error');
		}
		expect(error.path).toBe('04_Projects/Pi.md');
	});

	// TDD confirmation for p5 vault path lookup residual (normalize to handle trailing /, \, etc vs stored projectPath)
	// Regression test for Pass 5 fixed issue C1 (vault path lookup now normalizes like library to handle trailing /, \, etc vs stored projectPath from previous load): prevents regression of "file not found" on external rename/move or normalization variance during actions.
	it('should succeed for actions even if the projectPath has different normalization (e.g. trailing slash) than the current vault file list', async () => {
		const vault: ProjectVault = {
			getMarkdownFiles: () => [{ path: '04_Projects/Pi.md/' }], // trailing / (common variance)
			modify: vi.fn(async () => {}), // spy + returns promise so tryPromise succeeds and .toHaveBeenCalled works
			read: async () => PROJECT_MARKDOWN,
		};
		const library = await Effect.runPromise(loadVaultProjectLibrary(vault, ['04_Projects']));
		const task = projectTasks(library).find((item) => item.text === 'Wire vault')!;
		// simulate task/projectPath from previous load with clean path (without trailing)
		const taskWithCleanPath = { ...task, projectPath: '04_Projects/Pi.md' };
		await Effect.runPromise(completeVaultProjectTask(vault, taskWithCleanPath));
		expect(vault.modify).toHaveBeenCalled();
	});
});
