type ExternalHookStore = Record<string, unknown>;

type MountHook = (store: ExternalHookStore, meta: Record<string, unknown>) => void;

const PANEL_ID = 'ecosystem-marketplace-panel';
const TAB_ATTR = 'data-ecosystem-tab';
const IFRAME_ATTR = 'data-ecosystem-iframe';

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

function findHeaderTab(label: string): HTMLElement | null {
	const candidates = [...document.querySelectorAll<HTMLElement>('button,[role="tab"],a,span,div')];
	return (
		candidates.find((element) => {
			if (element.children.length > 0) return false;
			return element.textContent?.trim() === label;
		}) ?? null
	);
}

function ensurePanel(): HTMLElement {
	let panel = document.getElementById(PANEL_ID);
	if (panel) return panel;

	panel = document.createElement('div');
	panel.id = PANEL_ID;
	panel.setAttribute('data-ecosystem-panel', 'true');
	panel.style.cssText = [
		'display:none',
		'position:fixed',
		'inset:var(--navbar--height, 64px) 0 0 0',
		'z-index:1200',
		'background:var(--color--background--light-3, #fff)',
	].join(';');

	const iframe = document.createElement('iframe');
	iframe.setAttribute(IFRAME_ATTR, 'true');
	iframe.title = 'Ecosystem Marketplace';
	iframe.src = iframeSrc;
	iframe.style.cssText = 'width:100%;height:100%;border:0;display:block';
	panel.appendChild(iframe);
	document.body.appendChild(panel);
	return panel;
}

function setPanelVisible(visible: boolean): void {
	const panel = document.getElementById(PANEL_ID);
	if (!panel) return;
	panel.style.display = visible ? 'block' : 'none';
}

function injectTab(): void {
	if (document.querySelector(`[${TAB_ATTR}]`)) return;

	const anchor =
		findHeaderTab('Evaluations') ?? findHeaderTab('Executions') ?? findHeaderTab('Editor');
	if (!anchor) return;

	const tab = document.createElement('button');
	tab.type = 'button';
	tab.textContent = 'Ecosystem';
	tab.setAttribute(TAB_ATTR, 'true');
	tab.setAttribute('data-testid', 'ecosystem-tab');
	tab.style.cssText = [
		'background:transparent',
		'border:0',
		'cursor:pointer',
		'padding:0 16px',
		'height:var(--navbar--height, 64px)',
		'color:inherit',
		'font:inherit',
		'margin-left:4px',
	].join(';');

	tab.addEventListener('click', (event) => {
		event.preventDefault();
		event.stopPropagation();
		active = !active;
		ensurePanel();
		setPanelVisible(active);
		tab.style.fontWeight = active ? '600' : '400';
		tab.style.borderBottom = active ? '2px solid var(--color--primary, #ff6d5a)' : 'none';
	});

	anchor.insertAdjacentElement('afterend', tab);
}

async function bootstrap(): Promise<void> {
	const config = await fetchConfig();
	iframeSrc = config.appUrl;

	const tryInject = () => injectTab();
	tryInject();

	if (!observer) {
		observer = new MutationObserver(() => tryInject());
		observer.observe(document.body, { childList: true, subtree: true });
	}

	const interval = window.setInterval(() => {
		tryInject();
		if (document.querySelector(`[${TAB_ATTR}]`)) {
			window.clearInterval(interval);
		}
	}, 500);
}

const mountHooks: MountHook[] = [
	() => {
		void bootstrap();
	},
];

const hooks = {
	app: {
		mount: mountHooks,
	},
	nodeView: {
		mount: mountHooks,
	},
	main: {
		routeChange: mountHooks,
	},
};

declare global {
	interface Window {
		n8nExternalHooks?: typeof hooks;
	}
}

window.n8nExternalHooks = hooks;

export default hooks;
