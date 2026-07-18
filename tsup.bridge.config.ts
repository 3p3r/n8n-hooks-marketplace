import { defineConfig } from 'tsup';

export default defineConfig({
	entry: ['src/bridge/index.ts'],
	format: ['iife'],
	globalName: 'N8nEcosystemBridgeBundle',
	outDir: 'dist/bridge',
	outExtension: () => ({ js: '.js' }),
	platform: 'browser',
	target: 'es2020',
	clean: false,
	splitting: false,
	dts: false,
	sourcemap: true,
	minify: false,
});
