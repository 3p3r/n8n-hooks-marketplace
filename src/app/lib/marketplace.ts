import mqtt, { type MqttClient } from 'mqtt';
import type {
	CatalogEntry,
	CatalogMessage,
	N8nWorkflow,
	WorkflowReplyMessage,
	WorkflowRequestMessage,
} from '../../shared/index';
import {
	catalogSubscriptionPattern,
	replySubscriptionPattern,
	replyTopic,
	requestTopic,
} from '../../shared/types';

const WORKFLOW_FETCH_TIMEOUT_MS = 15_000;
const REQUESTER_KEY = 'ecosystem-requester-id';

export type EcosystemConfig = {
	mode: 'development' | 'production';
	appUrl: string;
	stylesheets: string[];
	instanceId: string;
};

export async function fetchEcosystemConfig(): Promise<EcosystemConfig> {
	const response = await fetch('/rest/ecosystem/config', { credentials: 'include' });
	if (!response.ok) {
		throw new Error(`Failed to load ecosystem config (${response.status})`);
	}
	return (await response.json()) as EcosystemConfig;
}

export function getRequesterId(): string {
	const existing = localStorage.getItem(REQUESTER_KEY);
	if (existing) return existing;
	const id = crypto.randomUUID();
	localStorage.setItem(REQUESTER_KEY, id);
	return id;
}

export async function fetchMqttUrl(): Promise<string> {
	const response = await fetch('/rest/ecosystem/mqtt', { credentials: 'include' });
	if (!response.ok) {
		throw new Error(`Failed to load MQTT config (${response.status})`);
	}
	const body = (await response.json()) as { url: string };
	return body.url;
}

export async function fetchShareableWorkflow(workflowId: string): Promise<N8nWorkflow> {
	const response = await fetch(`/rest/ecosystem/workflows/${workflowId}`, {
		credentials: 'include',
	});
	if (!response.ok) {
		throw new Error(`Failed to load workflow ${workflowId} (${response.status})`);
	}
	const body = (await response.json()) as { workflow: N8nWorkflow };
	return body.workflow;
}

export async function registerWorkflow(workflow: N8nWorkflow): Promise<void> {
	const payload = {
		name: `${workflow.name} (imported)`,
		nodes: workflow.nodes,
		connections: workflow.connections ?? {},
		settings: workflow.settings ?? {},
	};
	const response = await fetch('/rest/workflows', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		credentials: 'include',
		body: JSON.stringify(payload),
	});
	if (!response.ok) {
		const text = await response.text();
		throw new Error(`Failed to register workflow (${response.status}): ${text}`);
	}
}

export async function connectMarketplace(
	url: string,
	onCatalog: (message: CatalogMessage) => void,
): Promise<MqttClient> {
	const client = mqtt.connect(url, {
		keepalive: 30,
		reconnectPeriod: 5_000,
		connectTimeout: 10_000,
	});

	await new Promise<void>((resolve, reject) => {
		client.once('connect', () => resolve());
		client.once('error', (error) => reject(error));
	});

	client.subscribe(catalogSubscriptionPattern());

	client.on('message', (topic, payload) => {
		if (!topic.endsWith('/catalog')) return;
		onCatalog(JSON.parse(payload.toString()) as CatalogMessage);
	});

	return client;
}

export function requestWorkflow(
	client: MqttClient,
	targetInstanceId: string,
	requesterId: string,
	workflowId: string,
): string {
	const reply = replyTopic(requesterId);
	const message: WorkflowRequestMessage = { requesterId, workflowId, replyTopic: reply };
	client.subscribe(replySubscriptionPattern(requesterId));
	client.publish(requestTopic(targetInstanceId), JSON.stringify(message));
	return reply;
}

export async function fetchPeerWorkflow(
	client: MqttClient,
	requesterId: string,
	entry: CatalogEntry,
): Promise<N8nWorkflow> {
	const reply = requestWorkflow(client, entry.instanceId, requesterId, entry.workflowId);
	return new Promise<N8nWorkflow>((resolve, reject) => {
		const timeout = setTimeout(() => {
			client.off('message', handler);
			reject(new Error('Workflow request timed out'));
		}, WORKFLOW_FETCH_TIMEOUT_MS);

		const handler = (topic: string, payload: Buffer) => {
			if (topic !== reply) return;
			clearTimeout(timeout);
			client.off('message', handler);
			const body = JSON.parse(payload.toString()) as WorkflowReplyMessage;
			resolve(body.workflow);
		};

		client.on('message', handler);
	});
}

export async function fetchWorkflowForEntry(
	client: MqttClient | null,
	ownInstanceId: string,
	requesterId: string,
	entry: CatalogEntry,
): Promise<N8nWorkflow> {
	if (entry.instanceId === ownInstanceId) {
		return fetchShareableWorkflow(entry.workflowId);
	}
	if (!client) {
		throw new Error('MQTT client not ready');
	}
	return fetchPeerWorkflow(client, requesterId, entry);
}

export function downloadWorkflowJson(entry: CatalogEntry, workflow: N8nWorkflow): void {
	const blob = new Blob([JSON.stringify(workflow, null, 2)], { type: 'application/json' });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = `${entry.skill.name}.json`;
	anchor.click();
	URL.revokeObjectURL(url);
}
