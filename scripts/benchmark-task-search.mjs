/* eslint-disable eslint/no-console, eslint/no-magic-numbers, eslint/max-statements */
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const built = await build({
	absWorkingDir: root,
	stdin: {
		contents:
			"export { TaskSearchIndex } from './src/task-search-index'; export { filterTasks } from './src/project-library';",
		resolveDir: root,
	},
	bundle: true,
	write: false,
	format: 'esm',
	platform: 'node',
	target: 'es2020',
});
const { TaskSearchIndex, filterTasks } = await import(
	`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].contents).toString('base64')}`
);
const tasks = Array.from({ length: 10000 }, (unusedValue, index) => ({
	id: `04_Projects/Group${index % 25}/Project${index % 125}.md::task-${index}`,
	text: `Launch project notes ${index} https://example.com/${'long/path/'.repeat(36)}?query=${index}&fragment=details`,
	sectionName: ['Backlog', 'Next Actions'][index % 2],
	projectTitle: `Project ${index % 125}`,
	projectPath: `04_Projects/Group${index % 25}/Project${index % 125}.md`,
	checked: false,
}));
const cases = {
	direct: 'launch project notes',
	acronym: 'lpn',
	noMatch: 'zzzz nowhere',
	url: 'https://example.com/long/path/long/path/long/path/',
};
const measurements = Object.fromEntries(Object.keys(cases).map((key) => [key, []]));
const reference = Object.fromEntries(Object.keys(cases).map((key) => [key, []]));
const preparation = [];
const cached = [];
for (let sample = 0; sample < 30; sample += 1) {
	const index = new TaskSearchIndex();
	preparation.push(index.prepare(sample, tasks).diagnostics.prepareMs);
	for (const [name, query] of Object.entries(cases)) {
		const result = index.search(sample, query);
		if (result.diagnostics.cacheHit) {
			throw new Error('Uncached benchmark unexpectedly hit cache.');
		}
		measurements[name].push(result.diagnostics.queryMs);
		const started = performance.now();
		const expected = filterTasks(tasks, query);
		reference[name].push(performance.now() - started);
		if (
			result.total !== expected.length ||
			JSON.stringify(result.ids) !== JSON.stringify(expected.slice(0, 50).map((task) => task.id))
		) {
			throw new Error(`Search behavior changed for ${name}.`);
		}
	}
	cached.push(index.search(sample, cases.direct).diagnostics.queryMs);
}
const stats = (values) => {
	const ordered = [...values].sort((left, right) => left - right);
	return {
		median: ordered[Math.floor(ordered.length / 2)],
		p95: ordered[Math.floor(ordered.length * 0.95)],
		max: Math.max(...values),
	};
};
console.log(
	JSON.stringify(
		{
			node: process.version,
			items: tasks.length,
			openItems: tasks.length,
			samples: 30,
			coldFirstPrepareMs: preparation[0],
			preparationMs: stats(preparation),
			processingMs: Object.fromEntries(
				Object.entries(measurements).map(([name, values]) => [name, stats(values)]),
			),
			referenceMs: Object.fromEntries(
				Object.entries(reference).map(([name, values]) => [name, stats(values)]),
			),
			cacheHitMs: stats(cached),
			limits:
				'Engine processing only. Excludes worker startup, transport, DOM, layout, paint and presentation. Timing is reported, not a machine-independent CI assertion.',
		},
		null,
		2,
	),
);
