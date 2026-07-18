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

export const skillFromA = createSkillWorkflow(
	'Instance A Shareable Workflow',
	'skill-from-a',
	'Workflow shared from instance A for ecosystem discovery tests.',
	'instance-a',
	['ecosystem', 'demo-a'],
);

export const skillFromB = createSkillWorkflow(
	'Instance B Shareable Workflow',
	'skill-from-b',
	'Workflow shared from instance B for ecosystem discovery tests.',
	'instance-b',
	['ecosystem', 'demo-b'],
);

export const nonSkillWorkflow = {
	name: 'Private Workflow',
	nodes: [manualTrigger(crypto.randomUUID())],
	connections: {},
	settings: {},
	active: false,
} satisfies N8nWorkflow;
