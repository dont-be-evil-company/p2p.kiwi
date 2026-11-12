<script lang="ts">
	import HeadComponent from '#lib/HeadComponent.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<HeadComponent
	data={{
		title: `${data.metadata.title} · p2p.kiwi docs`,
		description: data.metadata.description
	}}
/>

<div class="hero bg-base-200 min-h-screen">
	<div class="hero-content w-full max-w-full min-w-0 text-center">
		<div class="w-full max-w-3xl min-w-0 py-10">
			<a href="/docs">
				<img src="/logo.png" alt="p2p.kiwi logo" class="m-5 mx-auto w-32" />
			</a>
			<h1 class="text-5xl font-bold">{data.metadata.title}</h1>
			<p class="py-6">{data.metadata.excerpt}</p>
			<article class="docs-article text-left">
				<data.content />
			</article>
			<p class="text-center">
				<a href="/docs"><button class="btn btn-primary mt-8">All docs</button></a>
			</p>
		</div>
	</div>
</div>

<style>
	.docs-article :global(h2) {
		font-size: 1.5rem;
		font-weight: 700;
		margin-top: 2rem;
		margin-bottom: 0.75rem;
	}

	.docs-article :global(h3) {
		font-size: 1.25rem;
		font-weight: 700;
		margin-top: 1.5rem;
		margin-bottom: 0.5rem;
	}

	.docs-article :global(p) {
		margin: 0.75rem 0;
		line-height: 1.7;
	}

	.docs-article :global(a) {
		color: var(--color-secondary);
	}

	.docs-article :global(ul),
	.docs-article :global(ol) {
		margin: 0.75rem 0;
		padding-left: 1.25rem;
	}

	.docs-article :global(li) {
		margin: 0.25rem 0;
		line-height: 1.6;
	}

	.docs-article :global(ul) {
		list-style: disc;
	}

	.docs-article :global(ol) {
		list-style: decimal;
	}

	.docs-article :global(table) {
		width: 100%;
		border-collapse: collapse;
		margin: 1.5rem 0;
		font-size: 0.875rem;
	}

	.docs-article :global(th),
	.docs-article :global(td) {
		border: 1px solid var(--color-base-300);
		padding: 0.5rem 0.75rem;
		text-align: left;
		vertical-align: top;
	}

	.docs-article :global(th) {
		background: var(--color-base-100);
		font-weight: 600;
	}

	.docs-article :global(strong) {
		font-weight: 700;
	}
</style>
