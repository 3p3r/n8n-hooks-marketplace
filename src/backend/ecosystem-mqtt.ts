import mqtt, { type MqttClient } from 'mqtt';
import {
	type CatalogEntry,
	type CatalogMessage,
	catalogTopic,
	extractShareableFromWorkflow,
	extractShareablesFromWorkflows,
	type N8nWorkflow,
	requestSubscriptionPattern,
	type WorkflowReplyMessage,
	type WorkflowRequestMessage,
} from '../shared/index';

type WorkflowCollection = {
	find: () => Promise<Array<Record<string, unknown>>>;
	findById: (id: string) => Promise<Record<string, unknown> | null>;
};

function workflowFromEntity(entity: Record<string, unknown>): N8nWorkflow | null {
	const id = typeof entity.id === 'string' ? entity.id : undefined;
	const name = typeof entity.name === 'string' ? entity.name : undefined;
	const nodes = Array.isArray(entity.nodes) ? entity.nodes : undefined;
	if (!id || !name || !nodes) return null;

	return {
		id,
		name,
		nodes: nodes as N8nWorkflow['nodes'],
		connections:
			entity.connections && typeof entity.connections === 'object'
				? (entity.connections as Record<string, unknown>)
				: {},
		settings:
			entity.settings && typeof entity.settings === 'object'
				? (entity.settings as Record<string, unknown>)
				: {},
		active: Boolean(entity.active),
	};
}

function buildCatalogEntries(
	instanceId: string,
	instanceName: string,
	workflows: N8nWorkflow[],
): CatalogEntry[] {
	const shareables = extractShareablesFromWorkflows(workflows);
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

export type EcosystemMqtt = {
	republishCatalog: () => Promise<void>;
	client: MqttClient;
};

export async function startEcosystemMqtt(
	workflows: WorkflowCollection,
	instanceId: string,
	instanceName: string,
	mqttUrl: string,
): Promise<EcosystemMqtt> {
	const client = mqtt.connect(mqttUrl);

	await new Promise<void>((resolve, reject) => {
		client.once('connect', () => resolve());
		client.once('error', (error) => reject(error));
	});

	client.subscribe(requestSubscriptionPattern(instanceId));

	const republishCatalog = async () => {
		const entities = await workflows.find();
		const parsed = entities
			.map((entity) => workflowFromEntity(entity))
			.filter((workflow): workflow is N8nWorkflow => workflow !== null);
		const entries = buildCatalogEntries(instanceId, instanceName, parsed);
		const message: CatalogMessage = { instanceId, instanceName, entries };
		client.publish(catalogTopic(instanceId), JSON.stringify(message), { retain: true });
	};

	client.on('message', async (_topic, payload) => {
		const message = JSON.parse(payload.toString()) as WorkflowRequestMessage;
		const entity = await workflows.findById(message.workflowId);
		if (!entity) return;
		const workflow = workflowFromEntity(entity);
		if (!workflow || !extractShareableFromWorkflow(workflow)) return;
		const reply: WorkflowReplyMessage = { workflowId: message.workflowId, workflow };
		client.publish(message.replyTopic, JSON.stringify(reply));
	});

	await republishCatalog();

	return { republishCatalog, client };
}
