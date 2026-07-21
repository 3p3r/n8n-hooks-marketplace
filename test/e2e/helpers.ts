import { expect, type FrameLocator, type Page } from 'playwright/test';
import { expect as vitestExpect } from 'vitest';
import { E2E_ASSERT_POLL_MS, E2E_PEER_SYNC_MS, E2E_UI_TIMEOUT_MS } from './constants';

export async function expectSkillNames(
	frame: FrameLocator,
	expected: string[],
): Promise<void> {
	const sorted = [...expected].sort();
	await vitestExpect
		.poll(async () => [...(await visibleSkillNames(frame))].sort(), {
			timeout: E2E_ASSERT_POLL_MS,
		})
		.toEqual(sorted);
}

export async function openEcosystem(page: Page): Promise<FrameLocator> {
	await page.goto('/workflow/new', { waitUntil: 'domcontentloaded', timeout: E2E_UI_TIMEOUT_MS });
	await page.waitForFunction(
		() => Boolean(window.n8nExternalHooks?.app?.mount),
		undefined,
		{ timeout: E2E_UI_TIMEOUT_MS },
	);

	const tab = page.locator('[data-ecosystem-tab]');
	await tab.waitFor({ state: 'visible', timeout: E2E_UI_TIMEOUT_MS });
	await tab.click();

	const frame = page.frameLocator('[data-ecosystem-iframe]');
	await frame.locator('[data-ecosystem-root]').waitFor({ state: 'visible', timeout: E2E_UI_TIMEOUT_MS });
	await frame.locator('[data-ecosystem-loading]').waitFor({ state: 'hidden', timeout: E2E_UI_TIMEOUT_MS });
	return frame;
}

export async function waitForSkill(
	frame: FrameLocator,
	skillName: string,
	timeoutMs = E2E_PEER_SYNC_MS,
): Promise<void> {
	const entry = frame.locator(`[data-skill-name="${skillName}"]`);
	await entry.waitFor({ state: 'visible', timeout: timeoutMs });
	const text = await entry.textContent();
	if (!text?.includes(skillName)) {
		throw new Error(`Expected skill ${skillName} in ecosystem list`);
	}
}

export async function waitForSkills(frame: FrameLocator, skillNames: string[]): Promise<void> {
	await Promise.all(skillNames.map((skillName) => waitForSkill(frame, skillName)));
}

export async function expectSkillAbsent(frame: FrameLocator, skillName: string): Promise<void> {
	await expect(frame.locator(`[data-skill-name="${skillName}"]`)).toHaveCount(0);
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

export async function clickDownload(frame: FrameLocator, skillName: string): Promise<void> {
	const entry = frame.locator(`[data-skill-name="${skillName}"]`);
	const button = entry.locator('[data-ecosystem-download]');
	await button.click();
	await expect(button).toHaveText('Downloading…', { timeout: E2E_UI_TIMEOUT_MS });
	await expect(button).toHaveText('Download', { timeout: E2E_UI_TIMEOUT_MS });
	await expect(frame.locator('[data-ecosystem-error]')).toHaveCount(0);
}

export async function clickRegister(frame: FrameLocator, skillName: string): Promise<void> {
	const entry = frame.locator(`[data-skill-name="${skillName}"]`);
	const button = entry.locator('[data-ecosystem-register]');
	await button.click();
	await expect(button).toHaveText('Registering…', { timeout: E2E_UI_TIMEOUT_MS });
	await expect(button).toHaveText('Register', { timeout: E2E_UI_TIMEOUT_MS });
	await expect(frame.locator('[data-ecosystem-error]')).toHaveCount(0);
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
