import type { Component } from 'svelte';

export interface ScreenshotMetadata {
	title: string;
	excerpt: string;
	description: string;
	order: number;
	uri: string;
	alt: string;
}

export interface Screenshot {
	slug: string;
	path: string;
	metadata: ScreenshotMetadata;
}

interface ScreenshotModule {
	default: Component;
	metadata: ScreenshotMetadata;
}

const screenshotModules = import.meta.glob<ScreenshotModule>('../screenshots-data/*.md');

const slugFromPath = (p: string): string => p.split('/').pop()?.replace(/\.md$/, '') ?? '';

export const fetchScreenshots = async (): Promise<Screenshot[]> => {
	const docs = await Promise.all(
		Object.entries(screenshotModules).map(async ([p, resolver]) => {
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

export const loadScreenshot = async (slug: string): Promise<ScreenshotModule | null> => {
	const key = `../screenshots-data/${slug}.md`;
	const resolver = screenshotModules[key];
	if (!resolver) {
		return null;
	}
	const doc = await resolver();
	if (!doc.metadata) {
		return null;
	}
	return doc;
};
