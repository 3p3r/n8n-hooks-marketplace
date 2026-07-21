import { type ChildProcess, type SpawnOptions, spawn } from 'node:child_process';
import fs from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import aedes from 'aedes';
import ws from 'websocket-stream';
import type { N8nWorkflow } from '../../src/shared/index';
import {
	cleanupOrphanE2eProcesses,
	killProcessTree,
	registerE2ePid,
	waitForProcessExit,
} from './cleanup';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../../..');
const hooksPath = path.join(repoRoot, 'dist/backend/hooks.cjs');
const screenshotsDir = path.join(repoRoot, 'test/e2e/screenshots');
const templateDir = path.join(repoRoot, 'test/e2e/.tmp/template');
const nodeBin = 'node';
const n8nBin = path.join(repoRoot, 'node_modules/n8n/bin/n8n');

export type N8nInstance = {
	name: string;
	port: number;
	baseUrl: string;
	userFolder: string;
	process: ChildProcess;
	cookie: string;
	logStream: fs.WriteStream;
};

export type Harness = {
	mqttUrl: string;
	instanceA: N8nInstance;
	instanceB: N8nInstance;
	stop: () => Promise<void>;
};

function spawnInProcessGroup(command: string, args: string[], options: SpawnOptions): ChildProcess {
	return spawn(command, args, {
		...options,
		detached: process.platform !== 'win32',
	});
}

async function stopN8nInstance(instance: N8nInstance): Promise<void> {
	const { process: child, logStream } = instance;
	if (child.pid) {
		killProcessTree(child.pid, 'SIGTERM');
		await waitForProcessExit(child.pid);
	}
	logStream.end();
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
			server.close((error) => {
				if (error) reject(error);
				else resolve(port);
			});
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
		// Browsers only speak MQTT over WebSocket; Node mqtt.js accepts ws:// as well.
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

async function waitForHealth(baseUrl: string, timeoutMs = 180_000): Promise<void> {
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

function extractCookie(response: Response): string {
	const header = response.headers.get('set-cookie');
	if (!header) throw new Error('Missing session cookie from n8n');
	return header.split(';')[0] ?? header;
}

async function setupOwner(baseUrl: string, label: string): Promise<string> {
	const payload = {
		email: `${label}@example.com`,
		firstName: label,
		lastName: 'Tester',
		password: 'TestPassword123!',
	};
	const started = Date.now();
	while (Date.now() - started < 120_000) {
		const response = await fetch(`${baseUrl}/rest/owner/setup`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload),
		});
		if (response.ok) {
			return extractCookie(response);
		}
		if (response.status !== 404) {
			const text = await response.text();
			throw new Error(`Owner setup failed for ${label}: ${response.status} ${text}`);
		}
		await new Promise((resolve) => setTimeout(resolve, 2000));
	}
	throw new Error(`Timed out waiting for owner setup on ${label}`);
}

async function createWorkflow(
	baseUrl: string,
	cookie: string,
	workflow: N8nWorkflow,
): Promise<string> {
	const response = await fetch(`${baseUrl}/rest/workflows`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Cookie: cookie,
		},
		body: JSON.stringify({
			name: workflow.name,
			nodes: workflow.nodes,
			connections: workflow.connections ?? {},
			settings: workflow.settings ?? {},
		}),
	});
	if (!response.ok) {
		const text = await response.text();
		throw new Error(`Workflow create failed: ${response.status} ${text}`);
	}
	const body = (await response.json()) as { id: string };
	return body.id;
}

function copyTemplate(targetDir: string): void {
	fs.rmSync(targetDir, { recursive: true, force: true });
	fs.cpSync(templateDir, targetDir, { recursive: true });
	for (const suffix of ['-wal', '-shm']) {
		const file = path.join(targetDir, '.n8n', `database.sqlite${suffix}`);
		if (fs.existsSync(file)) fs.rmSync(file);
	}
}

async function killExistingN8n(): Promise<void> {
	await cleanupOrphanE2eProcesses();
}

async function ensureTemplateDatabase(): Promise<void> {
	if (fs.existsSync(path.join(templateDir, '.n8n', 'database.sqlite'))) {
		return;
	}

	fs.rmSync(templateDir, { recursive: true, force: true });
	fs.mkdirSync(templateDir, { recursive: true });

	const port = await getFreePort();
	const baseUrl = `http://127.0.0.1:${port}`;
	const child = spawnInProcessGroup(nodeBin, [n8nBin, 'start'], {
		cwd: repoRoot,
		env: {
			...process.env,
			N8N_HOST: '127.0.0.1',
			N8N_LISTEN_ADDRESS: '127.0.0.1',
			N8N_PORT: String(port),
			N8N_PROTOCOL: 'http',
			N8N_USER_FOLDER: templateDir,
			N8N_DIAGNOSTICS_ENABLED: 'false',
			N8N_VERSION_NOTIFICATIONS_ENABLED: 'false',
			N8N_TEMPLATES_ENABLED: 'false',
			N8N_SECURE_COOKIE: 'false',
			N8N_UNVERIFIED_PACKAGES_ENABLED: 'true',
			N8N_RUNNERS_TASK_TIMEOUT: '300',
			N8N_COMPRESSION_NODE_MAX_DECOMPRESSED_SIZE_BYTES: '2147483648',
			N8N_COMPRESSION_NODE_MAX_ZIP_ENTRIES: '5000',
		},
		stdio: 'ignore',
	});

	await waitForHealth(baseUrl);
	if (child.pid) {
		registerE2ePid(child.pid);
		killProcessTree(child.pid, 'SIGTERM');
		await waitForProcessExit(child.pid);
	}
}

async function spawnN8n(
	name: string,
	port: number,
	brokerPort: number,
	mqttUrl: string,
): Promise<N8nInstance> {
	await ensureTemplateDatabase();

	if (!fs.existsSync(n8nBin)) {
		throw new Error(`n8n binary not found at ${n8nBin} (repoRoot=${repoRoot})`);
	}

	const userFolder = path.join(repoRoot, 'test/e2e/.tmp', name);
	copyTemplate(userFolder);

	const baseUrl = `http://127.0.0.1:${port}`;
	const bridgeUrl = `${baseUrl}/rest/ecosystem/bridge.js`;
	const logPath = path.join(userFolder, 'n8n.log');
	const logStream = fs.createWriteStream(logPath, { flags: 'a' });

	const child = spawnInProcessGroup(nodeBin, [n8nBin, 'start'], {
		cwd: repoRoot,
		env: {
			...process.env,
			PATH: `${path.join(repoRoot, 'node_modules/.bin')}:${process.env.PATH ?? ''}`,
			N8N_HOST: '127.0.0.1',
			N8N_LISTEN_ADDRESS: '127.0.0.1',
			N8N_PORT: String(port),
			N8N_PROTOCOL: 'http',
			N8N_USER_FOLDER: userFolder,
			EXTERNAL_HOOK_FILES: hooksPath,
			EXTERNAL_FRONTEND_HOOKS_URLS: bridgeUrl,
			MQTT_BROKER_URL: mqttUrl,
			N8N_DIAGNOSTICS_ENABLED: 'false',
			N8N_VERSION_NOTIFICATIONS_ENABLED: 'false',
			N8N_TEMPLATES_ENABLED: 'false',
			N8N_SECURE_COOKIE: 'false',
			N8N_EDITOR_BASE_URL: baseUrl,
			N8N_RUNNERS_BROKER_PORT: String(brokerPort),
			N8N_UNVERIFIED_PACKAGES_ENABLED: 'true',
			N8N_RUNNERS_TASK_TIMEOUT: '300',
			N8N_COMPRESSION_NODE_MAX_DECOMPRESSED_SIZE_BYTES: '2147483648',
			N8N_COMPRESSION_NODE_MAX_ZIP_ENTRIES: '5000',
			ECOSYSTEM_APP_URL: '',
		},
		stdio: ['ignore', 'pipe', 'pipe'],
	});

	child.on('error', (error) => {
		console.error(`[${name}] spawn error`, error);
	});

	if (child.pid) {
		registerE2ePid(child.pid);
	}

	child.stdout?.on('data', (chunk) => {
		logStream.write(chunk);
		process.stderr.write(`[${name}] ${chunk}`);
	});
	child.stderr?.on('data', (chunk) => {
		logStream.write(chunk);
		process.stderr.write(`[${name}] ${chunk}`);
	});

	child.on('exit', (code, signal) => {
		if (code !== 0) {
			console.error(`[${name}] n8n exited code=${code} signal=${signal}`);
			console.error(fs.readFileSync(logPath, 'utf8').slice(-4000));
		}
	});

	await waitForHealth(baseUrl);
	const cookie = await setupOwner(baseUrl, name);

	const settingsCheck = await fetch(`${baseUrl}/rest/settings`, {
		headers: { Cookie: cookie },
	});
	if (!settingsCheck.ok) {
		throw new Error(`Auth check failed for ${name}: ${settingsCheck.status}`);
	}

	return { name, port, baseUrl, userFolder, process: child, cookie, logStream };
}

export async function startHarness(
	seedA: N8nWorkflow,
	seedB: N8nWorkflow,
	nonSkillA: N8nWorkflow,
	nonSkillB: N8nWorkflow,
): Promise<Harness> {
	if (!fs.existsSync(hooksPath)) {
		throw new Error('Build output missing. Run npm run build first.');
	}

	await killExistingN8n();

	fs.mkdirSync(screenshotsDir, { recursive: true });

	const mqtt = await startMqttBroker();
	const portA = await getFreePort();
	const portB = await getFreePort();
	const brokerA = await getFreePort();
	const brokerB = await getFreePort();

	const instanceA = await spawnN8n('instance-a', portA, brokerA, mqtt.url);
	const instanceB = await spawnN8n('instance-b', portB, brokerB, mqtt.url);

	await createWorkflow(instanceA.baseUrl, instanceA.cookie, seedA);
	await createWorkflow(instanceA.baseUrl, instanceA.cookie, nonSkillA);
	await createWorkflow(instanceB.baseUrl, instanceB.cookie, seedB);
	await createWorkflow(instanceB.baseUrl, instanceB.cookie, nonSkillB);

	const stop = async () => {
		await Promise.all([stopN8nInstance(instanceA), stopN8nInstance(instanceB)]);
		await mqtt.close();
		await cleanupOrphanE2eProcesses();
	};

	return { mqttUrl: mqtt.url, instanceA, instanceB, stop };
}

export function screenshotPath(name: string): string {
	return path.join(screenshotsDir, name);
}

export function parseSessionCookie(setCookieHeader: string): {
	name: string;
	value: string;
} {
	const first = setCookieHeader.split(';')[0] ?? setCookieHeader;
	const separator = first.indexOf('=');
	if (separator === -1) {
		throw new Error(`Invalid cookie header: ${setCookieHeader}`);
	}
	return {
		name: first.slice(0, separator),
		value: first.slice(separator + 1),
	};
}

export async function createBrowserContext(
	browser: import('@playwright/test').Browser,
	instance: N8nInstance,
) {
	const { name, value } = parseSessionCookie(instance.cookie);
	const context = await browser.newContext({
		baseURL: instance.baseUrl,
		ignoreHTTPSErrors: true,
	});
	await context.addCookies([
		{
			name,
			value,
			url: instance.baseUrl,
			httpOnly: true,
			secure: false,
			sameSite: 'Lax',
		},
	]);
	return context;
}
