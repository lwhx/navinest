<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ContributionSnapshot } from '$lib/contribution-types';

	let {
		iconFileId,
		iconPreviewUrl,
		snapshot,
		busy,
		iconSaving,
		fieldError,
		onsaveremote,
		onupload,
		onremove
	}: {
		iconFileId: number | null;
		iconPreviewUrl: string;
		snapshot: ContributionSnapshot | null;
		busy: boolean;
		iconSaving: boolean;
		fieldError: Snippet<[string]>;
		onsaveremote: () => void;
		onupload: (event: Event) => void;
		onremove: () => void;
	} = $props();
</script>

<div class="icon-editor">
	<div class="icon-preview">
		{#if iconPreviewUrl}<img src={iconPreviewUrl} alt="当前投稿图标" />{:else}<span>图标</span>{/if}
	</div>
	<div>
		<strong>图标（选填）</strong>
		<p>{iconFileId ? '已选择图标，可替换或移除。' : '可采用网页图标，或手动上传。'}</p>
		<div class="icon-actions">
			{#if snapshot?.iconUrl && !iconFileId}<button
					type="button"
					disabled={busy}
					onclick={onsaveremote}>使用网页图标</button
				>{/if}<label class="icon-upload"
				><input
					type="file"
					accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml,image/x-icon"
					aria-label="手动上传图标"
					onchange={onupload}
					disabled={busy}
				/><span>{iconSaving ? '保存中…' : '手动上传'}</span></label
			>{#if iconFileId}<button type="button" disabled={busy} onclick={onremove}>移除图标</button
				>{/if}
		</div>
		{@render fieldError('iconFileId')}
	</div>
</div>

<style>
	.icon-editor {
		display: grid;
		grid-template-columns: 56px minmax(0, 1fr);
		gap: 12px;
		align-items: start;
		padding: 12px;
		border: 1px solid var(--ui-line);
		border-radius: 10px;
	}
	.icon-editor strong {
		color: var(--ui-text);
		font-size: 15px;
	}
	.icon-editor p {
		margin: 6px 0;
		color: var(--ui-muted);
		font-size: 13px;
		line-height: 1.7;
	}
	.icon-preview {
		display: grid;
		width: 56px;
		height: 56px;
		place-items: center;
		background: var(--ui-soft);
		color: var(--ui-muted);
		border-radius: 10px;
		font-size: 13px;
	}
	.icon-preview img {
		width: 100%;
		height: 100%;
		object-fit: contain;
	}
	.icon-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.icon-actions button,
	.icon-upload span {
		border: 1px solid var(--ui-line);
		border-radius: 8px;
		padding: 10px 12px;
		color: var(--ui-text);
		background: var(--ui-soft);
		font: inherit;
		font-size: 13px;
		cursor: pointer;
	}
	.icon-actions button,
	.icon-upload span {
		min-height: 44px;
	}
	.icon-upload {
		position: relative;
		display: inline-flex;
		cursor: pointer;
	}
	.icon-upload input {
		position: absolute;
		width: 1px;
		height: 1px;
		min-height: 0;
		opacity: 0;
	}
	.icon-upload:focus-within {
		outline: 2px solid var(--ui-accent);
		outline-offset: 2px;
		border-radius: 8px;
	}
	.icon-upload span {
		display: inline-flex;
		align-items: center;
	}
</style>
