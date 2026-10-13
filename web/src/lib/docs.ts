import type { Component } from 'svelte';

export interface DocMetadata {
	title: string;
	excerpt: string;
	description: string;
	order: number;
}

export interface Doc {
	slug: string;
	path: string;
	metadata: DocMetadata;
}

interface DocModule {
	default: Component;
	metadata: DocMetadata;
}

const docModules = import.meta.glob<DocModule>('../docs-data/*.md');

const slugFromPath = (p: string): string => p.split('/').pop()?.replace(/\.md$/, '') ?? '';

export const fetchDocs = async (): Promise<Doc[]> => {
	const docs = await Promise.all(
		Object.entries(docModules).map(async ([p, resolver]) => {
			const doc = await resolver();
			const slug = slugFromPath(p);
			return {
				slug,
				path: `docs/${slug}`,
				metadata: doc.metadata
			};
		})
	);

	return docs.sort((a, b) => a.metadata.order - b.metadata.order);
};

export const loadDoc = async (slug: string): Promise<DocModule | null> => {
	const key = `../docs-data/${slug}.md`;
	const resolver = docModules[key];
	if (!resolver) {
		return null;
	}
	const doc = await resolver();
	if (!doc.metadata) {
		return null;
	}
	return doc;
};
