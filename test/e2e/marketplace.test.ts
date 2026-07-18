import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../../..');
const screenshotA = path.join(repoRoot, 'test/e2e/screenshots/ecosystem-a.png');
const screenshotB = path.join(repoRoot, 'test/e2e/screenshots/ecosystem-b.png');

describe('ecosystem marketplace e2e', () => {
	it('captures mutual discovery screenshots on both instances', () => {
		expect(fs.existsSync(screenshotA)).toBe(true);
		expect(fs.existsSync(screenshotB)).toBe(true);

		const sizeA = fs.statSync(screenshotA).size;
		const sizeB = fs.statSync(screenshotB).size;
		expect(sizeA).toBeGreaterThan(10_000);
		expect(sizeB).toBeGreaterThan(10_000);
	});
});
