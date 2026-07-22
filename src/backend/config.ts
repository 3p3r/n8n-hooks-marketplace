import { createHash } from 'node:crypto';
import { machineIdSync } from 'node-machine-id';
import rc from 'rc';

const conf = rc('ecosystem', {
	mqttBrokerUrl: '',
	instanceId: '',
	appUrl: '',
});

function defaultInstanceId(): string {
	const address =
		process.env.N8N_EDITOR_BASE_URL?.trim() ||
		`http://${process.env.N8N_HOST || '127.0.0.1'}:${process.env.N8N_PORT || '5678'}`;
	return createHash('sha256')
		.update(address + machineIdSync())
		.digest('hex')
		.slice(0, 8);
}

export type EcosystemBackendConfig = {
	mqttBrokerUrl: string;
	instanceId: string;
	appUrl: string | undefined;
};

export function loadConfig(): EcosystemBackendConfig {
	const mqttBrokerUrl = conf.mqttBrokerUrl;
	if (!mqttBrokerUrl) {
		throw new Error('ecosystem.mqttBrokerUrl is required');
	}
	return {
		mqttBrokerUrl,
		instanceId: conf.instanceId || defaultInstanceId(),
		appUrl: conf.appUrl || undefined,
	};
}
