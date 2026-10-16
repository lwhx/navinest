<script lang="ts">
	import MediaImage from './MediaImage.svelte';
	import MediaPreview from './MediaPreview.svelte';
	import MediaBrowser from './MediaBrowser.svelte';
	import MediaUpload from './MediaUpload.svelte';
	let {
		name,
		label,
		value = $bindable(''),
		onchange,
		onbusy,
		disabled = false
	}: {
		name: string;
		label: string;
		value?: string;
		onchange?: () => void;
		onbusy?: (busy: boolean) => void;
		disabled?: boolean;
	} = $props();
	let expanded = $state(false),
		preview = $state(false),
		uploading = $state(false);
</script>

<fieldset class="media-picker">
	<legend>{label}</legend><input type="hidden" {name} {value} />
	{#if value}<button
			type="button"
			class="selected-image"
			aria-label={`预览当前${label}`}
			{disabled}
			onclick={() => (preview = true)}><MediaImage id={value} alt={`当前${label}预览`} /></button
		>
		<p class="admin-form-hint">已选图片 #{value}</p>{:else}<p class="admin-form-hint">
			未选择图片
		</p>{/if}
	<div class="media-actions">
		<button
			type="button"
			class="admin-secondary-button"
			{disabled}
			aria-expanded={expanded}
			onclick={() => (expanded = !expanded)}
			>{expanded ? '收起图片' : value ? '替换图片' : '选择图片'}</button
		>{#if value}<button
				type="button"
				class="admin-secondary-button"
				{disabled}
				onclick={() => {
					value = '';
					onchange?.();
				}}>移除</button
			>{/if}
	</div>
	{#if expanded}<MediaBrowser
			selected={value}
			{disabled}
			onselect={(file) => {
				value = String(file.id);
				onchange?.();
				expanded = false;
			}}
		/>
		<div class="picker-upload">
			<MediaUpload
				label={`上传新的${label}`}
				{disabled}
				onbusy={(active) => {
					uploading = active;
					onbusy?.(active);
				}}
				onuploaded={(file) => {
					value = String(file.id);
					onchange?.();
				}}
			/>
		</div>{/if}
	{#if uploading}<p role="status" class="admin-form-hint">图片保存中，请完成后再保存内容。</p>{/if}
</fieldset>
{#if preview && value}<MediaPreview id={value} onclose={() => (preview = false)} />{/if}

<style>
	.media-picker {
		min-width: 0;
		border: 0;
		margin: 0;
		padding: 0;
	}
	legend {
		font-weight: 600;
		margin-bottom: 8px;
	}
	.selected-image {
		width: 120px;
		min-height: 90px;
		padding: 0;
		background: var(--admin-soft);
		border: 1px solid var(--admin-border);
		border-radius: 10px;
		overflow: hidden;
		cursor: pointer;
	}
	.selected-image :global(.media-image) {
		height: 90px;
	}
	.media-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin: 10px 0;
	}
	.picker-upload {
		border-top: 1px solid var(--admin-border);
		padding-top: 16px;
		margin-top: 16px;
	}
</style>
