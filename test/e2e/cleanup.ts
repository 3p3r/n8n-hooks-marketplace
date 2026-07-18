import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../../..');
const pidFile = path.join(repoRoot, 'test/e2e/.tmp/pids.json');
const n8nBin = path.join(repoRoot, 'node_modules/n8n/bin/n8n');

function readTrackedPids(): number[] {
	if (!fs.existsSync(pidFile)) return [];
	try {
		const parsed = JSON.parse(fs.readFileSync(pidFile, 'utf8')) as unknown;
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((pid): pid is number => typeof pid === 'number' && pid > 0);
	} catch {
		return [];
	}
}

function writeTrackedPids(pids: number[]): void {
	fs.mkdirSync(path.dirname(pidFile), { recursive: true });
	if (pids.length === 0) {
		fs.rmSync(pidFile, { force: true });
		return;
	}
	fs.writeFileSync(pidFile, JSON.stringify([...new Set(pids)]));
}

export function registerE2ePid(pid: number): void {
	if (!pid || pid <= 0) return;
	writeTrackedPids([...readTrackedPids(), pid]);
}

export function unregisterE2ePid(pid: number): void {
	writeTrackedPids(readTrackedPids().filter((tracked) => tracked !== pid));
}

export function killProcessTree(pid: number, signal: NodeJS.Signals = 'SIGTERM'): void {
	if (!pid || pid <= 0 || pid === process.pid) return;
	try {
		process.kill(-pid, signal);
		return;
	} catch {
		// fall through to single-process kill
	}
	try {
		process.kill(pid, signal);
	} catch {
		// already exited
	}
}

export async function waitForProcessExit(pid: number, timeoutMs = 15_000): Promise<void> {
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		try {
			process.kill(pid, 0);
		} catch {
			unregisterE2ePid(pid);
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
	killProcessTree(pid, 'SIGKILL');
	unregisterE2ePid(pid);
}

function listN8nPids(): number[] {
	try {
		const output = execFileSync('pgrep', ['-af', n8nBin], {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
		});
		return output
			.split('\n')
			.map((line) => Number.parseInt(line.trim().split(/\s+/)[0] ?? '', 10))
			.filter((pid) => Number.isFinite(pid) && pid > 0);
	} catch {
		return [];
	}
}

function getProcessEnviron(pid: number): string {
	try {
		return fs.readFileSync(`/proc/${pid}/environ`).toString('utf8');
	} catch {
		return '';
	}
}

function listE2eN8nPids(): number[] {
	const marker = 'test/e2e/.tmp';
	return listN8nPids().filter((pid) => getProcessEnviron(pid).includes(marker));
}

/** Kill n8n processes left behind by prior e2e runs for this repo. */
export async function cleanupOrphanE2eProcesses(): Promise<void> {
	const pids = new Set<number>([...readTrackedPids(), ...listE2eN8nPids()]);

	for (const pid of pids) {
		killProcessTree(pid, 'SIGTERM');
	}

	if (pids.size === 0) return;

	await new Promise((resolve) => setTimeout(resolve, 2000));

	for (const pid of pids) {
		try {
			process.kill(pid, 0);
			killProcessTree(pid, 'SIGKILL');
		} catch {
			// exited after SIGTERM
		}
		unregisterE2ePid(pid);
	}

	writeTrackedPids([]);
}
