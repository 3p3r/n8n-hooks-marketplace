import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startVitest } from 'vitest/node';
import { ecosystemInstanceId, seedPlan } from '../fixtures/workflows';
import { cleanupOrphanE2eProcesses } from './cleanup';
import { E2E_HARNESS_TIMEOUT_MS } from './constants';
import { startHarness } from './harness';
import { clearHarnessArtifacts, type HarnessState, harnessStatePath } from './harness-state';
import { withTimeout } from './timeout';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../../..');
const vitestConfig = path.join(repoRoot, 'vitest.e2e.config.ts');
const VITEST_RUN_MS = 100_000;

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
		instanceId: ecosystemInstanceId(instance.name),
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
