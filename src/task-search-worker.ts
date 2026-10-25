/* eslint-disable eslint/no-ternary */
import { TaskSearchIndex } from './task-search-index';
import { decodeSearchRequest, type WorkerResponse } from './task-search-protocol';

const index = new TaskSearchIndex();
const worker = globalThis as unknown as {
	onmessage: (event: MessageEvent<unknown>) => void;
	postMessage: (message: WorkerResponse) => void;
};
worker.onmessage = (event): void => {
	const request = decodeSearchRequest(event.data);
	const correlation = { epoch: request.epoch, requestId: request.requestId };
	try {
		switch (request.type) {
			case 'initialize':
				worker.postMessage({ type: 'ready', ...correlation });
				break;
			case 'prepare':
				worker.postMessage({
					type: 'prepared',
					...correlation,
					...index.prepare(request.revision, request.tasks),
				});
				break;
			case 'search':
				worker.postMessage({
					type: 'results',
					...correlation,
					revision: request.revision,
					session: request.session,
					generation: request.generation,
					...index.search(request.revision, request.query),
				});
				break;
		}
	} catch (error) {
		worker.postMessage({
			type: 'failure',
			...correlation,
			message: error instanceof Error ? error.message : String(error),
		});
	}
};
