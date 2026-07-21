import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import aedes from 'aedes';
import ws from 'websocket-stream';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const hooksPath = path.join(repoRoot, 'dist/backend/hooks.cjs');
const n8nBin = path.join(repoRoot, 'node_modules/n8n/bin/n8n');
const userFolder = path.join(repoRoot, '.dev/n8n');

const n8nPort = Number(process.env.N8N_PORT ?? 5678);
const vitePort = Number(process.env.VITE_PORT ?? 5173);
const baseUrl = `http://127.0.0.1:${n8nPort}`;
const ecosystemAppUrl =
	process.env.ECOSYSTEM_APP_URL ?? `http://localhost:${vitePort}/rest/ecosystem/app/`;

let n8nProcess: ChildProcess | null = null;
let closeMqtt: (() => Promise<void>) | null = null;

function killProcessTree(pid: number, signal: NodeJS.Signals = 'SIGTERM'): void {
	if (!pid || pid <= 0) return;
	try {
		process.kill(-pid, signal);
	} catch {
		try {
			process.kill(pid, signal);
		} catch {
			// already exited
		}
	}
}

function getProcessEnviron(pid: number): string {
	try {
		return fs.readFileSync(`/proc/${pid}/environ`).toString('utf8');
	} catch {
		return '';
	}
}

async function cleanupDevProcesses(): Promise<void> {
	const devMarker = '.dev/n8n';
	const pids = new Set<number>();

	try {
		const output = execFileSync('pgrep', ['-af', n8nBin], {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
		});
		for (const line of output.split('\n')) {
			const pid = Number.parseInt(line.trim().split(/\s+/)[0] ?? '', 10);
			if (!Number.isFinite(pid) || pid <= 0 || pid === process.pid) continue;
			if (getProcessEnviron(pid).includes(devMarker)) {
				pids.add(pid);
			}
		}
	} catch {
		// no matching processes
	}

	for (const pid of pids) {
		killProcessTree(pid, 'SIGTERM');
	}

	if (pids.size === 0) return;
	await new Promise((resolve) => setTimeout(resolve, 1500));
}

async function getFreePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			if (!address || typeof address === 'string') {
				reject(new Error('Failed to allocate port'));
				return;
			}
			const { port } = address;
			server.close((error) => (error ? reject(error) : resolve(port)));
		});
	});
}

async function startMqttBroker(): Promise<{ url: string; close: () => Promise<void> }> {
	const tcpPort = await getFreePort();
	const wsPort = await getFreePort();
	const broker = aedes();
	const tcpServer = createServer(broker.handle);
	const httpServer = createHttpServer();
	ws.createServer({ server: httpServer }, broker.handle);

	await new Promise<void>((resolve) => tcpServer.listen(tcpPort, '127.0.0.1', resolve));
	await new Promise<void>((resolve) => httpServer.listen(wsPort, '127.0.0.1', resolve));

	return {
		url: `ws://127.0.0.1:${wsPort}`,
		close: () =>
			new Promise((resolve, reject) => {
				broker.close(() => {
					let pending = 2;
					const done = (error?: Error | null) => {
						if (error) {
							reject(error);
							return;
						}
						pending -= 1;
						if (pending === 0) resolve();
					};
					tcpServer.close(done);
					httpServer.close(done);
				});
			}),
	};
}

async function waitForHealth(timeoutMs = 180_000): Promise<void> {
	const started = Date.now();
	const endpoints = [
		`${baseUrl}/rest/ecosystem/config`,
		`${baseUrl}/healthz/readiness`,
		`${baseUrl}/healthz`,
	];
	while (Date.now() - started < timeoutMs) {
		for (const endpoint of endpoints) {
			try {
				const response = await fetch(endpoint);
				if (response.ok) return;
			} catch {
				// retry
			}
		}
		await new Promise((resolve) => setTimeout(resolve, 2000));
	}
	throw new Error(`Timed out waiting for n8n at ${baseUrl}`);
}

async function ensureOwnerSetup(): Promise<void> {
	const payload = {
		email: process.env.N8N_DEV_EMAIL ?? 'dev@example.com',
		firstName: 'Dev',
		lastName: 'User',
		password: process.env.N8N_DEV_PASSWORD ?? 'DevPassword123!',
	};

	const started = Date.now();
	while (Date.now() - started < 120_000) {
		const response = await fetch(`${baseUrl}/rest/owner/setup`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload),
		});
		if (response.ok) return;
		if (response.status === 400) return; // owner already exists
		if (response.status !== 404) {
			const text = await response.text();
			throw new Error(`Owner setup failed: ${response.status} ${text}`);
		}
		await new Promise((resolve) => setTimeout(resolve, 2000));
	}
}

async function shutdown(): Promise<void> {
	if (n8nProcess?.pid) {
		killProcessTree(n8nProcess.pid, 'SIGTERM');
		n8nProcess = null;
	}
	if (closeMqtt) {
		await closeMqtt().catch(() => undefined);
		closeMqtt = null;
	}
}

async function main(): Promise<void> {
	if (!fs.existsSync(hooksPath)) {
		throw new Error('Build output missing. Run npm run build first.');
	}
	if (!fs.existsSync(n8nBin)) {
		throw new Error(`n8n binary not found at ${n8nBin}`);
	}

	fs.mkdirSync(userFolder, { recursive: true });
	await cleanupDevProcesses();

	const mqttUrl = process.env.MQTT_BROKER_URL?.trim();
	let mqtt: { url: string; close: () => Promise<void> };
	if (mqttUrl) {
		mqtt = { url: mqttUrl, close: async () => undefined };
		console.log(`[dev] Using MQTT broker from MQTT_BROKER_URL: ${mqttUrl}`);
	} else {
		mqtt = await startMqttBroker();
		closeMqtt = mqtt.close;
		console.log(`[dev] Started local MQTT broker at ${mqtt.url}`);
	}

	const bridgeUrl = `${baseUrl}/rest/ecosystem/bridge.js`;
	const runnersBrokerPort = await getFreePort();

	n8nProcess = spawn('node', [n8nBin, 'start'], {
		cwd: repoRoot,
		env: {
			...process.env,
			N8N_HOST: '127.0.0.1',
			N8N_LISTEN_ADDRESS: '127.0.0.1',
			N8N_PORT: String(n8nPort),
			N8N_PROTOCOL: 'http',
			N8N_USER_FOLDER: userFolder,
			EXTERNAL_HOOK_FILES: hooksPath,
			EXTERNAL_FRONTEND_HOOKS_URLS: bridgeUrl,
			MQTT_BROKER_URL: mqtt.url,
			ECOSYSTEM_APP_URL: ecosystemAppUrl,
			N8N_DIAGNOSTICS_ENABLED: 'false',
			N8N_VERSION_NOTIFICATIONS_ENABLED: 'false',
			N8N_TEMPLATES_ENABLED: 'false',
			N8N_SECURE_COOKIE: 'false',
			N8N_EDITOR_BASE_URL: baseUrl,
			N8N_RUNNERS_BROKER_PORT: String(runnersBrokerPort),
			N8N_UNVERIFIED_PACKAGES_ENABLED: 'true',
			N8N_RUNNERS_TASK_TIMEOUT: '300',
			N8N_COMPRESSION_NODE_MAX_DECOMPRESSED_SIZE_BYTES: '2147483648',
			N8N_COMPRESSION_NODE_MAX_ZIP_ENTRIES: '5000',
		},
		stdio: 'inherit',
	});

	n8nProcess.on('exit', (code, signal) => {
		if (code !== 0 && code !== null) {
			console.error(`[dev] n8n exited code=${code} signal=${signal}`);
			process.exit(code ?? 1);
		}
	});

	process.once('SIGINT', () => {
		void shutdown().finally(() => process.exit(130));
	});
	process.once('SIGTERM', () => {
		void shutdown().finally(() => process.exit(143));
	});

	await waitForHealth();
	await ensureOwnerSetup();

	console.log('');
	console.log('[dev] n8n editor:', baseUrl);
	console.log('[dev] Ecosystem app (Vite):', ecosystemAppUrl);
	console.log('[dev] MQTT broker:', mqtt.url);
	console.log('[dev] Dev login:', process.env.N8N_DEV_EMAIL ?? 'dev@example.com');
	console.log('');
}

await main();
