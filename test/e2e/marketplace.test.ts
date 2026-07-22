import fs from 'node:fs';
import { expect as pwExpect } from '@playwright/test';
import {
	type Browser,
	type BrowserContext,
	chromium,
	type FrameLocator,
	type Page,
} from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	csvImporter,
	localSkillNames,
	pdfMerger,
	peerSkillsFor,
	visibleSkillsWithOwn,
} from '../fixtures/workflows';
import { E2E_UI_TIMEOUT_MS } from './constants';
import { createBrowserContext, listWorkflows, screenshotPath } from './harness';
import { readHarnessState } from './harness-state';
import {
	clearFilters,
	clickCopy,
	clickFileDownload,
	clickImport,
	expectInstanceId,
	expectProductionIframe,
	expectSkillAbsent,
	expectSkillNames,
	expectSkillOrder,
	openEcosystem,
	readClipboardText,
	setFilter,
	setHideOwn,
	waitForSkills,
} from './helpers';

type InstancePages = {
	name: string;
	baseUrl: string;
	cookie: string;
	instanceId: string;
	appUrl: string;
	context: BrowserContext;
	page: Page;
	frame: FrameLocator;
};

let browser: Browser;
let instancePages: InstancePages[];

async function openInstance(name: string): Promise<InstancePages> {
	const state = readHarnessState();
	const instance = state.instances.find((entry) => entry.name === name);
	if (!instance) {
		throw new Error(`Missing harness instance ${name}`);
	}

	const context = await createBrowserContext(browser, instance);
	await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
		origin: instance.baseUrl,
	});
	const page = await context.newPage();
	page.setDefaultTimeout(E2E_UI_TIMEOUT_MS);
	const frame = await openEcosystem(page);
	return {
		name: instance.name,
		baseUrl: instance.baseUrl,
		cookie: instance.cookie,
		instanceId: instance.instanceId,
		appUrl: instance.appUrl,
		context,
		page,
		frame,
	};
}

function getInstance(name: string): InstancePages {
	const entry = instancePages.find((item) => item.name === name);
	if (!entry) {
		throw new Error(`Missing browser context for ${name}`);
	}
	return entry;
}

async function captureScreenshots(suffix: 'own' | 'peers'): Promise<void> {
	for (const instance of instancePages) {
		const file = `ecosystem-${instance.name.replace('instance-', '')}-${suffix}.png`;
		const target = screenshotPath(file);
		await instance.page.screenshot({ path: target, fullPage: true });
		expect(fs.statSync(target).size).toBeGreaterThan(10_000);
	}
}

beforeAll(async () => {
	browser = await chromium.launch({ headless: true });
	instancePages = [await openInstance('instance-a')];
}, 60_000);

afterAll(async () => {
	if (browser) {
		await browser.close().catch(() => undefined);
	}
}, 10_000);

describe('ecosystem marketplace e2e', () => {
	it('discovers, filters, copies, imports, and downloads workflows across three instances', async () => {
		const instanceA = getInstance('instance-a');
		const frameA = instanceA.frame;

		expect(instanceA.appUrl).toMatch(/\/rest\/ecosystem\/app\/$/);
		expect(instanceA.appUrl).not.toContain(':5173');
		await expectProductionIframe(instanceA.page, instanceA.appUrl);
		await expectInstanceId(frameA, instanceA.instanceId);
		await waitForSkills(frameA, visibleSkillsWithOwn('instance-a'));
		await expectSkillOrder(frameA, visibleSkillsWithOwn('instance-a'));

		instancePages.push(await openInstance('instance-b'));
		instancePages.push(await openInstance('instance-c'));

		const frameB = getInstance('instance-b').frame;
		const frameC = getInstance('instance-c').frame;

		await expectInstanceId(frameB, getInstance('instance-b').instanceId);
		await expectInstanceId(frameC, getInstance('instance-c').instanceId);

		await waitForSkills(frameB, visibleSkillsWithOwn('instance-b'));
		await waitForSkills(frameC, visibleSkillsWithOwn('instance-c'));

		await captureScreenshots('own');

		await setHideOwn(frameA, true);
		await setHideOwn(frameB, true);
		await setHideOwn(frameC, true);

		await expectSkillNames(frameA, peerSkillsFor('instance-a'));
		await expectSkillNames(frameB, peerSkillsFor('instance-b'));
		await expectSkillNames(frameC, peerSkillsFor('instance-c'));

		for (const skillName of localSkillNames('instance-a')) {
			await expectSkillAbsent(frameA, skillName);
		}

		await expectSkillAbsent(frameA, 'Private Workflow');

		await captureScreenshots('peers');

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
		await frameB
			.locator('[data-ecosystem-empty]')
			.waitFor({ state: 'visible', timeout: E2E_UI_TIMEOUT_MS });
		await clearFilters(frameB);

		await setFilter(frameB, '[data-ecosystem-tag-filter]', 'finance');
		await expectSkillNames(frameB, ['invoice-parser']);
		await clearFilters(frameB);

		await setFilter(frameA, '[data-ecosystem-author-filter]', 'bob');
		await setFilter(frameA, '[data-ecosystem-tag-filter]', 'finance');
		await setFilter(frameA, '[data-ecosystem-search]', 'csv-importer');
		await expectSkillNames(frameA, ['csv-importer']);
		await clearFilters(frameA);

		await clickCopy(frameA, 'csv-importer');
		const clipboardText = await readClipboardText(frameA);
		const clipboardWorkflow = JSON.parse(clipboardText) as { name?: string; nodes?: unknown[] };
		expect(Array.isArray(clipboardWorkflow.nodes)).toBe(true);
		expect(clipboardWorkflow.name).toContain('CSV Importer');

		const importedPdf = `${pdfMerger.name} (imported)`;
		const beforePdf = await listWorkflows(instanceA.baseUrl, instanceA.cookie);
		expect(beforePdf.some((workflow) => workflow.name === importedPdf)).toBe(false);
		await clickImport(frameA, 'pdf-merger');
		const afterPdf = await listWorkflows(instanceA.baseUrl, instanceA.cookie);
		expect(afterPdf.some((workflow) => workflow.name === importedPdf)).toBe(true);

		const downloadPromise = instanceA.page.waitForEvent('download', { timeout: E2E_UI_TIMEOUT_MS });
		await clickFileDownload(frameA, 'health-ping');
		const download = await downloadPromise;
		expect(download.suggestedFilename()).toMatch(/health-ping\.json$/);
		const downloadPath = await download.path();
		expect(downloadPath).toBeTruthy();
		const body = fs.readFileSync(downloadPath as string, 'utf8');
		const downloadedWorkflow = JSON.parse(body) as { nodes?: unknown[] };
		expect(Array.isArray(downloadedWorkflow.nodes)).toBe(true);
		expect(body.length).toBeGreaterThan(0);

		const importedCsv = `${csvImporter.name} (imported)`;
		const beforeCsv = await listWorkflows(instanceA.baseUrl, instanceA.cookie);
		const existingCsv = beforeCsv.filter((workflow) => workflow.name === importedCsv).length;
		await clickImport(frameA, 'csv-importer');
		const afterCsv = await listWorkflows(instanceA.baseUrl, instanceA.cookie);
		expect(afterCsv.filter((workflow) => workflow.name === importedCsv).length).toBe(
			existingCsv + 1,
		);

		await setHideOwn(frameA, false);
		await waitForSkills(frameA, localSkillNames('instance-a'));
		const ownEntry = frameA.locator('[data-skill-name="invoice-parser"]');
		const importButton = ownEntry.locator('[data-ecosystem-import]');
		await pwExpect(importButton).toBeDisabled();
		await pwExpect(importButton).toHaveText('Already on this instance');
	}, 90_000);
});
