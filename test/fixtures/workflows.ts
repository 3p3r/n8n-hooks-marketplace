import type { N8nWorkflow } from '../../src/shared/index';

function skillStickyNote(name: string, description: string, author: string, tags: string[]) {
	const frontmatter = [
		'---',
		`name: ${name}`,
		`description: ${description}`,
		'metadata:',
		`  author: ${author}`,
		'  version: "1.0"',
		'  tags:',
		...tags.map((tag) => `    - ${tag}`),
		'---',
		'',
		'Shared through the ecosystem marketplace.',
	].join('\n');

	return {
		parameters: {
			content: frontmatter,
			height: 220,
			width: 360,
			color: 4,
		},
		id: crypto.randomUUID(),
		name: 'Skill Note',
		type: 'n8n-nodes-base.stickyNote',
		typeVersion: 1,
		position: [420, 240] as [number, number],
	};
}

function manualTrigger(id: string) {
	return {
		parameters: {},
		id,
		name: 'Manual Trigger',
		type: 'n8n-nodes-base.manualTrigger',
		typeVersion: 1,
		position: [240, 240] as [number, number],
	};
}

export function createSkillWorkflow(
	name: string,
	skillName: string,
	description: string,
	author: string,
	tags: string[],
): N8nWorkflow {
	const triggerId = crypto.randomUUID();
	return {
		name,
		nodes: [manualTrigger(triggerId), skillStickyNote(skillName, description, author, tags)],
		connections: {},
		settings: {},
		active: false,
	};
}

export const nonSkillWorkflow = {
	name: 'Private Workflow',
	nodes: [manualTrigger(crypto.randomUUID())],
	connections: {},
	settings: {},
	active: false,
} satisfies N8nWorkflow;

export const invoiceParser = createSkillWorkflow(
	'Invoice Parser Workflow',
	'invoice-parser',
	'Extract structured data from invoice PDFs using OCR pipelines.',
	'alice',
	['finance', 'ocr'],
);

export const slackNotifier = createSkillWorkflow(
	'Slack Notifier Workflow',
	'slack-notifier',
	'Send formatted alerts to Slack channels when workflows complete.',
	'alice',
	['comms', 'alerts'],
);

export const csvImporter = createSkillWorkflow(
	'CSV Importer Workflow',
	'csv-importer',
	'Import CSV files into databases with column mapping and validation.',
	'bob',
	['finance', 'etl'],
);

export const webhookRelay = createSkillWorkflow(
	'Webhook Relay Workflow',
	'webhook-relay',
	'Relay inbound HTTP webhooks to downstream services with retry logic.',
	'bob',
	['http', 'infra'],
);

export const pdfMerger = createSkillWorkflow(
	'PDF Merger Workflow',
	'pdf-merger',
	'Merge multiple PDF documents into a single output file.',
	'carol',
	['docs', 'pdf'],
);

export const healthPing = createSkillWorkflow(
	'Health Ping Workflow',
	'health-ping',
	'Periodic health checks against HTTP endpoints with alert routing.',
	'carol',
	['ops', 'alerts'],
);

export type InstanceSeed = {
	name: string;
	workflows: N8nWorkflow[];
};

export const seedPlan: InstanceSeed[] = [
	{
		name: 'instance-a',
		workflows: [invoiceParser, slackNotifier, nonSkillWorkflow],
	},
	{
		name: 'instance-b',
		workflows: [csvImporter, webhookRelay, nonSkillWorkflow],
	},
	{
		name: 'instance-c',
		workflows: [pdfMerger, healthPing, nonSkillWorkflow],
	},
];

export const allPeerSkillNames = [
	'invoice-parser',
	'slack-notifier',
	'csv-importer',
	'webhook-relay',
	'pdf-merger',
	'health-ping',
] as const;

export type PeerSkillName = (typeof allPeerSkillNames)[number];

export function peerSkillsFor(instanceName: string): PeerSkillName[] {
	switch (instanceName) {
		case 'instance-a':
			return ['csv-importer', 'webhook-relay', 'pdf-merger', 'health-ping'];
		case 'instance-b':
			return ['invoice-parser', 'slack-notifier', 'pdf-merger', 'health-ping'];
		case 'instance-c':
			return ['invoice-parser', 'slack-notifier', 'csv-importer', 'webhook-relay'];
		default:
			throw new Error(`Unknown instance: ${instanceName}`);
	}
}

export function localSkillNames(instanceName: string): string[] {
	switch (instanceName) {
		case 'instance-a':
			return ['invoice-parser', 'slack-notifier'];
		case 'instance-b':
			return ['csv-importer', 'webhook-relay'];
		case 'instance-c':
			return ['pdf-merger', 'health-ping'];
		default:
			throw new Error(`Unknown instance: ${instanceName}`);
	}
}
