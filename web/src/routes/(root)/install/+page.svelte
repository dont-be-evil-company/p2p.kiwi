<script lang="ts">
	import HeadComponent from '$lib/HeadComponent.svelte';
	import CodeBlock from '$lib/CodeBlock.svelte';
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { redirect } from '@sveltejs/kit';
	import { resolve } from '$app/paths';
	const installSystems = [
		{
			name: 'Linux',
			value: 'linux'
		},
		{
			name: 'Arch Linux (AUR)',
			value: 'aur'
		},
		{
			name: 'MacOS',
			value: 'macos'
		},
		{
			name: 'Windows',
			value: 'windows'
		},
		{
			name: 'manual',
			value: 'manual'
		}
	] as const;
	type InstallSystem = (typeof installSystems)[number]['value'];
	let installSystem: InstallSystem = 'linux';
	const isValidInstallSystem = (value: string): value is InstallSystem => {
		return installSystems.some((system) => system.value === value);
	};
	let form: HTMLFormElement | undefined = undefined;
	const onInstallSystemChange = () => {
		if (!browser || !form) return;
		const formData = new FormData(form);
		const typeParam = formData.get('type');
		if (typeParam && typeof typeParam === 'string' && isValidInstallSystem(typeParam)) {
			installSystem = typeParam;
			const url = new URL(window.location.href);
			url.searchParams.set('type', typeParam);
			window.history.replaceState({}, '', url.toString());
		}
	};
	onMount(() => {
		if (!browser) return;
		const urlParams = new URLSearchParams(window.location.search);
		const typeParam = urlParams.get('type');
		if (typeParam && !installSystems.some((system) => system.value === typeParam)) {
			redirect(302, '/install?type=unix');
		}
		if (typeParam && typeof typeParam === 'string' && isValidInstallSystem(typeParam)) {
			installSystem = typeParam;
		} else {
			installSystem = 'linux';
		}
	});
</script>

<HeadComponent
	data={{
		title: 'Install · p2p.kiwi',
		description:
			'p2p.kiwi install: Install p2p.kiwi via homebrew, Arch-Linux User Repository, or manually.'
	}}
/>

<div id="install" class="hero bg-base-200 min-h-screen">
	<div class="hero-content w-full max-w-full min-w-0 text-center">
		<div class="w-full max-w-md min-w-0">
			<a href="/">
				<img src="/logo.png" alt="p2p.kiwi logo" class="m-5 mx-auto w-32" />
			</a>
			<h1 class="text-5xl font-bold">Install ⚡</h1>
			<p class="py-6">Install p2p.kiwi via ...</p>
			<form method="GET" bind:this={form}>
				<select name="type" on:input={onInstallSystemChange} class="select select-bordered mb-5">
					{#each installSystems as system}
						<option value={system.value} selected={installSystem === system.value}
							>{system.name}</option
						>
					{/each}
				</select>
			</form>
			<div class={installSystem === 'linux' ? '' : 'hidden'}>
				<p class="mb-5">Linux:</p>
				<div class="mb-5 text-left">
					<CodeBlock lang="sh" code={`brew install --cask p2p-kiwi`} />
				</div>
				<div role="alert" class="alert alert-info mb-5">
					<span class="fa-solid fa-circle-info mr-2"></span>
					<span
						>The brew package is not maintained by <a
							class="link text-info-content link-external"
							href="https://the-dont-be-evil-company.com">us</a
						>, but by
						<a class="link text-info-content link-external" href="https://github.com/krehel"
							>Justin Krehel</a
						>(Lead Maintainer @ Homebrew); so
						<a
							class="link text-info-content link-external"
							href="https://formulae.brew.sh/cask/p2p-kiwi">inspect carefully</a
						>, before installing.</span
					>
				</div>
				<p class="mb-5">.. or download the one of the pre-built binaries here:</p>
				<ul class="list-inside list-disc text-left">
					<li>
						<a class="link link-info link-external" href={resolve('/download/linux/deb/amd64')}
							>Linux .deb (amd64)</a
						>
					</li>
					<li>
						<a class="link link-info link-external" href={resolve('/download/linux/deb/arm64')}
							>Linux .deb (arm64)</a
						>
					</li>
					<li>
						<a
							class="link link-info link-external"
							href={resolve('/download/linux/appimage/x86_64')}>Linux .AppImage (x86_64)</a
						>
					</li>
					<li>
						<a class="link link-info link-external" href={resolve('/download/linux/appimage/arm64')}
							>Linux .AppImage (arm64)</a
						>
					</li>
					<li>
						<a class="link link-info link-external" href={resolve('/download/linux/flatpak/x86_64')}
							>Linux .flatpak (x86_64)</a
						>
					</li>
					<li>
						<a
							class="link link-info link-external"
							href={resolve('/download/linux/flatpak/aarch64')}>Linux .flatpak (aarch64)</a
						>
					</li>
					<li>
						<a class="link link-info link-external" href={resolve('/download/linux/snap/amd64')}
							>Linux .snap (amd64)</a
						>
					</li>
				</ul>
			</div>
			<div class={installSystem === 'macos' ? '' : 'hidden'}>
				<p class="mb-5">MacOS:</p>
				<div class="mb-5 text-left">
					<CodeBlock lang="sh" code={`brew install --cask p2p-kiwi`} />
				</div>
				<div role="alert" class="alert alert-info mb-5">
					<span class="fa-solid fa-circle-info mr-2"></span>
					<span
						>The brew package is not maintained by <a
							class="link text-info-content link-external"
							href="https://the-dont-be-evil-company.com">us</a
						>, but by
						<a class="link text-info-content link-external" href="https://github.com/krehel"
							>Justin Krehel</a
						>(Lead Maintainer @ Homebrew); so
						<a
							class="link text-info-content link-external"
							href="https://formulae.brew.sh/cask/p2p-kiwi">inspect carefully</a
						>, before installing.</span
					>
				</div>
				<p>
					.. or download the <a
						class="link link-info link-external"
						href={resolve('/(redirects)/download/macos')}>universal.dmg</a
					> manually.
				</p>
			</div>
			<div class={installSystem === 'windows' ? '' : 'hidden'}>
				<p class="mb-5">
					Windows (via <a class="link link-info link-external" href={resolve('/download/windows')}
						>Microsoft Apps Store</a
					>):
				</p>
				<p class="mb-5">
					or via <a class="link link-info link-external" href="https://chocolatey.org/install"
						>chocolatey</a
					>:
				</p>
				<div class="mb-5 text-left">
					<CodeBlock lang="powershell" code={`choco install p2p-kiwi`} />
				</div>
				<div role="alert" class="alert alert-warning mb-5">
					<span class="fa fa-exclamation-triangle mr-2"></span>
					<span
						>The chocolatey package is not maintained by <a
							class="link text-warning-content link-external"
							href="https://the-dont-be-evil-company.com">us</a
						>; so
						<a
							class="link text-warning-content link-external"
							href="https://community.chocolatey.org/packages/p2p-kiwi">inspect carefully</a
						>, before installing.</span
					>
				</div>
				<p>
					.. or download the <a
						class="link link-info link-external"
						href={resolve('/download/windows/installer')}>setup.exe</a
					> manually.
				</p>
			</div>
			<div class={installSystem === 'manual' ? '' : 'hidden'}>
				<p class="mb-5">
					Download the latest release from the <a class="text-secondary" href="/download"
						>releases page</a
					>.
				</p>
			</div>
			<div class={installSystem === 'aur' ? '' : 'hidden'}>
				<p class="mb-5">
					Via AUR, using an AUR helper like <a
						href="https://github.com/Jguer/yay"
						class="text-secondary">yay</a
					>
				</p>
				<div class="text-left">
					<CodeBlock lang="sh" code={`yay -S p2p-kiwi-bin`} />
				</div>
				<p class="mt-5 mb-5">
					.. or via <a href="https://github.com/morganamilo/paru" class="text-secondary">paru</a>
				</p>
				<div class="mb-5 text-left">
					<CodeBlock lang="sh" code={`paru -S p2p-kiwi-bin`} />
				</div>

				<div role="alert" class="alert alert-warning mb-5">
					<span class="fa fa-exclamation-triangle mr-2"></span>
					<span
						>The AUR package is not maintained by <a
							class="link text-warning-content link-external"
							href="https://the-dont-be-evil-company.com">us</a
						>; so
						<a
							class="link text-warning-content link-external"
							href="https://aur.archlinux.org/packages/p2p-kiwi-bin">inspect carefully</a
						>, before installing.</span
					>
				</div>
				<div role="alert" class="alert alert-info">
					<span class="fa-solid fa-circle-info mr-2"></span>
					<span
						>As of now (2026-09-23) the AUR package doesn't install the necessary
						<a
							class="link text-info-content link-external"
							href="https://raw.githubusercontent.com/dont-be-evil-company/p2p.kiwi/refs/heads/main/build/udev/70-p2p-kiwi-input.rules"
							>udev rules</a
						>
						for reading keyboard input events, so remote control won't work out of the box.
					</span>
				</div>
				<details class="mt-5 mb-5">
					<summary class="cursor-pointer">Show instructions for installing udev rules</summary>
					<p class="mt-5 mb-5 text-sm">
						If you want to use remote control, please install the
						<a
							class="link text-info link-external"
							href="https://raw.githubusercontent.com/dont-be-evil-company/p2p.kiwi/refs/heads/main/build/udev/70-p2p-kiwi-input.rules"
							>udev rules</a
						>
						manually by copying the rules file to <code>/etc/udev/rules.d/</code>
						and then
					</p>
					<CodeBlock
						lang="sh"
						code={`sudo chmod 644 /etc/udev/rules.d/70-p2p-kiwi-input.rules && sudo udevadm control --reload-rules || true && sudo udevadm trigger --subsystem-match=input --subsystem-match=misc || true`}
					/>
				</details>
			</div>
			<p>
				<a href="/"><button class="btn btn-primary mt-8">Back home</button></a>
			</p>
		</div>
	</div>
</div>
