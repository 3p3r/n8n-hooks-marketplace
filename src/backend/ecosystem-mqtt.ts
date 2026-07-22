import debug from 'debug';
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

const log = debug('ecosystem:mqtt');

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

function buildCatalogEntries(instanceId: string, workflows: N8nWorkflow[]): CatalogEntry[] {
	const shareables = extractShareablesFromWorkflows(workflows);
	const publishedAt = new Date().toISOString();
	return shareables.map((item) => ({
		instanceId,
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
	mqttUrl: string,
): Promise<EcosystemMqtt> {
	const client = mqtt.connect(mqttUrl);

	await new Promise<void>((resolve, reject) => {
		client.once('connect', () => resolve());
		client.once('error', (error) => reject(error));
	});

	log('connected instanceId=%s broker=%s', instanceId, mqttUrl);
	client.subscribe(requestSubscriptionPattern(instanceId));

	const republishCatalog = async () => {
		const entities = await workflows.find();
		const parsed = entities
			.map((entity) => workflowFromEntity(entity))
			.filter((workflow): workflow is N8nWorkflow => workflow !== null);
		const entries = buildCatalogEntries(instanceId, parsed);
		const message: CatalogMessage = { instanceId, entries };
		client.publish(catalogTopic(instanceId), JSON.stringify(message), { retain: true });
		log('published catalog instanceId=%s entries=%d', instanceId, entries.length);
	};

	client.on('message', async (_topic, payload) => {
		const message = JSON.parse(payload.toString()) as WorkflowRequestMessage;
		log('workflow request instanceId=%s workflowId=%s', instanceId, message.workflowId);
		const entity = await workflows.findById(message.workflowId);
		if (!entity) return;
		const workflow = workflowFromEntity(entity);
		if (!workflow || !extractShareableFromWorkflow(workflow)) return;
		const reply: WorkflowReplyMessage = { workflowId: message.workflowId, workflow };
		client.publish(message.replyTopic, JSON.stringify(reply));
		log('workflow reply workflowId=%s', message.workflowId);
	});

	await republishCatalog();

	return { republishCatalog, client };
}
