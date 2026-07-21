import mqtt, { type MqttClient } from 'mqtt';
import type {
	CatalogEntry,
	CatalogMessage,
	N8nWorkflow,
	ShareableWorkflowSummary,
	WorkflowReplyMessage,
	WorkflowRequestMessage,
} from '../../shared/index';
import {
	catalogSubscriptionPattern,
	catalogTopic,
	type WorkflowRequestMessage as RequestMsg,
	replySubscriptionPattern,
	replyTopic,
	requestSubscriptionPattern,
	requestTopic,
} from '../../shared/types';

const INSTANCE_KEY = 'ecosystem-instance-id';
const INSTANCE_NAME_KEY = 'ecosystem-instance-name';

export function getInstanceId(): string {
	const existing = localStorage.getItem(INSTANCE_KEY);
	if (existing) return existing;
	const id = crypto.randomUUID();
	localStorage.setItem(INSTANCE_KEY, id);
	return id;
}

export function getInstanceName(): string {
	const existing = localStorage.getItem(INSTANCE_NAME_KEY);
	if (existing) return existing;
	const id = getInstanceId();
	const name = `n8n-${id.slice(0, 8)}`;
	localStorage.setItem(INSTANCE_NAME_KEY, name);
	return name;
}

export async function fetchMqttUrl(): Promise<string> {
	const response = await fetch('/rest/ecosystem/mqtt', { credentials: 'include' });
	if (!response.ok) {
		throw new Error(`Failed to load MQTT config (${response.status})`);
	}
	const body = (await response.json()) as { url: string };
	return body.url;
}

export async function fetchLocalShareables(): Promise<ShareableWorkflowSummary[]> {
	const response = await fetch('/rest/ecosystem/workflows', { credentials: 'include' });
	if (!response.ok) {
		throw new Error(`Failed to load local workflows (${response.status})`);
	}
	const body = (await response.json()) as { workflows: ShareableWorkflowSummary[] };
	return body.workflows;
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

export type MqttHandlers = {
	onCatalog: (message: CatalogMessage) => void;
	onWorkflowRequest: (message: WorkflowRequestMessage) => Promise<void>;
	onWorkflowReply?: (message: WorkflowReplyMessage) => void;
};

export async function connectMarketplace(
	url: string,
	instanceId: string,
	handlers: MqttHandlers,
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
	client.subscribe(requestSubscriptionPattern(instanceId));

	client.on('message', async (topic, payload) => {
		const text = payload.toString();
		let data: unknown;
		try {
			data = JSON.parse(text);
		} catch {
			return;
		}

		if (topic.endsWith('/catalog')) {
			handlers.onCatalog(data as CatalogMessage);
			return;
		}

		if (topic.startsWith('ecosystem/request/')) {
			await handlers.onWorkflowRequest(data as RequestMsg);
			return;
		}

		if (topic.startsWith('ecosystem/reply/')) {
			handlers.onWorkflowReply?.(data as WorkflowReplyMessage);
		}
	});

	return client;
}

export function publishCatalog(
	client: MqttClient,
	instanceId: string,
	instanceName: string,
	entries: CatalogEntry[],
): void {
	const message: CatalogMessage = { instanceId, instanceName, entries };
	client.publish(catalogTopic(instanceId), JSON.stringify(message), { retain: true });
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

export function publishWorkflowReply(
	client: MqttClient,
	replyTopicName: string,
	workflowId: string,
	workflow: N8nWorkflow,
): void {
	const message: WorkflowReplyMessage = { workflowId, workflow };
	client.publish(replyTopicName, JSON.stringify(message));
}

export function buildCatalogEntries(
	instanceId: string,
	instanceName: string,
	shareables: ShareableWorkflowSummary[],
): CatalogEntry[] {
	const publishedAt = new Date().toISOString();
	return shareables.map((item) => ({
		instanceId,
		instanceName,
		workflowId: item.workflowId,
		workflowName: item.workflowName,
		skill: item.skill,
		publishedAt,
	}));
}
