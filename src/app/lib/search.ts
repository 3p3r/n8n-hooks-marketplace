import Fuse from 'fuse.js';
import { useMemo } from 'react';
import type { CatalogEntry } from '../../shared/index';

export function useFuzzyCatalog(entries: CatalogEntry[], query: string): CatalogEntry[] {
	const fuse = useMemo(
		() =>
			new Fuse(entries, {
				keys: [
					'skill.name',
					'skill.description',
					'workflowName',
					'instanceName',
					'skill.metadata.author',
					'skill.metadata.tags',
				],
				threshold: 0.4,
			}),
		[entries],
	);

	return useMemo(() => {
		if (!query.trim()) return entries;
		return fuse.search(query).map((result) => result.item);
	}, [entries, fuse, query]);
}

export function filterCatalog(
	entries: CatalogEntry[],
	author: string,
	tag: string,
): CatalogEntry[] {
	return entries.filter((entry) => {
		const authorMatch =
			!author || entry.skill.metadata?.author?.toLowerCase().includes(author.toLowerCase());
		const tagMatch =
			!tag ||
			entry.skill.metadata?.tags?.some((value) => value.toLowerCase().includes(tag.toLowerCase()));
		return authorMatch && tagMatch;
	});
}
