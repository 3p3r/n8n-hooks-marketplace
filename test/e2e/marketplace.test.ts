import fs from 'node:fs';
import { chromium, type Browser, type BrowserContext, type FrameLocator, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	csvImporter,
	localSkillNames,
	pdfMerger,
	peerSkillsFor,
} from '../fixtures/workflows';
import { E2E_UI_TIMEOUT_MS } from './constants';
import { readHarnessState } from './harness-state';
import {
	clearFilters,
	clickDownload,
	clickRegister,
	expectSkillAbsent,
	expectSkillNames,
	openEcosystem,
	setFilter,
	waitForSkills,
} from './helpers';
import { createBrowserContext, listWorkflows, screenshotPath } from './harness';

type InstancePages = {
	name: string;
	baseUrl: string;
	cookie: string;
	context: BrowserContext;
	page: Page;
	frame: FrameLocator;
};

let browser: Browser;
let instancePages: InstancePages[];

function getInstance(name: string): InstancePages {
	const entry = instancePages.find((item) => item.name === name);
	if (!entry) {
		throw new Error(`Missing browser context for ${name}`);
	}
	return entry;
}

beforeAll(async () => {
	const state = readHarnessState();
	browser = await chromium.launch({ headless: true });
	instancePages = [];

	for (const instance of state.instances) {
		const context = await createBrowserContext(browser, instance);
		const page = await context.newPage();
		page.setDefaultTimeout(E2E_UI_TIMEOUT_MS);
		const frame = await openEcosystem(page);
		instancePages.push({
			name: instance.name,
			baseUrl: instance.baseUrl,
			cookie: instance.cookie,
			context,
			page,
			frame,
		});
	}
}, 60_000);

afterAll(async () => {
	if (browser) {
		await browser.close().catch(() => undefined);
	}
}, 10_000);

describe('ecosystem marketplace e2e', () => {
	it('discovers, searches, downloads, and registers workflows across three instances', async () => {
		const frameA = getInstance('instance-a').frame;
		const frameB = getInstance('instance-b').frame;
		const frameC = getInstance('instance-c').frame;

		await waitForSkills(frameA, peerSkillsFor('instance-a'));

		for (const skillName of localSkillNames('instance-a')) {
			await expectSkillAbsent(frameA, skillName);
		}
		for (const skillName of localSkillNames('instance-b')) {
			await expectSkillAbsent(frameB, skillName);
		}
		for (const skillName of localSkillNames('instance-c')) {
			await expectSkillAbsent(frameC, skillName);
		}

		await expectSkillAbsent(frameA, 'Private Workflow');

		await getInstance('instance-a').page.screenshot({
			path: screenshotPath('ecosystem-a.png'),
			fullPage: true,
		});
		await getInstance('instance-b').page.screenshot({
			path: screenshotPath('ecosystem-b.png'),
			fullPage: true,
		});
		await getInstance('instance-c').page.screenshot({
			path: screenshotPath('ecosystem-c.png'),
			fullPage: true,
		});

		for (const file of ['ecosystem-a.png', 'ecosystem-b.png', 'ecosystem-c.png']) {
			const target = screenshotPath(file);
			expect(fs.existsSync(target)).toBe(true);
			expect(fs.statSync(target).size).toBeGreaterThan(10_000);
		}

		await setFilter(frameA, '[data-ecosystem-search]', 'csv-importer');
		await expectSkillNames(frameA, ['csv-importer']);
		await clearFilters(frameA);
		await expectSkillNames(frameA, peerSkillsFor('instance-a'));

		await setFilter(frameA, '[data-ecosystem-search]', 'Relay inbound HTTP');
		await expectSkillNames(frameA, ['webhook-relay']);
		await clearFilters(frameA);

		await setFilter(frameB, '[data-ecosystem-author-filter]', 'alice');
		await expectSkillNames(frameB, ['invoice-parser', 'slack-notifier']);
		await setFilter(frameB, '[data-ecosystem-author-filter]', 'nobody');
		await frameB.locator('[data-ecosystem-empty]').waitFor({ state: 'visible', timeout: E2E_UI_TIMEOUT_MS });
		await clearFilters(frameB);

		await setFilter(frameB, '[data-ecosystem-tag-filter]', 'finance');
		await expectSkillNames(frameB, ['invoice-parser']);
		await clearFilters(frameB);

		await setFilter(frameA, '[data-ecosystem-author-filter]', 'bob');
		await setFilter(frameA, '[data-ecosystem-tag-filter]', 'finance');
		await setFilter(frameA, '[data-ecosystem-search]', 'csv-importer');
		await expectSkillNames(frameA, ['csv-importer']);
		await clearFilters(frameA);

		await clickDownload(frameA, 'csv-importer');

		const instanceA = getInstance('instance-a');
		const importedPdf = `${pdfMerger.name} (imported)`;
		const beforePdf = await listWorkflows(instanceA.baseUrl, instanceA.cookie);
		expect(beforePdf.some((workflow) => workflow.name === importedPdf)).toBe(false);
		await clickRegister(frameA, 'pdf-merger');
		const afterPdf = await listWorkflows(instanceA.baseUrl, instanceA.cookie);
		expect(afterPdf.some((workflow) => workflow.name === importedPdf)).toBe(true);

		const importedCsv = `${csvImporter.name} (imported)`;
		const beforeCsv = await listWorkflows(instanceA.baseUrl, instanceA.cookie);
		const existingCsv = beforeCsv.filter((workflow) => workflow.name === importedCsv).length;
		await clickRegister(frameA, 'csv-importer');
		const afterCsv = await listWorkflows(instanceA.baseUrl, instanceA.cookie);
		expect(afterCsv.filter((workflow) => workflow.name === importedCsv).length).toBe(existingCsv + 1);
	}, 60_000);
});
