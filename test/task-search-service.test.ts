/* eslint-disable eslint/func-style, eslint/no-magic-numbers, eslint/max-statements, promise/avoid-new */
import { createTaskSearchClient } from '../src/task-search-service';
import type { WorkerRequest, WorkerResponse } from '../src/task-search-protocol';

class ControlledWorker {
	onmessage: Worker['onmessage'] = null;
	onerror: Worker['onerror'] = null;
	onmessageerror: Worker['onmessageerror'] = null;
	readonly messages: WorkerRequest[] = [];
	terminated = false;
	postMessage(message: WorkerRequest): void {
		this.messages.push(message);
	}
	terminate(): void {
		this.terminated = true;
	}
	reply(response: WorkerResponse | unknown): void {
		this.onmessage?.call(this as unknown as Worker, { data: response } as MessageEvent);
	}
	request(type: WorkerRequest['type']): WorkerRequest {
		const request = [...this.messages].reverse().find((entry) => entry.type === type);
		if (!request) {
			throw new Error(`No ${type} request.`);
		}
		return request;
	}
	ready(): void {
		const request = this.request('initialize');
		this.reply({ type: 'ready', epoch: request.epoch, requestId: request.requestId });
	}
	prepared(revision: number): void {
		const request = this.request('prepare');
		this.reply({
			type: 'prepared',
			epoch: request.epoch,
			requestId: request.requestId,
			revision,
			diagnostics: { itemCount: 1, prepareMs: 2 },
		});
	}
	results(request: WorkerRequest, overrides: Partial<WorkerResponse> = {}): void {
		if (request.type !== 'search') {
			throw new Error('Expected search.');
		}
		this.reply({
			type: 'results',
			epoch: request.epoch,
			requestId: request.requestId,
			revision: request.revision,
			session: request.session,
			generation: request.generation,
			ids: ['project::a'],
			total: 1,
			diagnostics: { queryMs: 1, cacheHit: false },
			...overrides,
		});
	}
}
const search = { revision: 1, session: 2, generation: 3, query: 'task' };
const tasks = [
	{
		id: 'project::a',
		text: 'task',
		sectionName: 'Next',
		projectTitle: 'Project',
		projectPath: 'Project.md',
		checked: false,
	},
];
const tick = async (): Promise<void> => {
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
};

const fixture = (): {
	worker: ControlledWorker;
	client: ReturnType<typeof createTaskSearchClient>;
} => {
	const worker = new ControlledWorker();
	return { worker, client: createTaskSearchClient({ workerFactory: () => worker }) };
};

describe('scoped task search transport', () => {
	it('shares initialization and revision preparation, correlates out-of-order queries and releases its worker', async () => {
		const { worker, client } = fixture();
		try {
			const preparing = client.prepare(1, tasks);
			const duplicate = client.prepare(1, tasks);
			await tick();
			expect(worker.messages.map((message) => message.type)).toEqual(['initialize']);
			worker.ready();
			await tick();
			expect(worker.messages.filter((message) => message.type === 'prepare')).toHaveLength(1);
			worker.prepared(1);
			await expect(Promise.all([preparing, duplicate])).resolves.toHaveLength(2);
			const first = client.search(search);
			const second = client.search({ ...search, generation: 4 });
			await tick();
			const requests = worker.messages.filter((message) => message.type === 'search');
			worker.results(requests[1]!);
			worker.results(requests[0]!);
			await expect(first).resolves.toMatchObject({
				session: 2,
				generation: 3,
				revision: 1,
				ids: ['project::a'],
			});
			await expect(second).resolves.toMatchObject({ generation: 4 });
		} finally {
			await client.dispose();
		}
		expect(worker.terminated).toBe(true);
	});

	it('interrupts only a waiter and ignores its late reply while another query finishes', async () => {
		const { worker, client } = fixture();
		try {
			const controller = new AbortController();
			const first = client.search(search, controller.signal);
			const rejected = expect(first).rejects.toThrow();
			await tick();
			worker.ready();
			await tick();
			const oldRequest = worker.request('search');
			controller.abort();
			await rejected;
			expect(worker.terminated).toBe(false);
			const second = client.search({ ...search, generation: 4 });
			await tick();
			worker.results(oldRequest);
			worker.results(worker.request('search'));
			await expect(second).resolves.toMatchObject({ generation: 4 });
		} finally {
			await client.dispose();
		}
	});

	it.each(['schema', 'correlation', 'error', 'messageerror', 'post', 'failure'])(
		'rejects all worker waits on %s failure and permits an explicit retry',
		async (failure) => {
			const { worker, client } = fixture();
			try {
				const first = client.search(search);
				const rejectedFirst = expect(first).rejects.toThrow();
				await tick();
				worker.ready();
				await tick();
				const staleHandler = worker.onmessage;
				const staleRequest = worker.request('search');
				const second = client.search({ ...search, generation: 4 });
				const rejectedSecond = expect(second).rejects.toThrow();
				if (failure === 'post') {
					worker.postMessage = (): never => {
						throw new Error('Clone failed');
					};
				}
				await tick();
				if (failure === 'failure') {
					worker.reply({
						type: 'failure',
						epoch: staleRequest.epoch,
						requestId: staleRequest.requestId,
						message: 'Index failure',
					});
				}
				if (failure === 'schema') {
					worker.reply({ type: 'results', ids: 12 });
				}
				if (failure === 'correlation') {
					worker.results(staleRequest, { generation: 999 });
				}
				if (failure === 'error') {
					worker.onerror?.call(
						worker as unknown as Worker,
						{ message: 'Crashed', preventDefault: (): void => {} } as ErrorEvent,
					);
				}
				if (failure === 'messageerror') {
					worker.onmessageerror?.call(worker as unknown as Worker, {} as MessageEvent);
				}
				await Promise.all([rejectedFirst, rejectedSecond]);
				expect(worker.terminated).toBe(true);
				worker.postMessage = (message): void => {
					worker.messages.push(message);
				};
				const retried = client.retry();
				await tick();
				worker.ready();
				await retried;
				const next = client.search({ ...search, generation: 5 });
				await tick();
				if (staleRequest.type === 'search') {
					staleHandler?.call(
						worker as unknown as Worker,
						{
							data: {
								...staleRequest,
								type: 'results',
								ids: [],
								total: 0,
								diagnostics: { queryMs: 0, cacheHit: false },
							},
						} as MessageEvent,
					);
				}
				worker.results(worker.request('search'));
				await expect(next).resolves.toMatchObject({ generation: 5 });
			} finally {
				await client.dispose();
			}
		},
	);

	it('rejects pending initialization when its owning scope is disposed', async () => {
		const { worker, client } = fixture();
		const pending = client.prepare(1, tasks);
		const rejected = expect(pending).rejects.toThrow();
		await tick();
		await client.dispose();
		await rejected;
		expect(worker.terminated).toBe(true);
	});
});
