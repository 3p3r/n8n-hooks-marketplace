import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { fetchEcosystemConfig } from './lib/marketplace';
import './styles.css';

const root = document.getElementById('root');
if (!root) {
	throw new Error('Root element not found');
}

async function bootstrap(): Promise<void> {
	const config = await fetchEcosystemConfig();
	await Promise.all(
		config.stylesheets.map(
			(href) =>
				new Promise<void>((resolve, reject) => {
					const link = document.createElement('link');
					link.rel = 'stylesheet';
					link.href = href;
					link.onload = () => resolve();
					link.onerror = () => reject(new Error(`Failed to load stylesheet: ${href}`));
					document.head.appendChild(link);
				}),
		),
	);

	createRoot(root).render(
		<StrictMode>
			<App />
		</StrictMode>,
	);
}

void bootstrap();
