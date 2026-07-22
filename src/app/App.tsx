import type { MqttClient } from 'mqtt';
import { useEffect, useMemo, useState } from 'react';
import type { CatalogEntry, CatalogMessage } from '../../shared/index';
import {
	connectMarketplace,
	downloadWorkflowJson,
	type EcosystemConfig,
	fetchEcosystemConfig,
	fetchMqttUrl,
	fetchWorkflowForEntry,
	getRequesterId,
	registerWorkflow,
} from './lib/marketplace';
import { filterCatalog, useFuzzyCatalog } from './lib/search';

type ButtonAction = 'copy' | 'import' | 'file';
type ActionPhase = 'loading' | 'success' | 'error';

type ActionState = {
	phase?: ActionPhase;
	error?: string;
};

function entryKey(entry: CatalogEntry): string {
	return `${entry.instanceId}:${entry.workflowId}`;
}

function actionKey(entry: CatalogEntry, action: ButtonAction): string {
	return `${entryKey(entry)}:${action}`;
}

function actionLabel(action: ButtonAction, phase: ActionPhase | undefined, isOwn: boolean): string {
	if (action === 'import' && isOwn) {
		return 'Already on this instance';
	}
	if (phase === 'loading') {
		if (action === 'copy') return 'Copying…';
		if (action === 'import') return 'Importing…';
		return 'Downloading…';
	}
	if (phase === 'success') {
		if (action === 'copy') return 'Copied!';
		if (action === 'import') return 'Imported!';
		return 'Downloaded!';
	}
	if (action === 'copy') return 'Copy to Clipboard';
	if (action === 'import') return 'Import into N8N';
	return 'Download Workflow';
}

export function App() {
	const requesterId = useMemo(() => getRequesterId(), []);
	const [config, setConfig] = useState<EcosystemConfig | null>(null);
	const [catalogs, setCatalogs] = useState<Record<string, CatalogMessage>>({});
	const [client, setClient] = useState<MqttClient | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [hideOwnWorkflows, setHideOwnWorkflows] = useState(false);
	const [query, setQuery] = useState('');
	const [author, setAuthor] = useState('');
	const [tag, setTag] = useState('');
	const [actionStates, setActionStates] = useState<Record<string, ActionState>>({});

	useEffect(() => {
		let active = true;
		let mqttClient: MqttClient | null = null;

		const run = async () => {
			const [ecosystemConfig, url] = await Promise.all([fetchEcosystemConfig(), fetchMqttUrl()]);

			mqttClient = await connectMarketplace(url, (message) => {
				if (!active) return;
				setCatalogs((current) => ({ ...current, [message.instanceId]: message }));
			});

			if (active) {
				setConfig(ecosystemConfig);
				setClient(mqttClient);
				setLoading(false);
			}
		};

		void run().catch((caught) => {
			if (active) {
				setError(caught instanceof Error ? caught.message : 'Failed to initialize marketplace');
				setLoading(false);
			}
		});

		return () => {
			active = false;
			mqttClient?.end(true);
		};
	}, []);

	const catalogEntries = useMemo(() => {
		const entries = Object.values(catalogs).flatMap((catalog) => catalog.entries);
		const visible = hideOwnWorkflows
			? entries.filter((entry) => entry.instanceId !== config?.instanceId)
			: entries;
		const seen = new Set<string>();
		return visible.filter((entry) => {
			const key = entryKey(entry);
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
	}, [catalogs, config?.instanceId, hideOwnWorkflows]);

	const filtered = useMemo(
		() => filterCatalog(catalogEntries, author, tag),
		[catalogEntries, author, tag],
	);
	const visible = useFuzzyCatalog(filtered, query);

	const runAction = async (entry: CatalogEntry, action: ButtonAction): Promise<void> => {
		if (!config) return;

		const key = actionKey(entry, action);
		setActionStates((current) => ({ ...current, [key]: { phase: 'loading' } }));

		try {
			const workflow = await fetchWorkflowForEntry(client, config.instanceId, requesterId, entry);

			if (action === 'copy') {
				await navigator.clipboard.writeText(JSON.stringify(workflow, null, 2));
			} else if (action === 'import') {
				await registerWorkflow(workflow);
			} else {
				downloadWorkflowJson(entry, workflow);
			}

			setActionStates((current) => ({ ...current, [key]: { phase: 'success' } }));
			window.setTimeout(() => {
				setActionStates((current) => {
					if (current[key]?.phase !== 'success') return current;
					const next = { ...current };
					delete next[key];
					return next;
				});
			}, 2_000);
		} catch (caught) {
			const message = caught instanceof Error ? caught.message : 'Action failed';
			setActionStates((current) => ({ ...current, [key]: { phase: 'error', error: message } }));
		}
	};

	return (
		<div className="ecosystem" data-ecosystem-root="true">
			<header className="ecosystem__header">
				<h1 data-ecosystem-title="true">
					Ecosystem
					<span className="ecosystem__instance-id" data-ecosystem-instance-id="true">
						{config?.instanceId}
					</span>
				</h1>
				<p>Discover workflows shared across n8n instances on your network.</p>
			</header>

			<section className="ecosystem__filters">
				<input
					className="ecosystem__input"
					data-ecosystem-search="true"
					placeholder="Search workflows"
					value={query}
					onChange={(event) => setQuery(event.target.value)}
				/>
				<input
					className="ecosystem__input"
					data-ecosystem-author-filter="true"
					placeholder="Filter by author"
					value={author}
					onChange={(event) => setAuthor(event.target.value)}
				/>
				<input
					className="ecosystem__input"
					data-ecosystem-tag-filter="true"
					placeholder="Filter by tag"
					value={tag}
					onChange={(event) => setTag(event.target.value)}
				/>
				<label className="ecosystem__hide-own">
					<input
						type="checkbox"
						data-ecosystem-hide-own="true"
						checked={hideOwnWorkflows}
						onChange={(event) => setHideOwnWorkflows(event.target.checked)}
					/>
					Hide Own Workflows
				</label>
			</section>

			{loading && <p data-ecosystem-loading="true">Connecting to marketplace…</p>}
			{error && <p data-ecosystem-error="true">{error}</p>}

			<ul className="ecosystem__list" data-ecosystem-list="true">
				{visible.map((entry) => {
					const isOwn = entry.instanceId === config?.instanceId;
					const copyState = actionStates[actionKey(entry, 'copy')];
					const importState = actionStates[actionKey(entry, 'import')];
					const fileState = actionStates[actionKey(entry, 'file')];
					const actionError = copyState?.error ?? importState?.error ?? fileState?.error;

					return (
						<li
							key={entryKey(entry)}
							className="ecosystem__card"
							data-ecosystem-entry="true"
							data-skill-name={entry.skill.name}
						>
							<div>
								<h2 data-ecosystem-skill-name="true">{entry.skill.name}</h2>
								<p>{entry.skill.description}</p>
								<p className="ecosystem__meta">
									<span data-ecosystem-instance="true">{entry.instanceName}</span>
									{entry.skill.metadata?.author ? (
										<span data-ecosystem-author="true"> · {entry.skill.metadata.author}</span>
									) : null}
									{entry.skill.metadata?.tags?.length ? (
										<span data-ecosystem-tags="true">
											{' '}
											· {entry.skill.metadata.tags.join(', ')}
										</span>
									) : null}
								</p>
							</div>
							<div className="ecosystem__actions">
								<button
									type="button"
									className="ecosystem__button"
									data-ecosystem-copy="true"
									disabled={copyState?.phase === 'loading' || copyState?.phase === 'success'}
									onClick={() => void runAction(entry, 'copy')}
								>
									{copyState?.phase === 'loading' ? (
										<span className="ecosystem__spinner" aria-hidden="true" />
									) : null}
									{actionLabel('copy', copyState?.phase, isOwn)}
								</button>
								<button
									type="button"
									className="ecosystem__button"
									data-ecosystem-import="true"
									disabled={
										isOwn || importState?.phase === 'loading' || importState?.phase === 'success'
									}
									title={isOwn ? 'Already on this instance' : undefined}
									onClick={() => void runAction(entry, 'import')}
								>
									{importState?.phase === 'loading' ? (
										<span className="ecosystem__spinner" aria-hidden="true" />
									) : null}
									{actionLabel('import', importState?.phase, isOwn)}
								</button>
								<button
									type="button"
									className="ecosystem__button"
									data-ecosystem-file-download="true"
									disabled={fileState?.phase === 'loading' || fileState?.phase === 'success'}
									onClick={() => void runAction(entry, 'file')}
								>
									{fileState?.phase === 'loading' ? (
										<span className="ecosystem__spinner" aria-hidden="true" />
									) : null}
									{actionLabel('file', fileState?.phase, isOwn)}
								</button>
								{actionError ? (
									<p className="ecosystem__action-error" data-ecosystem-action-error="true">
										{actionError}
									</p>
								) : null}
							</div>
						</li>
					);
				})}
			</ul>

			{!loading && !error && visible.length === 0 ? (
				<p data-ecosystem-empty="true">
					{hideOwnWorkflows
						? 'No peer workflows discovered yet.'
						: 'No workflows in the ecosystem yet.'}
				</p>
			) : null}
		</div>
	);
}
