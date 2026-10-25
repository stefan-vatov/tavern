/* eslint-disable eslint/func-style, eslint/no-magic-numbers, eslint/no-ternary, eslint/max-statements, eslint/init-declarations, eslint/new-cap, promise/avoid-new, promise/prefer-await-to-then */
import { Context, Effect, Layer, ManagedRuntime } from 'effect';
import type { PrepareResult, SearchMatches, SearchTask } from './task-search-index';
import {
	decodeSearchResponse,
	type WorkerRequest,
	type WorkerResponse,
} from './task-search-protocol';

type SearchRequest = { session: number; generation: number; revision: number; query: string };
type SearchResult = SearchMatches & Pick<SearchRequest, 'session' | 'generation' | 'revision'>;
type TaskSearchWorker = Pick<
	Worker,
	'postMessage' | 'terminate' | 'onmessage' | 'onerror' | 'onmessageerror'
>;
type TaskSearchClient = {
	prepare: (revision: number, tasks: readonly SearchTask[]) => Promise<PrepareResult>;
	search: (request: SearchRequest, signal?: AbortSignal) => Promise<SearchResult>;
	retry: () => Promise<void>;
	dispose: () => Promise<void>;
};

type Pending = {
	request: WorkerRequest;
	resolve: (response: WorkerResponse) => void;
	reject: (error: Error) => void;
};
const asError = (error: unknown): Error =>
	error instanceof Error ? error : new Error(String(error));
const browserWorker = (): TaskSearchWorker => {
	const url = URL.createObjectURL(
		new Blob([__TAVERN_SEARCH_WORKER_SOURCE__], { type: 'text/javascript' }),
	);
	try {
		return new Worker(url);
	} finally {
		URL.revokeObjectURL(url);
	}
};

class SearchTransport {
	private worker: TaskSearchWorker | undefined;
	private epoch = 0;
	private requestId = 0;
	private readonly pending = new Map<number, Pending>();
	private ready: Promise<void> | undefined;
	private prepared: { revision: number; promise: Promise<PrepareResult> } | undefined;
	private failure: Error | undefined;
	private disposed = false;

	constructor(private readonly factory: () => TaskSearchWorker) {}

	private initialize(): Promise<void> {
		if (this.disposed) {
			return Promise.reject(new Error('Task search is closed.'));
		}
		if (this.failure) {
			return Promise.reject(this.failure);
		}
		if (this.ready) {
			return this.ready;
		}
		this.epoch += 1;
		try {
			const worker = this.factory();
			this.worker = worker;
			worker.onmessage = (event): void => this.receive(event.data);
			worker.onerror = (event): void => {
				event.preventDefault();
				this.fail(new Error(event.message || 'Task search worker failed.'));
			};
			worker.onmessageerror = (): void =>
				this.fail(new Error('Task search worker message could not be read.'));
			this.ready = this.send({
				type: 'initialize',
				epoch: this.epoch,
				requestId: ++this.requestId,
			}).then(() => undefined);
		} catch (error) {
			this.fail(asError(error));
			this.ready = Promise.reject(asError(error));
		}
		return this.ready;
	}

	async prepare(revision: number, tasks: readonly SearchTask[]): Promise<PrepareResult> {
		if (this.prepared?.revision === revision) {
			return this.prepared.promise;
		}
		const promise = this.initialize().then(async () => {
			const response = await this.send({
				type: 'prepare',
				epoch: this.epoch,
				requestId: ++this.requestId,
				revision,
				tasks,
			});
			if (response.type !== 'prepared') {
				throw new Error('Unexpected task search preparation response.');
			}
			return { revision: response.revision, diagnostics: response.diagnostics };
		});
		this.prepared = { revision, promise };
		return promise;
	}

	async search(request: SearchRequest, signal: AbortSignal): Promise<SearchResult> {
		await this.initialize();
		if (signal.aborted) {
			throw new Error('Task search wait interrupted.');
		}
		const response = await this.send(
			{ type: 'search', epoch: this.epoch, requestId: ++this.requestId, ...request },
			signal,
		);
		if (response.type !== 'results') {
			throw new Error('Unexpected task search result response.');
		}
		return {
			session: response.session,
			generation: response.generation,
			revision: response.revision,
			ids: [...response.ids],
			total: response.total,
			diagnostics: response.diagnostics,
		};
	}

	async retry(): Promise<void> {
		if (this.disposed) {
			throw new Error('Task search is closed.');
		}
		this.stop(new Error('Task search restarted.'));
		this.failure = undefined;
		this.ready = undefined;
		this.prepared = undefined;
		await this.initialize();
	}

	dispose(): void {
		this.disposed = true;
		this.stop(new Error('Task search is closed.'));
	}

	private send(request: WorkerRequest, signal?: AbortSignal): Promise<WorkerResponse> {
		return new Promise((resolve, reject) => {
			if (this.failure || !this.worker) {
				reject(this.failure ?? new Error('Task search worker is unavailable.'));
				return;
			}
			const interrupted = (): void => {
				this.pending.delete(request.requestId);
				reject(new Error('Task search wait interrupted.'));
			};
			const cleanup = (): void => signal?.removeEventListener('abort', interrupted);
			this.pending.set(request.requestId, {
				request,
				resolve: (response): void => {
					cleanup();
					resolve(response);
				},
				reject: (error): void => {
					cleanup();
					reject(error);
				},
			});
			signal?.addEventListener('abort', interrupted, { once: true });
			try {
				this.worker.postMessage(request);
			} catch (error) {
				this.fail(asError(error));
			}
		});
	}

	private receive(data: unknown): void {
		let response: WorkerResponse;
		try {
			response = decodeSearchResponse(data);
		} catch {
			this.fail(new Error('Task search worker sent an invalid response.'));
			return;
		}
		if (response.epoch !== this.epoch) {
			return;
		}
		const pending = this.pending.get(response.requestId);
		if (!pending) {
			return;
		}
		const { request } = pending;
		const valid =
			response.type === 'failure' ||
			(request.type === 'initialize' && response.type === 'ready') ||
			(request.type === 'prepare' &&
				response.type === 'prepared' &&
				request.revision === response.revision) ||
			(request.type === 'search' &&
				response.type === 'results' &&
				request.revision === response.revision &&
				request.session === response.session &&
				request.generation === response.generation);
		if (!valid) {
			this.fail(new Error('Task search worker response did not match its request.'));
			return;
		}
		if (response.type === 'failure') {
			this.fail(new Error(response.message));
			return;
		}
		this.pending.delete(response.requestId);
		pending.resolve(response);
	}

	private fail(error: Error): void {
		this.failure = error;
		this.stop(error);
	}

	private stop(error: Error): void {
		if (this.worker) {
			this.worker.onmessage = null;
			this.worker.onerror = null;
			this.worker.onmessageerror = null;
			this.worker.terminate();
			this.worker = undefined;
		}
		for (const pending of this.pending.values()) {
			pending.reject(error);
		}
		this.pending.clear();
	}
}

class SearchService extends Context.Tag('tavern/TaskSearch')<SearchService, SearchTransport>() {}

const createTaskSearchClient = (
	options: { workerFactory?: () => TaskSearchWorker } = {},
): TaskSearchClient => {
	const layer = Layer.scoped(
		SearchService,
		Effect.acquireRelease(
			Effect.sync(() => new SearchTransport(options.workerFactory ?? browserWorker)),
			(transport) => Effect.sync(() => transport.dispose()),
		),
	);
	const runtime = ManagedRuntime.make(layer);
	const run = <Result>(
		operation: (transport: SearchTransport, signal: AbortSignal) => Promise<Result>,
		signal?: AbortSignal,
	): Promise<Result> =>
		runtime.runPromise(
			Effect.flatMap(SearchService, (transport) =>
				Effect.tryPromise({
					try: (effectSignal) => operation(transport, effectSignal),
					catch: asError,
				}),
			),
			{ signal },
		);
	return {
		prepare: (revision, tasks) => run((transport) => transport.prepare(revision, tasks)),
		search: (request, signal) =>
			run((transport, effectSignal) => transport.search(request, effectSignal), signal),
		retry: () => run((transport) => transport.retry()),
		dispose: () => runtime.dispose(),
	};
};

export { createTaskSearchClient, type TaskSearchClient, type SearchRequest, type SearchResult };
