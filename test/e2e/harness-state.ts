import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../../..');
const tmpDir = path.join(repoRoot, 'test/e2e/.tmp');

export const harnessStatePath = path.join(tmpDir, 'harness-state.json');

export type HarnessState = {
	mqttUrl: string;
	instances: Array<{
		name: string;
		port: number;
		baseUrl: string;
		cookie: string;
		instanceId: string;
		mode: 'production';
		appUrl: string;
	}>;
};

export function readHarnessState(): HarnessState {
	if (!fs.existsSync(harnessStatePath)) {
		throw new Error(`Missing harness state at ${harnessStatePath}. Did run-e2e start the harness?`);
	}
	return JSON.parse(fs.readFileSync(harnessStatePath, 'utf8')) as HarnessState;
}

export function clearHarnessArtifacts(): void {
	fs.rmSync(harnessStatePath, { force: true });
}
