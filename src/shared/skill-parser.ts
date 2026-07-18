import { parse as parseYaml } from 'yaml';
import type { SkillFrontmatter } from './types';

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

function normalizeTags(value: unknown): string[] | undefined {
	if (value === undefined || value === null) return undefined;
	if (Array.isArray(value)) return value.map(String);
	if (typeof value === 'string') {
		return value
			.split(',')
			.map((tag) => tag.trim())
			.filter(Boolean);
	}
	return undefined;
}

export function parseSkillMarkdown(content: string): SkillFrontmatter | null {
	const match = content.match(FRONTMATTER_RE);
	if (!match) return null;

	let parsed: unknown;
	try {
		parsed = parseYaml(match[1]);
	} catch {
		return null;
	}

	if (!parsed || typeof parsed !== 'object') return null;

	const record = parsed as Record<string, unknown>;
	const name = typeof record.name === 'string' ? record.name.trim() : '';
	const description = typeof record.description === 'string' ? record.description.trim() : '';
	if (!name || !description) return null;

	const metadataRecord =
		record.metadata && typeof record.metadata === 'object'
			? (record.metadata as Record<string, unknown>)
			: undefined;

	const metadata = metadataRecord
		? {
				author: typeof metadataRecord.author === 'string' ? metadataRecord.author : undefined,
				version: typeof metadataRecord.version === 'string' ? metadataRecord.version : undefined,
				tags: normalizeTags(metadataRecord.tags),
			}
		: undefined;

	return {
		name,
		description,
		license: typeof record.license === 'string' ? record.license : undefined,
		compatibility: typeof record.compatibility === 'string' ? record.compatibility : undefined,
		metadata,
	};
}

export function isValidSkillName(name: string): boolean {
	return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) && name.length <= 64;
}
