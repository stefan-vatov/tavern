/* eslint-disable eslint/func-style, eslint/no-magic-numbers, eslint/no-ternary, eslint/max-statements, eslint/no-continue */
type SearchTask = {
	id: string;
	text: string;
	sectionName: string;
	projectTitle: string;
	projectPath: string;
	checked: boolean;
};

type PreparedField = { value: string; acronym: string };
type PreparedTask = {
	id: string;
	text: PreparedField;
	section: PreparedField;
	title: PreparedField;
	path: PreparedField;
};

type SearchMatches = {
	ids: string[];
	total: number;
	diagnostics: { queryMs: number; cacheHit: boolean };
};
type PrepareResult = {
	revision: number;
	diagnostics: { prepareMs: number; itemCount: number };
};

const RESULT_LIMIT = 50;
const CACHE_LIMIT = 64;
const normalize = (value: string): string =>
	value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
const prepareField = (text: string): PreparedField => {
	const value = normalize(text);
	return {
		value,
		acronym: value
			.split(' ')
			.map((word) => word[0] ?? '')
			.join(''),
	};
};
const score = (field: PreparedField, query: string): number => {
	if (field.value.includes(query)) {
		return query.length + 20;
	}
	return field.acronym.includes(query) ? query.length + 15 : 0;
};

class TaskSearchIndex {
	private revision: number | undefined;
	private tasks: PreparedTask[] = [];
	private emptyIds: string[] = [];
	private total = 0;
	private readonly cache = new Map<string, { ids: string[]; total: number }>();
	private prepared: PrepareResult | undefined;

	prepare(revision: number, tasks: readonly SearchTask[]): PrepareResult {
		if (this.revision === revision && this.prepared) {
			return this.prepared;
		}
		const started = performance.now();
		const open = tasks.filter((task) => !task.checked);
		this.emptyIds = open.slice(0, RESULT_LIMIT).map((task) => task.id);
		this.total = open.length;
		// Sorting once preserves locale ordering and stable input ties for every score bucket.
		this.tasks = open
			.map((task, order) => ({ task, order }))
			.sort(
				(left, right) => left.task.text.localeCompare(right.task.text) || left.order - right.order,
			)
			.map(({ task }) => ({
				id: task.id,
				text: prepareField(task.text),
				section: prepareField(task.sectionName),
				title: prepareField(task.projectTitle),
				path: prepareField(task.projectPath),
			}));
		this.cache.clear();
		this.revision = revision;
		this.prepared = {
			revision,
			diagnostics: { prepareMs: performance.now() - started, itemCount: this.total },
		};
		return this.prepared;
	}

	search(revision: number, query: string): SearchMatches {
		if (this.revision !== revision) {
			throw new Error('Task search revision is not prepared.');
		}
		const started = performance.now();
		const normalized = normalize(query);
		const cached = this.cache.get(normalized);
		if (cached) {
			this.cache.delete(normalized);
			this.cache.set(normalized, cached);
			return {
				...cached,
				ids: [...cached.ids],
				diagnostics: { queryMs: performance.now() - started, cacheHit: true },
			};
		}
		const matches =
			normalized === '' ? { ids: this.emptyIds, total: this.total } : this.find(normalized);
		this.cache.set(normalized, matches);
		if (this.cache.size > CACHE_LIMIT) {
			this.cache.delete(this.cache.keys().next().value!);
		}
		return {
			...matches,
			ids: [...matches.ids],
			diagnostics: { queryMs: performance.now() - started, cacheHit: false },
		};
	}

	private find(query: string): { ids: string[]; total: number } {
		const buckets = new Map<number, string[]>();
		let total = 0;
		for (const task of this.tasks) {
			const value =
				score(task.text, query) * 3 +
				score(task.section, query) +
				Math.max(score(task.title, query), score(task.path, query));
			if (value === 0) {
				continue;
			}
			total += 1;
			let bucket = buckets.get(value);
			if (!bucket) {
				bucket = [];
				buckets.set(value, bucket);
			}
			if (bucket.length < RESULT_LIMIT) {
				bucket.push(task.id);
			}
		}
		const ids: string[] = [];
		for (const value of [...buckets.keys()].sort((left, right) => right - left)) {
			for (const id of buckets.get(value)!) {
				ids.push(id);
				if (ids.length === RESULT_LIMIT) {
					return { ids, total };
				}
			}
		}
		return { ids, total };
	}
}

export { TaskSearchIndex, type SearchTask, type SearchMatches, type PrepareResult };
