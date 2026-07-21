type ExternalHookStore = Record<string, unknown>;
type MountHook = (store: ExternalHookStore, meta: Record<string, unknown>) => void;

const PANEL_ID = 'ecosystem-marketplace-panel';
const TAB_ATTR = 'data-ecosystem-tab';
const IFRAME_ATTR = 'data-ecosystem-iframe';
const WIRED_ATTR = 'data-ecosystem-wired';

let active = false;
let iframeSrc = '/rest/ecosystem/app/';
let observer: MutationObserver | null = null;

async function fetchConfig(): Promise<{ mode: string; appUrl: string }> {
	const response = await fetch('/rest/ecosystem/config', { credentials: 'include' });
	if (!response.ok) {
		throw new Error(`Failed to load ecosystem config (${response.status})`);
	}
	return response.json() as Promise<{ mode: string; appUrl: string }>;
}

function findEvaluationsLabel(): HTMLLabelElement | null {
	return (
		[...document.querySelectorAll<HTMLLabelElement>('label.n8n-radio-button')].find((label) => {
			if (label.hasAttribute(TAB_ATTR)) return false;
			return label.querySelector('[data-test-id="radio-button-evaluation"]') !== null;
		}) ?? null
	);
}

function contentMain(): HTMLElement {
	const header = document.querySelector('header');
	if (!header?.parentElement) {
		throw new Error('n8n header not found');
	}
	const main = header.parentElement.querySelector('main');
	if (!main) {
		throw new Error('n8n main content not found');
	}
	return main;
}

function ensurePanel(): HTMLElement {
	const existing = document.getElementById(PANEL_ID);
	if (existing) return existing;

	const main = contentMain();
	if (getComputedStyle(main).position === 'static') {
		main.style.position = 'relative';
	}

	const panel = document.createElement('div');
	panel.id = PANEL_ID;
	panel.setAttribute('data-ecosystem-panel', 'true');
	// z-index below `.tab-bar-container` (100)
	panel.style.cssText =
		'display:none;position:absolute;inset:0;z-index:1;background:var(--color--background, #101113)';

	const iframe = document.createElement('iframe');
	iframe.setAttribute(IFRAME_ATTR, 'true');
	iframe.title = 'Ecosystem Marketplace';
	iframe.src = iframeSrc;
	iframe.style.cssText = 'width:100%;height:100%;border:0;display:block;background:inherit';
	panel.appendChild(iframe);
	main.appendChild(panel);
	return panel;
}

function setPanelVisible(visible: boolean): void {
	const panel = document.getElementById(PANEL_ID);
	if (!panel) return;
	panel.style.display = visible ? 'block' : 'none';
}

function setTabActive(tab: HTMLElement, isActive: boolean): void {
	const button = tab.querySelector<HTMLElement>('[data-ecosystem-button]');
	if (!button) throw new Error('Ecosystem tab button missing');
	tab.setAttribute('aria-checked', isActive ? 'true' : 'false');
	button.classList.toggle('_active_15iso_131', isActive);
}

function deactivateNativeRadios(group: HTMLElement): void {
	for (const label of group.querySelectorAll<HTMLLabelElement>('label.n8n-radio-button')) {
		if (label.hasAttribute(TAB_ATTR)) continue;
		label.setAttribute('aria-checked', 'false');
		label.querySelector('[data-test-id^="radio-button-"]')?.classList.remove('_active_15iso_131');
	}
}

function deactivateEcosystem(): void {
	if (!active) return;
	active = false;
	setPanelVisible(false);
	const tab = document.querySelector<HTMLElement>(`label[${TAB_ATTR}]`);
	if (tab) setTabActive(tab, false);
}

function activateEcosystem(tab: HTMLElement): void {
	active = true;
	ensurePanel();
	setPanelVisible(true);
	setTabActive(tab, true);
	const group = tab.closest('.n8n-radio-buttons');
	if (!group) throw new Error('n8n radio group not found');
	deactivateNativeRadios(group);
}

function wireRadioGroup(tab: HTMLElement): void {
	const group = tab.closest('.n8n-radio-buttons');
	if (!group || group.hasAttribute(WIRED_ATTR)) return;
	group.setAttribute(WIRED_ATTR, 'true');

	group.addEventListener(
		'click',
		(event) => {
			const target = event.target as HTMLElement;
			if (target.closest(`[${TAB_ATTR}]`)) return;
			if (!target.closest('label.n8n-radio-button')) return;
			deactivateEcosystem();
		},
		true,
	);
}

function createEcosystemTab(templateLabel: HTMLLabelElement): HTMLElement {
	const templateButton = templateLabel.querySelector<HTMLElement>(
		'[data-test-id^="radio-button-"]',
	);
	if (!templateButton) throw new Error('n8n radio button template missing');

	const tab = document.createElement('label');
	tab.setAttribute(TAB_ATTR, 'true');
	tab.setAttribute('role', 'radio');
	tab.setAttribute('tabindex', '-1');
	tab.setAttribute('aria-checked', 'false');
	tab.className = templateLabel.className;

	const button = document.createElement('div');
	button.setAttribute('data-ecosystem-button', 'true');
	button.setAttribute('data-testid', 'ecosystem-tab');
	button.textContent = 'Ecosystem';
	button.className = templateButton.className;
	button.classList.remove('_active_15iso_131');
	tab.appendChild(button);

	tab.addEventListener('click', (event) => {
		event.preventDefault();
		event.stopPropagation();
		if (active) deactivateEcosystem();
		else activateEcosystem(tab);
	});

	return tab;
}

function injectTab(): void {
	if (document.querySelector(`label[${TAB_ATTR}]`)) return;

	const evaluations = findEvaluationsLabel();
	if (!evaluations) return;

	const tab = createEcosystemTab(evaluations);
	evaluations.insertAdjacentElement('afterend', tab);
	wireRadioGroup(tab);
}

async function bootstrap(): Promise<void> {
	const config = await fetchConfig();
	iframeSrc = config.appUrl;

	injectTab();
	if (!observer) {
		observer = new MutationObserver(() => injectTab());
		observer.observe(document.body, { childList: true, subtree: true });
	}
}

const mountHooks: MountHook[] = [() => void bootstrap()];

const hooks = {
	app: { mount: mountHooks },
	nodeView: { mount: mountHooks },
	main: { routeChange: mountHooks },
};

declare global {
	interface Window {
		n8nExternalHooks?: typeof hooks;
	}
}

window.n8nExternalHooks = hooks;

export default hooks;
