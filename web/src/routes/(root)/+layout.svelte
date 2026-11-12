<script lang="ts">
	import '../../app.css';
	import '@dont-be-evil-company/mdsvex-shiki/styles.css';
	import { copyAction } from '@dont-be-evil-company/mdsvex-shiki/copyAction';

	let { children } = $props();
</script>

<div use:copyAction>
	{@render children()}
</div>
