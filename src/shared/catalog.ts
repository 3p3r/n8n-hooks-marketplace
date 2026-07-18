import { isValidSkillName, parseSkillMarkdown } from './skill-parser';
import type { N8nWorkflow, N8nWorkflowNode, ShareableWorkflowSummary } from './types';
import { STICKY_NOTE_TYPE } from './types';

function getStickyContent(node: N8nWorkflowNode): string | null {
	if (node.type !== STICKY_NOTE_TYPE) return null;
	const content = node.parameters?.content;
	return typeof content === 'string' ? content : null;
}

export function extractShareableFromWorkflow(
	workflow: N8nWorkflow,
): ShareableWorkflowSummary | null {
	if (!workflow.id) return null;

	for (const node of workflow.nodes) {
		const content = getStickyContent(node);
		if (!content) continue;

		const skill = parseSkillMarkdown(content);
		if (!skill || !isValidSkillName(skill.name)) continue;

		return {
			workflowId: workflow.id,
			workflowName: workflow.name,
			skill,
		};
	}

	return null;
}

export function extractShareablesFromWorkflows(
	workflows: N8nWorkflow[],
): ShareableWorkflowSummary[] {
	return workflows
		.map((workflow) => extractShareableFromWorkflow(workflow))
		.filter((entry): entry is ShareableWorkflowSummary => entry !== null);
}

export function stripWorkflowForImport(workflow: N8nWorkflow): N8nWorkflow {
	const { id: _id, active: _active, ...rest } = workflow;
	return {
		...rest,
		name: `${workflow.name} (imported)`,
		active: false,
	};
}
