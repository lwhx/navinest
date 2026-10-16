<script lang="ts">
	import { onMount } from 'svelte';
	import MediaImage from './MediaImage.svelte';
	let { id, onclose }: { id: string | number; onclose: () => void } = $props();
	let dialog: HTMLDialogElement;
	const uid = $props.id();
	onMount(() => {
		dialog.showModal();
	});
</script>

<dialog
	bind:this={dialog}
	aria-labelledby={uid}
	{onclose}
	onkeydown={(event) => event.stopPropagation()}
>
	<div class="preview-heading">
		<h2 id={uid}>图片预览 · #{id}</h2>
		<button
			class="admin-secondary-button"
			type="button"
			onclick={() => dialog.close()}
			aria-label="关闭图片预览">关闭</button
		>
	</div>
	<MediaImage {id} alt={`图片 #${id} 大图预览`} large />
</dialog>

<style>
	dialog {
		width: min(900px, calc(100vw - 24px));
		max-height: calc(100dvh - 24px);
		overflow: auto;
		border: 1px solid var(--admin-border);
		border-radius: 16px;
		padding: 20px;
		color: var(--admin-text);
		background: var(--admin-surface);
	}
	dialog::backdrop {
		background: rgba(0, 0, 0, 0.65);
	}
	.preview-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 16px;
	}
	h2 {
		margin: 0;
		font-size: 18px;
	}
</style>
