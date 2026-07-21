import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const n8nPort = process.env.N8N_PORT ?? '5678';
const viteBin = path.join(repoRoot, 'node_modules/vite/bin/vite.js');

const children: ChildProcess[] = [];
let shuttingDown = false;

function killTree(pid: number, signal: NodeJS.Signals = 'SIGTERM'): void {
	try {
		process.kill(-pid, signal);
	} catch {
		try {
			process.kill(pid, signal);
		} catch {
			// already gone
		}
	}
}

function killMatching(pattern: string): void {
	try {
		const output = execFileSync('pgrep', ['-af', pattern], {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
		});
		for (const line of output.split('\n')) {
			const pid = Number.parseInt(line.trim().split(/\s+/)[0] ?? '', 10);
			if (!Number.isFinite(pid) || pid <= 0 || pid === process.pid) continue;
			killTree(pid, 'SIGTERM');
		}
	} catch {
		// no matches
	}
}

async function shutdown(code = 0): Promise<void> {
	if (shuttingDown) return;
	shuttingDown = true;

	for (const child of children) {
		if (child.pid) killTree(child.pid, 'SIGTERM');
	}

	await new Promise((resolve) => setTimeout(resolve, 1500));

	for (const child of children) {
		if (!child.pid) continue;
		try {
			process.kill(child.pid, 0);
			killTree(child.pid, 'SIGKILL');
		} catch {
			// exited
		}
	}

	killMatching('node_modules/vite/bin/vite.js');
	killMatching('node_modules/.bin/vite');
	killMatching(`${repoRoot}/.dev/n8n`);

	process.exit(code);
}

function spawnLabeled(name: string, command: string, args: string[]): ChildProcess {
	const child = spawn(command, args, {
		cwd: repoRoot,
		env: { ...process.env, N8N_PORT: n8nPort },
		stdio: ['ignore', 'pipe', 'pipe'],
		detached: process.platform !== 'win32',
	});

	children.push(child);

	const prefix = (chunk: Buffer) => {
		const text = chunk.toString();
		for (const line of text.split(/\r?\n/)) {
			if (line.length === 0) continue;
			process.stdout.write(`[${name}] ${line}\n`);
		}
	};

	child.stdout?.on('data', prefix);
	child.stderr?.on('data', prefix);

	child.on('exit', (exitCode, signal) => {
		if (shuttingDown) return;
		console.error(`[${name}] exited code=${exitCode} signal=${signal}`);
		void shutdown(exitCode && exitCode !== 0 ? exitCode : 0);
	});

	return child;
}

killMatching('node_modules/vite/bin/vite.js');
killMatching('node_modules/.bin/vite');

process.once('SIGINT', () => void shutdown(130));
process.once('SIGTERM', () => void shutdown(143));

spawnLabeled('app', process.execPath, [viteBin]);
spawnLabeled('n8n', process.execPath, [
	'--import',
	'tsx',
	path.join(repoRoot, 'scripts/dev-n8n.ts'),
]);
