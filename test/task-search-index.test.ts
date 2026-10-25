/* eslint-disable eslint/func-style, eslint/no-magic-numbers, eslint/id-length, eslint/no-ternary */
import { filterTasks, type ProjectBoardTask } from '../src/project-library';
import { TaskSearchIndex, type SearchTask } from '../src/task-search-index';

const task = (id: string, overrides: Partial<SearchTask> = {}): SearchTask & ProjectBoardTask => ({
	id,
	text: 'Build board',
	sectionName: 'Next Actions',
	projectTitle: 'My Project',
	projectPath: '04_Projects/My Project.md',
	checked: false,
	indent: '',
	lineIndex: 0,
	...overrides,
});

describe('prepared task search', () => {
	it('preserves legacy normalization, scoring, ordering, open-task filtering and the 50-row result bound', () => {
		const tasks = Array.from({ length: 140 }, (_, index) =>
			task(String(index), {
				text: [
					'Build board',
					'B B',
					'Élan 東京',
					'build-board!',
					'Same text',
					'same text',
					'https://example.com/Some_Path?a=1#fragment',
					'İstanbul ﬃ ９',
				][index % 8]!,
				sectionName: index % 3 === 0 ? 'Build board' : 'Next Actions',
				projectTitle: index % 5 === 0 ? 'Build board' : 'My Project',
				projectPath: index % 7 === 0 ? 'Build/board.md' : '04_Projects/My Project.md',
				checked: index % 11 === 0,
			}),
		);
		const index = new TaskSearchIndex();
		index.prepare(1, tasks);
		for (const query of [
			'',
			'  ',
			'!!!',
			'東京',
			'B',
			' bB ',
			'build',
			'BOARD!',
			'next actions',
			'na',
			'my',
			'mp',
			'04',
			'https://EXAMPLE.com/',
			'elan',
			'İ',
			'ﬃ',
			'９',
			'no match at all',
		]) {
			const legacy = filterTasks(
				tasks.filter((entry) => !entry.checked),
				query,
			);
			const result = index.search(1, query);
			expect({ ids: result.ids, total: result.total }, query).toEqual({
				ids: legacy.slice(0, 50).map((entry) => entry.id),
				total: legacy.length,
			});
		}
	});

	it('invalidates prepared fields and cached matches after a mutable snapshot advances revision', () => {
		const tasks = [task('a'), task('b', { text: 'Other' })];
		const index = new TaskSearchIndex();
		index.prepare(1, tasks);
		expect(index.search(1, 'build').ids).toEqual(['a']);
		expect(index.search(1, 'BUILD!').diagnostics.cacheHit).toBe(true);
		tasks[0]!.text = 'Renamed';
		tasks[1]!.text = 'Build board';
		index.prepare(2, tasks);
		expect(index.search(2, 'build')).toMatchObject({
			ids: ['b'],
			total: 1,
			diagnostics: { cacheHit: false },
		});
		expect(() => index.search(1, 'build')).toThrow('revision');
	});

	it('bounds the query cache and keeps cached result IDs private', () => {
		const index = new TaskSearchIndex();
		index.prepare(1, [task('a')]);
		index.search(1, 'build').ids.length = 0;
		expect(index.search(1, 'build').ids).toEqual(['a']);
		for (let query = 0; query < 64; query += 1) {
			index.search(1, `missing ${query}`);
		}
		expect(index.search(1, 'build').diagnostics.cacheHit).toBe(false);
	});
});
