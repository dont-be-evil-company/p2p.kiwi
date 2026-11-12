<script lang="ts">
	import HeadComponent from '#lib/HeadComponent.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<HeadComponent
	data={{
		title: `${data.metadata.title} · p2p.kiwi screenshots`,
		description: data.metadata.description
	}}
/>

<div class="hero bg-base-200 min-h-screen">
	<div class="hero-content w-full max-w-full min-w-0 text-center">
		<div class="w-full max-w-3xl min-w-0 py-10">
			<a href="/screenshots">
				<img src="/logo.png" alt="p2p.kiwi logo" class="m-5 mx-auto w-32" />
			</a>
			<h1 class="text-5xl font-bold">{data.metadata.title}</h1>
			<p class="py-6">{data.metadata.excerpt}</p>
			<img
				src="/assets/screenshots/{data.metadata.uri}"
				alt={data.metadata.alt}
				class="m-5 mx-auto w-full max-w-3xl rounded-lg shadow-lg"
			/>
			<article class="screenshots-article text-left">
				<data.content />
			</article>
			<p class="text-center">
				<a href="/screenshots"><button class="btn btn-primary mt-8">All Screenshots</button></a>
			</p>
		</div>
	</div>
</div>

<style>
	.screenshots-article :global(h2) {
		font-size: 1.5rem;
		font-weight: 700;
		margin-top: 2rem;
		margin-bottom: 0.75rem;
	}

	.screenshots-article :global(h3) {
		font-size: 1.25rem;
		font-weight: 700;
		margin-top: 1.5rem;
		margin-bottom: 0.5rem;
	}

	.screenshots-article :global(p) {
		margin: 0.75rem 0;
		line-height: 1.7;
	}

	.screenshots-article :global(a) {
		color: var(--color-secondary);
	}

	.screenshots-article :global(ul),
	.screenshots-article :global(ol) {
		margin: 0.75rem 0;
		padding-left: 1.25rem;
	}

	.screenshots-article :global(li) {
		margin: 0.25rem 0;
		line-height: 1.6;
	}

	.screenshots-article :global(ul) {
		list-style: disc;
	}

	.screenshots-article :global(ol) {
		list-style: decimal;
	}

	.screenshots-article :global(table) {
		width: 100%;
		border-collapse: collapse;
		margin: 1.5rem 0;
		font-size: 0.875rem;
	}

	.screenshots-article :global(th),
	.screenshots-article :global(td) {
		border: 1px solid var(--color-base-300);
		padding: 0.5rem 0.75rem;
		text-align: left;
		vertical-align: top;
	}

	.screenshots-article :global(th) {
		background: var(--color-base-100);
		font-weight: 600;
	}

	.screenshots-article :global(strong) {
		font-weight: 700;
	}
</style>
