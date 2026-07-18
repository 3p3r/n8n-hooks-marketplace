import fs from 'node:fs';
import path from 'node:path';
import type { Request, Response } from 'express';
import {
	extractShareableFromWorkflow,
	extractShareablesFromWorkflows,
	type N8nWorkflow,
} from '../shared/index';

type HookContext = {
	dbCollections: {
		Workflow: {
			find: () => Promise<Array<Record<string, unknown>>>;
			findById: (id: string) => Promise<Record<string, unknown> | null>;
		};
	};
};

type N8nServer = {
	app: {
		get: (
			route: string,
			...handlers: Array<(req: Request, res: Response) => void | Promise<void>>
		) => void;
		use: (route: string, handler: (req: Request, res: Response, next: () => void) => void) => void;
	};
	restEndpoint: string;
};

declare const __dirname: string;

const distRoot = path.join(__dirname, '..');
const bridgePath = path.join(distRoot, 'bridge', 'index.js');
const appRoot = path.join(distRoot, 'app');

function sendJson(res: Response, status: number, body: unknown): void {
	res.status(status).json(body);
}

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

function getMqttUrl(): string {
	const url = process.env.MQTT_BROKER_URL?.trim();
	if (!url) {
		throw new Error('MQTT_BROKER_URL is not configured');
	}
	return url;
}

function getEcosystemAppUrl(): string | undefined {
	return process.env.ECOSYSTEM_APP_URL?.trim() || undefined;
}

function registerRoutes(server: N8nServer, ctx: HookContext): void {
	const base = `/${server.restEndpoint}/ecosystem`;

	server.app.get(`${base}/mqtt`, async (_req, res) => {
		try {
			sendJson(res, 200, { url: getMqttUrl() });
		} catch (error) {
			sendJson(res, 500, {
				message: error instanceof Error ? error.message : 'MQTT broker not configured',
			});
		}
	});

	server.app.get(`${base}/config`, async (_req, res) => {
		const devUrl = getEcosystemAppUrl();
		sendJson(res, 200, {
			mode: devUrl ? 'development' : 'production',
			appUrl: devUrl ?? `${base}/app/`,
		});
	});

	server.app.get(`${base}/bridge.js`, async (_req, res) => {
		if (!fs.existsSync(bridgePath)) {
			sendJson(res, 404, { message: 'Bridge bundle not built. Run npm run build.' });
			return;
		}
		res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
		res.send(fs.readFileSync(bridgePath, 'utf8'));
	});

	server.app.get(`${base}/workflows`, async (_req, res) => {
		const workflows = await ctx.dbCollections.Workflow.find();
		const parsed = workflows
			.map((entity) => workflowFromEntity(entity))
			.filter((workflow): workflow is N8nWorkflow => workflow !== null);
		sendJson(res, 200, { workflows: extractShareablesFromWorkflows(parsed) });
	});

	server.app.get(`${base}/workflows/:id`, async (req, res) => {
		const workflowId = req.params.id;
		const entity = await ctx.dbCollections.Workflow.findById(workflowId);
		if (!entity) {
			sendJson(res, 404, { message: 'Workflow not found' });
			return;
		}
		const workflow = workflowFromEntity(entity);
		if (!workflow || !extractShareableFromWorkflow(workflow)) {
			sendJson(res, 404, { message: 'Workflow is not shareable' });
			return;
		}
		sendJson(res, 200, { workflow });
	});

	server.app.use(`${base}/app`, (req, res, next) => {
		const relativePath = req.path === '/' ? 'index.html' : req.path.replace(/^\//, '');
		const filePath = path.join(appRoot, relativePath);
		const resolved = path.resolve(filePath);
		if (!resolved.startsWith(appRoot)) {
			sendJson(res, 403, { message: 'Forbidden' });
			return;
		}

		if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
			res.sendFile(resolved);
			return;
		}

		const indexPath = path.join(appRoot, 'index.html');
		if (fs.existsSync(indexPath)) {
			res.sendFile(indexPath);
			return;
		}

		next();
	});
}

const hooks = {
	n8n: {
		ready: [
			async function (this: HookContext, server: N8nServer) {
				registerRoutes(server, this);
			},
		],
	},
};

module.exports = hooks;
