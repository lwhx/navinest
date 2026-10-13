<script lang="ts">
	import { resolve } from '$app/paths';
	import type { AdminFileRecord } from '$lib/server/services/admin-files';
	let {
		name,
		label,
		files,
		value = $bindable(''),
		onchange
	}: {
		name: string;
		label: string;
		files: AdminFileRecord[];
		value?: string;
		onchange?: () => void;
	} = $props();
	let expanded = $state(false),
		query = $state('');
	const matches = $derived(
		files.filter((file) =>
			`${file.objectKey} ${file.references.map((r) => r.title).join(' ')}`
				.toLowerCase()
				.includes(query.toLowerCase())
		)
	);
</script>

<fieldset class="media-picker">
	<legend>{label}</legend><input type="hidden" {name} {value} />
	{#if value}<img
			class="selected-image"
			src={resolve('/api/admin/files/[id]', { id: value })}
			alt={`当前${label}预览`}
		/>{:else}<p class="admin-form-hint">未选择图片</p>{/if}
	<div class="media-actions">
		<button
			type="button"
			class="admin-secondary-button"
			aria-expanded={expanded}
			onclick={() => (expanded = !expanded)}>{expanded ? '收起图片' : '选择图片'}</button
		>{#if value}<button
				type="button"
				class="admin-secondary-button"
				onclick={() => {
					value = '';
					onchange?.();
				}}>移除</button
			>{/if}
	</div>
	{#if expanded}<label
			><span>搜索{label}</span><input
				bind:value={query}
				placeholder="文件名或关联内容"
				oninput={(event) => event.stopPropagation()}
				onchange={(event) => event.stopPropagation()}
			/></label
		>
		<div class="media-grid">
			{#each matches as file (file.id)}<button
					type="button"
					aria-pressed={value === String(file.id)}
					onclick={() => {
						value = String(file.id);
						onchange?.();
						expanded = false;
					}}
					title={file.objectKey}
					><img
						loading="lazy"
						src={resolve('/api/admin/files/[id]', { id: String(file.id) })}
						alt=""
					/><span>{file.objectKey.split('/').at(-1)}</span></button
				>{:else}<p>没有匹配的图片。</p>{/each}
		</div>{/if}
</fieldset>

<style>
	.media-picker {
		border: 0;
		min-width: 0;
		padding: 0;
		margin: 0;
	}
	legend {
		font-weight: 600;
		margin-bottom: 8px;
	}
	.selected-image {
		width: 100px;
		height: 80px;
		object-fit: contain;
		border: 1px solid var(--admin-border);
		border-radius: 8px;
	}
	.media-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin: 8px 0;
	}
	.media-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
		gap: 8px;
		max-height: 280px;
		overflow: auto;
		margin-top: 8px;
	}
	.media-grid button {
		min-width: 0;
		padding: 8px;
		border: 1px solid var(--admin-border);
		border-radius: 8px;
		color: var(--admin-text);
		background: var(--admin-surface);
	}
	.media-grid button[aria-pressed='true'] {
		border-color: var(--admin-accent);
	}
	.media-grid img {
		width: 100%;
		height: 64px;
		object-fit: contain;
	}
	.media-grid span {
		display: block;
		overflow-wrap: anywhere;
		font-size: 12px;
	}
</style>
