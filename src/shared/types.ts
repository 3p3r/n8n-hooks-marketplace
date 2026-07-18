export type SkillMetadata = {
	author?: string;
	version?: string;
	tags?: string[];
};

export type SkillFrontmatter = {
	name: string;
	description: string;
	license?: string;
	compatibility?: string;
	metadata?: SkillMetadata;
};

export type ShareableWorkflowSummary = {
	workflowId: string;
	workflowName: string;
	skill: SkillFrontmatter;
};

export type CatalogEntry = {
	instanceId: string;
	instanceName: string;
	workflowId: string;
	workflowName: string;
	skill: SkillFrontmatter;
	publishedAt: string;
};

export type CatalogMessage = {
	instanceId: string;
	instanceName: string;
	entries: CatalogEntry[];
};

export type WorkflowRequestMessage = {
	requesterId: string;
	workflowId: string;
	replyTopic: string;
};

export type WorkflowReplyMessage = {
	workflowId: string;
	workflow: Record<string, unknown>;
};

export type N8nWorkflowNode = {
	id?: string;
	name: string;
	type: string;
	typeVersion?: number;
	position?: [number, number];
	parameters?: Record<string, unknown>;
};

export type N8nWorkflow = {
	id?: string;
	name: string;
	nodes: N8nWorkflowNode[];
	connections?: Record<string, unknown>;
	settings?: Record<string, unknown>;
	active?: boolean;
};

export const STICKY_NOTE_TYPE = 'n8n-nodes-base.stickyNote';

export function catalogTopic(instanceId: string): string {
	return `ecosystem/${instanceId}/catalog`;
}

export function requestTopic(targetInstanceId: string): string {
	return `ecosystem/request/${targetInstanceId}`;
}

export function replyTopic(requesterId: string): string {
	return `ecosystem/reply/${requesterId}`;
}

export function catalogSubscriptionPattern(): string {
	return 'ecosystem/+/catalog';
}

export function requestSubscriptionPattern(instanceId: string): string {
	return `ecosystem/request/${instanceId}`;
}

export function replySubscriptionPattern(requesterId: string): string {
	return `ecosystem/reply/${requesterId}`;
}
