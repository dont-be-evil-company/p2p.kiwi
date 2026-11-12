<script lang="ts">
	import HeadComponent from '#lib/HeadComponent.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<HeadComponent
	data={{
		title: 'Docs · p2p.kiwi',
		description:
			'Architecture, sync protocol, cryptography, threat model, rclone, configuration, and the configuration wizard.'
	}}
/>

<div id="docs" class="hero bg-base-200 min-h-screen">
	<div class="hero-content w-full max-w-full min-w-0 text-center">
		<div class="w-full max-w-5xl min-w-0">
			<a href="/">
				<img src="/logo.png" alt="p2p.kiwi logo" class="m-5 mx-auto w-32" />
			</a>
			<h1 class="text-5xl font-bold">Docs 📚</h1>
			<p class="py-6">E2EE, configuration, threat model, ...</p>
			<div class="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
				{#each data.docs as doc (doc.slug)}
					<a href="/docs/{doc.slug}" class="block">
						<div class="card bg-base-100 mx-auto h-full w-full max-w-96 shadow-sm">
							<div class="card-body">
								<h2 class="card-title justify-center">{doc.metadata.title}</h2>
								<p>{doc.metadata.excerpt}</p>
								<div class="card-actions justify-end">
									<span class="badge badge-outline">docs</span>
								</div>
							</div>
						</div>
					</a>
				{/each}
			</div>
			<p>
				<a href="/"><button class="btn btn-primary mt-8">Back home</button></a>
			</p>
		</div>
	</div>
</div>
