import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		globals: true,
		environment: 'node',
		setupFiles: ['./test/setup.ts'],
		exclude: [
			...configDefaults.exclude,
			'**/dist/**',
			'**/build/**',
			'**/coverage/**',
			'**/.next/**',
			'**/.nuxt/**',
			'**/out/**',
			'**/out-tsc/**',
		],
		coverage: {
			provider: 'v8',
			reporter: ['text', 'lcov', 'html'],
			thresholds: {
				branches: 85,
				functions: 85,
				lines: 85,
				statements: 85,
			},
			exclude: [
				...configDefaults.exclude,
				'test/**',
				'tests/**',
				'**/*.d.ts',
				'**/*.config.{js,mjs,cjs,ts,mts,cts}',
			],
		},
	},
});
