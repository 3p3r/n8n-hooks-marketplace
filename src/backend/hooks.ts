import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Request, Response } from 'express';
import {
	extractShareableFromWorkflow,
	extractShareablesFromWorkflows,
	type N8nWorkflow,
} from '../shared/index';
import { startEcosystemMqtt } from './ecosystem-mqtt';

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
declare const __filename: string;

const distRoot = path.join(__dirname, '..');
const bridgePath = path.join(distRoot, 'bridge', 'index.js');
const appRoot = path.join(distRoot, 'app');
const requireFromHooks = createRequire(__filename);

let republishCatalog: () => Promise<void>;

function normalizeStylesheetHref(href: string): string {
	return href.replace(/\/\{\{BASE_PATH\}\}/g, '');
}

function resolveN8nStylesheets(req: Request): string[] {
	const packageJson = requireFromHooks.resolve('n8n-editor-ui/package.json');
	const indexPath = path.join(path.dirname(packageJson), 'dist', 'index.html');
	const html = fs.readFileSync(indexPath, 'utf8');
	const stylesheets: string[] = [];
	const origin = `${req.protocol}://${req.get('host')}`;

	for (const match of html.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi)) {
		const hrefMatch = match[0].match(/href=["']([^"']+)["']/i);
		if (!hrefMatch) continue;
		const stylesheet = `${origin}${normalizeStylesheetHref(hrefMatch[1])}`;
		if (!stylesheets.includes(stylesheet)) {
			stylesheets.push(stylesheet);
		}
	}

	if (stylesheets.length === 0) {
		throw new Error(`No stylesheets found in ${indexPath}`);
	}

	return stylesheets;
}

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

function getInstanceIdentity(): { instanceId: string; instanceName: string } {
	const instanceId = process.env.ECOSYSTEM_INSTANCE_ID?.trim();
	const instanceName = process.env.ECOSYSTEM_INSTANCE_NAME?.trim();
	if (!instanceId || !instanceName) {
		throw new Error('ECOSYSTEM_INSTANCE_ID and ECOSYSTEM_INSTANCE_NAME are required');
	}
	return { instanceId, instanceName };
}

function registerRoutes(server: N8nServer, ctx: HookContext): void {
	const base = `/${server.restEndpoint}/ecosystem`;
	const { instanceId, instanceName } = getInstanceIdentity();

	server.app.get(`${base}/mqtt`, async (_req, res) => {
		try {
			sendJson(res, 200, { url: getMqttUrl() });
		} catch (error) {
			sendJson(res, 500, {
				message: error instanceof Error ? error.message : 'MQTT broker not configured',
			});
		}
	});

	server.app.get(`${base}/config`, async (req, res) => {
		try {
			const devUrl = getEcosystemAppUrl();
			sendJson(res, 200, {
				mode: devUrl ? 'development' : 'production',
				appUrl: devUrl ?? `${base}/app/`,
				stylesheets: resolveN8nStylesheets(req),
				instanceId,
				instanceName,
			});
		} catch (error) {
			sendJson(res, 500, {
				message: error instanceof Error ? error.message : 'Failed to resolve ecosystem config',
			});
		}
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
				const { instanceId, instanceName } = getInstanceIdentity();
				registerRoutes(server, this);
				const mqtt = await startEcosystemMqtt(
					this.dbCollections.Workflow,
					instanceId,
					instanceName,
					getMqttUrl(),
				);
				republishCatalog = mqtt.republishCatalog;
			},
		],
	},
	workflow: {
		afterCreate: [
			async () => {
				await republishCatalog();
			},
		],
		afterUpdate: [
			async () => {
				await republishCatalog();
			},
		],
		afterDelete: [
			async () => {
				await republishCatalog();
			},
		],
	},
};

module.exports = hooks;
