import { expect, type FrameLocator, type Page } from 'playwright/test';
import { expect as vitestExpect } from 'vitest';
import { E2E_ASSERT_POLL_MS, E2E_PEER_SYNC_MS, E2E_UI_TIMEOUT_MS } from './constants';

const ACTION_RESET_MS = 5_000;

export async function expectSkillNames(frame: FrameLocator, expected: string[]): Promise<void> {
	const sorted = [...expected].sort();
	await vitestExpect
		.poll(async () => [...(await visibleSkillNames(frame))].sort(), {
			timeout: E2E_ASSERT_POLL_MS,
		})
		.toEqual(sorted);
}

export async function openEcosystem(page: Page): Promise<FrameLocator> {
	await page.goto('/workflow/new', { waitUntil: 'domcontentloaded', timeout: E2E_UI_TIMEOUT_MS });
	await page.waitForFunction(() => Boolean(window.n8nExternalHooks?.app?.mount), undefined, {
		timeout: E2E_UI_TIMEOUT_MS,
	});

	const tab = page.locator('[data-ecosystem-tab]');
	await tab.waitFor({ state: 'visible', timeout: E2E_UI_TIMEOUT_MS });
	await tab.click();

	const frame = page.frameLocator('[data-ecosystem-iframe]');
	await frame
		.locator('[data-ecosystem-root]')
		.waitFor({ state: 'visible', timeout: E2E_UI_TIMEOUT_MS });
	await frame
		.locator('[data-ecosystem-loading]')
		.waitFor({ state: 'hidden', timeout: E2E_UI_TIMEOUT_MS });
	return frame;
}

export async function waitForSkill(
	frame: FrameLocator,
	skillName: string,
	timeoutMs = E2E_PEER_SYNC_MS,
): Promise<void> {
	await frame
		.locator(`[data-skill-name="${skillName}"]`)
		.waitFor({ state: 'visible', timeout: timeoutMs });
}

export async function waitForSkills(frame: FrameLocator, skillNames: string[]): Promise<void> {
	await Promise.all(skillNames.map((skillName) => waitForSkill(frame, skillName)));
}

export async function expectSkillAbsent(frame: FrameLocator, skillName: string): Promise<void> {
	await expect(frame.locator(`[data-skill-name="${skillName}"]`)).toHaveCount(0);
}

export async function expectInstanceId(frame: FrameLocator, expected: string): Promise<void> {
	const locator = frame.locator('[data-ecosystem-instance-id]');
	await expect(locator).toBeVisible({ timeout: E2E_UI_TIMEOUT_MS });
	await expect(locator).toHaveText(expected);
}

export async function expectProductionIframe(page: Page, expectedAppUrl: string): Promise<void> {
	const iframe = page.locator('[data-ecosystem-iframe]');
	await expect(iframe).toBeVisible({ timeout: E2E_UI_TIMEOUT_MS });
	await expect(iframe).toHaveAttribute('src', expectedAppUrl);
}

export async function expectSkillOrder(frame: FrameLocator, expected: string[]): Promise<void> {
	await vitestExpect
		.poll(async () => visibleSkillNames(frame), {
			timeout: E2E_ASSERT_POLL_MS,
		})
		.toEqual(expected);
}

export async function visibleSkillNames(frame: FrameLocator): Promise<string[]> {
	const entries = frame.locator('[data-ecosystem-entry]');
	const count = await entries.count();
	const names: string[] = [];
	for (let index = 0; index < count; index += 1) {
		const name = await entries.nth(index).getAttribute('data-skill-name');
		if (name) names.push(name);
	}
	return names;
}

export async function setFilter(
	frame: FrameLocator,
	selector: string,
	value: string,
): Promise<void> {
	const input = frame.locator(selector);
	await input.fill(value);
	await input.dispatchEvent('input');
}

export async function clearFilters(frame: FrameLocator): Promise<void> {
	await setFilter(frame, '[data-ecosystem-search]', '');
	await setFilter(frame, '[data-ecosystem-author-filter]', '');
	await setFilter(frame, '[data-ecosystem-tag-filter]', '');
}

export async function setHideOwn(frame: FrameLocator, checked: boolean): Promise<void> {
	const checkbox = frame.locator('[data-ecosystem-hide-own]');
	const isChecked = await checkbox.isChecked();
	if (isChecked !== checked) {
		await checkbox.click();
	}
}

async function clickActionButton(
	frame: FrameLocator,
	skillName: string,
	selector: string,
	busyLabel: string,
	successLabel: string,
	idleLabel: string,
): Promise<void> {
	const entry = frame.locator(`[data-skill-name="${skillName}"]`);
	const button = entry.locator(selector);
	await button.click();
	await expect(button).toHaveText(busyLabel, { timeout: E2E_UI_TIMEOUT_MS });
	await expect(button).toHaveText(successLabel, { timeout: E2E_UI_TIMEOUT_MS });
	await expect(button).toHaveText(idleLabel, { timeout: ACTION_RESET_MS });
}

export async function clickCopy(frame: FrameLocator, skillName: string): Promise<void> {
	await clickActionButton(
		frame,
		skillName,
		'[data-ecosystem-copy]',
		'Copying…',
		'Copied!',
		'Copy to Clipboard',
	);
}

export async function clickImport(frame: FrameLocator, skillName: string): Promise<void> {
	await clickActionButton(
		frame,
		skillName,
		'[data-ecosystem-import]',
		'Importing…',
		'Imported!',
		'Import into N8N',
	);
}

export async function clickFileDownload(frame: FrameLocator, skillName: string): Promise<void> {
	await clickActionButton(
		frame,
		skillName,
		'[data-ecosystem-file-download]',
		'Downloading…',
		'Downloaded!',
		'Download Workflow',
	);
}

export async function readClipboardText(frame: FrameLocator): Promise<string> {
	return frame.locator('body').evaluate(async () => navigator.clipboard.readText());
}

declare global {
	interface Window {
		n8nExternalHooks?: {
			app?: {
				mount?: unknown;
			};
		};
	}
}
