import type { MqttClient } from 'mqtt';
import { useEffect, useMemo, useState } from 'react';
import type { CatalogEntry, CatalogMessage, N8nWorkflow } from '../../shared/index';
import {
	buildCatalogEntries,
	connectMarketplace,
	fetchLocalShareables,
	fetchMqttUrl,
	fetchShareableWorkflow,
	getInstanceId,
	getInstanceName,
	publishCatalog,
	publishWorkflowReply,
	requestWorkflow,
} from './lib/marketplace';
import { filterCatalog, useFuzzyCatalog } from './lib/search';

type Props = {
	entries: CatalogEntry[];
	loading: boolean;
	error: string | null;
	query: string;
	author: string;
	tag: string;
	onQueryChange: (value: string) => void;
	onAuthorChange: (value: string) => void;
	onTagChange: (value: string) => void;
	onDownload: (entry: CatalogEntry) => Promise<void>;
	onRegister: (entry: CatalogEntry) => Promise<void>;
	downloadingId: string | null;
	registeringId: string | null;
};

export function App() {
	const instanceId = useMemo(() => getInstanceId(), []);
	const [peerCatalogs, setPeerCatalogs] = useState<Record<string, CatalogMessage>>({});
	const [client, setClient] = useState<MqttClient | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [query, setQuery] = useState('');
	const [author, setAuthor] = useState('');
	const [tag, setTag] = useState('');
	const [downloadingId, setDownloadingId] = useState<string | null>(null);
	const [registeringId, setRegisteringId] = useState<string | null>(null);
	const [downloadedWorkflows, setDownloadedWorkflows] = useState<Record<string, N8nWorkflow>>({});

	useEffect(() => {
		let active = true;
		let mqttClient: MqttClient | null = null;

		const run = async () => {
			try {
				const mqtt = await import('mqtt');
				const [url, shareables] = await Promise.all([fetchMqttUrl(), fetchLocalShareables()]);
				const instanceName = getInstanceName();
				const entries = buildCatalogEntries(instanceId, instanceName, shareables);

				mqttClient = await connectMarketplace(mqtt, url, instanceId, {
					onCatalog: (message) => {
						if (!active || message.instanceId === instanceId) return;
						setPeerCatalogs((current) => ({ ...current, [message.instanceId]: message }));
					},
					onWorkflowRequest: async (message) => {
						if (!mqttClient) return;
						const workflow = await fetchShareableWorkflow(message.workflowId);
						publishWorkflowReply(mqttClient, message.replyTopic, message.workflowId, workflow);
					},
					onWorkflowReply: () => {
						// handled per-request listener
					},
				});

				publishCatalog(mqttClient, instanceId, instanceName, entries);
				if (active) {
					setClient(mqttClient);
					setLoading(false);
				}
			} catch (caught) {
				if (active) {
					setError(caught instanceof Error ? caught.message : 'Failed to initialize marketplace');
					setLoading(false);
				}
			}
		};

		void run();

		return () => {
			active = false;
			mqttClient?.end(true);
		};
	}, [instanceId]);

	const peerEntries = useMemo(() => {
		return Object.values(peerCatalogs).flatMap((catalog) => catalog.entries);
	}, [peerCatalogs]);

	const filtered = useMemo(
		() => filterCatalog(peerEntries, author, tag),
		[peerEntries, author, tag],
	);
	const visible = useFuzzyCatalog(filtered, query);

	const downloadEntry = async (entry: CatalogEntry): Promise<N8nWorkflow> => {
		if (!client) throw new Error('MQTT client not ready');
		setDownloadingId(entry.workflowId);
		try {
			const reply = requestWorkflow(client, entry.instanceId, instanceId, entry.workflowId);
			return await new Promise<N8nWorkflow>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error('Workflow download timed out')), 15_000);
				const handler = (topic: string, payload: Buffer) => {
					if (topic !== reply) return;
					clearTimeout(timeout);
					client.off('message', handler);
					const body = JSON.parse(payload.toString()) as {
						workflowId: string;
						workflow: N8nWorkflow;
					};
					if (body.workflowId !== entry.workflowId) {
						reject(new Error('Unexpected workflow in reply'));
						return;
					}
					setDownloadedWorkflows((current) => ({
						...current,
						[entry.workflowId]: body.workflow,
					}));
					resolve(body.workflow);
				};
				client.on('message', handler);
			});
		} finally {
			setDownloadingId(null);
		}
	};

	const registerEntry = async (entry: CatalogEntry) => {
		setRegisteringId(entry.workflowId);
		try {
			const workflow = downloadedWorkflows[entry.workflowId] ?? (await downloadEntry(entry));
			const { registerWorkflow } = await import('./lib/marketplace');
			await registerWorkflow(workflow);
		} finally {
			setRegisteringId(null);
		}
	};

	return (
		<MarketplaceView
			entries={visible}
			loading={loading}
			error={error}
			query={query}
			author={author}
			tag={tag}
			onQueryChange={setQuery}
			onAuthorChange={setAuthor}
			onTagChange={setTag}
			onDownload={downloadEntry}
			onRegister={registerEntry}
			downloadingId={downloadingId}
			registeringId={registeringId}
		/>
	);
}

function MarketplaceView({
	entries,
	loading,
	error,
	query,
	author,
	tag,
	onQueryChange,
	onAuthorChange,
	onTagChange,
	onDownload,
	onRegister,
	downloadingId,
	registeringId,
}: Props) {
	return (
		<div className="ecosystem" data-ecosystem-root="true">
			<header className="ecosystem__header">
				<h1 data-ecosystem-title="true">Ecosystem</h1>
				<p>Discover workflows shared by other n8n instances on your network.</p>
			</header>

			<section className="ecosystem__filters">
				<input
					data-ecosystem-search="true"
					placeholder="Search workflows"
					value={query}
					onChange={(event) => onQueryChange(event.target.value)}
				/>
				<input
					data-ecosystem-author-filter="true"
					placeholder="Filter by author"
					value={author}
					onChange={(event) => onAuthorChange(event.target.value)}
				/>
				<input
					data-ecosystem-tag-filter="true"
					placeholder="Filter by tag"
					value={tag}
					onChange={(event) => onTagChange(event.target.value)}
				/>
			</section>

			{loading && <p data-ecosystem-loading="true">Connecting to marketplace…</p>}
			{error && <p data-ecosystem-error="true">{error}</p>}

			<ul className="ecosystem__list" data-ecosystem-list="true">
				{entries.map((entry) => (
					<li
						key={`${entry.instanceId}:${entry.workflowId}`}
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
									<span data-ecosystem-tags="true"> · {entry.skill.metadata.tags.join(', ')}</span>
								) : null}
							</p>
						</div>
						<div className="ecosystem__actions">
							<button
								type="button"
								data-ecosystem-download="true"
								disabled={downloadingId === entry.workflowId}
								onClick={() => void onDownload(entry)}
							>
								{downloadingId === entry.workflowId ? 'Downloading…' : 'Download'}
							</button>
							<button
								type="button"
								data-ecosystem-register="true"
								disabled={registeringId === entry.workflowId}
								onClick={() => void onRegister(entry)}
							>
								{registeringId === entry.workflowId ? 'Registering…' : 'Register'}
							</button>
						</div>
					</li>
				))}
			</ul>

			{!loading && !error && entries.length === 0 ? (
				<p data-ecosystem-empty="true">No peer workflows discovered yet.</p>
			) : null}
		</div>
	);
}
