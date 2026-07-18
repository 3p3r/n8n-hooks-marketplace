import { defineConfig } from 'tsup';

export default defineConfig({
	entry: ['src/backend/hooks.ts'],
	format: ['cjs'],
	outDir: 'dist/backend',
	outExtension: () => ({ js: '.cjs' }),
	platform: 'node',
	target: 'node20',
	clean: false,
	splitting: false,
	dts: false,
	sourcemap: true,
});
