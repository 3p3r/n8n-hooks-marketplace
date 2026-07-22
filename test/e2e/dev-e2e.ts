import { seedPlan } from '../fixtures/workflows';
import { cleanupOrphanE2eProcesses } from './cleanup';
import { E2E_HARNESS_TIMEOUT_MS } from './constants';
import { startHarness } from './harness';
import { withTimeout } from './timeout';

await cleanupOrphanE2eProcesses();

const harness = await withTimeout(startHarness(seedPlan), 'Harness boot', E2E_HARNESS_TIMEOUT_MS);

console.log('Ecosystem e2e harness ready. Press Ctrl+C to stop.\n');
console.log(`MQTT broker: ${harness.mqttUrl}\n`);

for (const instance of harness.instances) {
	console.log(`${instance.name}`);
	console.log(`  URL:   ${instance.baseUrl}`);
	console.log(`  Login: ${instance.name}@example.com / TestPassword123!`);
	console.log('');
}

const shutdown = async () => {
	await harness.stop();
	process.exit(0);
};

process.on('SIGINT', () => {
	void shutdown();
});
process.on('SIGTERM', () => {
	void shutdown();
});

await new Promise<void>(() => {});
