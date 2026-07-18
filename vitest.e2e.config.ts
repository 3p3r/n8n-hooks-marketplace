import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['test/e2e/marketplace.test.ts'],
		testTimeout: 30_000,
		fileParallelism: false,
	},
});
