import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const n8nPort = process.env.N8N_PORT ?? '5678';

export default defineConfig({
	plugins: [react()],
	root: path.resolve(__dirname, 'src/app'),
	base: '/rest/ecosystem/app/',
	build: {
		outDir: path.resolve(__dirname, 'dist/app'),
		emptyOutDir: true,
	},
	server: {
		port: 5173,
		strictPort: true,
		proxy: {
			'/rest': {
				target: `http://127.0.0.1:${n8nPort}`,
				changeOrigin: true,
			},
		},
	},
});
