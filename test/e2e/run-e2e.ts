import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startVitest } from 'vitest/node';
import { seedPlan } from '../fixtures/workflows';
import { E2E_HARNESS_TIMEOUT_MS } from './constants';
import { cleanupOrphanE2eProcesses } from './cleanup';
import {
	clearHarnessArtifacts,
	harnessStatePath,
	type HarnessState,
} from './harness-state';
import { startHarness } from './harness';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../../..');
const vitestConfig = path.join(repoRoot, 'vitest.e2e.config.ts');
const VITEST_RUN_MS = 75_000;

function withTimeout<T>(promise: Promise<T>, label: string, timeoutMs: number): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`${label} exceeded ${timeoutMs}ms`)), timeoutMs);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error) => {
				clearTimeout(timer);
				reject(error);
			},
		);
	});
}

await cleanupOrphanE2eProcesses();
clearHarnessArtifacts();

const harness = await withTimeout(startHarness(seedPlan), 'Harness boot', E2E_HARNESS_TIMEOUT_MS);
const state: HarnessState = {
	mqttUrl: harness.mqttUrl,
	instances: harness.instances.map((instance) => ({
		name: instance.name,
		port: instance.port,
		baseUrl: instance.baseUrl,
		cookie: instance.cookie,
	})),
};

fs.mkdirSync(path.dirname(harnessStatePath), { recursive: true });
fs.writeFileSync(harnessStatePath, JSON.stringify(state, null, 2));

let exitCode = 1;
try {
	const vitest = await withTimeout(
		startVitest('test', [], {
			root: repoRoot,
			config: vitestConfig,
			watch: false,
		}),
		'Vitest run',
		VITEST_RUN_MS,
	);

	if (!vitest) {
		throw new Error('Vitest failed to start');
	}

	exitCode = vitest.state.getCountOfFailedTests() > 0 ? 1 : 0;
	await vitest.close();
} finally {
	await harness.stop();
	clearHarnessArtifacts();
}

process.exit(exitCode);
