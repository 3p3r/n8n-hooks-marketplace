import fs from 'node:fs';
import { chromium, type FrameLocator, type Page } from '@playwright/test';
import { nonSkillWorkflow, skillFromA, skillFromB } from '../fixtures/workflows';
import { cleanupOrphanE2eProcesses } from './cleanup';
import { createBrowserContext, screenshotPath, startHarness } from './harness';

async function openEcosystem(page: Page, baseUrl: string): Promise<FrameLocator> {
	await page.goto('/workflow/new', { waitUntil: 'networkidle', timeout: 60_000 });
	await page.waitForTimeout(5000);

	const currentUrl = page.url();
	if (currentUrl.includes('signin') || currentUrl.includes('setup')) {
		throw new Error(`Expected authenticated editor, got ${currentUrl}`);
	}

	const bridgeLoaded = await page.evaluate(() => Boolean(window.n8nExternalHooks?.app?.mount));
	if (!bridgeLoaded) {
		throw new Error(`Bridge hooks not loaded on ${baseUrl}. Current URL: ${currentUrl}`);
	}

	const tab = page.locator('[data-ecosystem-tab]');
	await tab.waitFor({ state: 'visible', timeout: 90_000 });
	await tab.click();
	const frame = page.frameLocator('[data-ecosystem-iframe]');
	await frame.locator('[data-ecosystem-root]').waitFor({ state: 'visible', timeout: 60_000 });
	return frame;
}

async function waitForPeerSkill(frame: FrameLocator, skillName: string): Promise<void> {
	const entry = frame.locator(`[data-skill-name="${skillName}"]`);
	await entry.waitFor({ state: 'visible', timeout: 90_000 });
	const text = await entry.textContent();
	if (!text?.includes(skillName)) {
		throw new Error(`Expected skill ${skillName} in ecosystem list`);
	}
}

export async function main(): Promise<void> {
	await cleanupOrphanE2eProcesses();

	const harness = await startHarness(skillFromA, skillFromB, nonSkillWorkflow, nonSkillWorkflow);
	const browser = await chromium.launch({ headless: true });

	const shutdown = async () => {
		await browser.close().catch(() => undefined);
		await harness.stop();
	};

	process.once('SIGINT', () => {
		void shutdown().finally(() => process.exit(130));
	});
	process.once('SIGTERM', () => {
		void shutdown().finally(() => process.exit(143));
	});

	try {
		const contextA = await createBrowserContext(browser, harness.instanceA);
		const contextB = await createBrowserContext(browser, harness.instanceB);
		const pageA = await contextA.newPage();
		const pageB = await contextB.newPage();

		const frameA = await openEcosystem(pageA, harness.instanceA.baseUrl);
		const frameB = await openEcosystem(pageB, harness.instanceB.baseUrl);

		await waitForPeerSkill(frameA, 'skill-from-b');
		await waitForPeerSkill(frameB, 'skill-from-a');

		await pageA.screenshot({
			path: screenshotPath('ecosystem-a.png'),
			fullPage: true,
		});
		await pageB.screenshot({
			path: screenshotPath('ecosystem-b.png'),
			fullPage: true,
		});

		await contextA.close();
		await contextB.close();

		for (const file of ['ecosystem-a.png', 'ecosystem-b.png']) {
			const target = screenshotPath(file);
			if (!fs.existsSync(target) || fs.statSync(target).size < 10_000) {
				throw new Error(`Expected screenshot at ${target}`);
			}
		}
	} finally {
		await browser.close();
		await harness.stop();
	}
}

const isDirectRun = process.argv[1]?.endsWith('run-marketplace.ts');
if (isDirectRun) {
	await main();
}
