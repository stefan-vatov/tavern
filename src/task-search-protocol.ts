/* eslint-disable eslint/new-cap */
import { Schema } from 'effect';

const correlation = { epoch: Schema.Number, requestId: Schema.Number };
const searchCorrelation = {
	revision: Schema.Number,
	session: Schema.Number,
	generation: Schema.Number,
};
const searchTask = Schema.Struct({
	id: Schema.String,
	text: Schema.String,
	sectionName: Schema.String,
	projectTitle: Schema.String,
	projectPath: Schema.String,
	checked: Schema.Boolean,
});

const SearchRequestSchema = Schema.Union(
	Schema.Struct({ type: Schema.Literal('initialize'), ...correlation }),
	Schema.Struct({
		type: Schema.Literal('prepare'),
		...correlation,
		revision: Schema.Number,
		tasks: Schema.Array(searchTask),
	}),
	Schema.Struct({
		type: Schema.Literal('search'),
		...correlation,
		...searchCorrelation,
		query: Schema.String,
	}),
);
const SearchResponseSchema = Schema.Union(
	Schema.Struct({ type: Schema.Literal('ready'), ...correlation }),
	Schema.Struct({
		type: Schema.Literal('prepared'),
		...correlation,
		revision: Schema.Number,
		diagnostics: Schema.Struct({ prepareMs: Schema.Number, itemCount: Schema.Number }),
	}),
	Schema.Struct({
		type: Schema.Literal('results'),
		...correlation,
		...searchCorrelation,
		ids: Schema.Array(Schema.String),
		total: Schema.Number,
		diagnostics: Schema.Struct({ queryMs: Schema.Number, cacheHit: Schema.Boolean }),
	}),
	Schema.Struct({ type: Schema.Literal('failure'), ...correlation, message: Schema.String }),
);
export type WorkerRequest = typeof SearchRequestSchema.Type;
export type WorkerResponse = typeof SearchResponseSchema.Type;
export const decodeSearchRequest = Schema.decodeUnknownSync(SearchRequestSchema);
export const decodeSearchResponse = Schema.decodeUnknownSync(SearchResponseSchema);
