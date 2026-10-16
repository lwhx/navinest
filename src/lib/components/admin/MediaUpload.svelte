<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import type { AdminFileRecord } from '$lib/server/services/admin-files';
	let {
		onuploaded,
		onbusy,
		disabled = false,
		label = '上传图片'
	}: {
		onuploaded: (file: AdminFileRecord) => void | Promise<void>;
		onbusy?: (busy: boolean) => void;
		disabled?: boolean;
		label?: string;
	} = $props();
	let mounted = $state(false),
		file = $state<File | null>(null),
		busy = $state(false),
		progress = $state<number | null>(null),
		message = $state(''),
		failed = $state(false);
	let input = $state<HTMLInputElement>();
	const uid = $props.id();
	onMount(() => {
		mounted = true;
	});
	async function upload() {
		if (!file || busy || disabled) return;
		if (
			![
				'image/jpeg',
				'image/png',
				'image/webp',
				'image/gif',
				'image/svg+xml',
				'image/x-icon',
				'image/vnd.microsoft.icon'
			].includes(file.type) ||
			!file.size ||
			file.size > 5 * 1024 * 1024
		) {
			message = '请选择 JPEG、PNG、WebP、GIF、SVG 或 ICO 图片，大小不超过 5 MiB。';
			failed = true;
			return;
		}
		busy = true;
		onbusy?.(true);
		failed = false;
		message = '正在上传…';
		progress = null;
		try {
			const uploaded = await new Promise<AdminFileRecord>((resolveUpload, reject) => {
				const request = new XMLHttpRequest();
				request.open('POST', resolve('/api/admin/files'));
				request.timeout = 120_000;
				request.ontimeout = () => reject(new Error('上传超时，结果未确认，请先刷新资源库核对。'));
				request.upload.onprogress = (event) => {
					progress = event.lengthComputable ? Math.round((event.loaded / event.total) * 100) : null;
				};
				request.onerror = () =>
					reject(new Error('上传结果未确认，请先刷新资源库核对，再决定是否重试。'));
				request.onabort = () => reject(new Error('上传已中断，请先核对资源库。'));
				request.onload = () => {
					try {
						const body = JSON.parse(request.responseText);
						if (request.status < 200 || request.status >= 300)
							throw new Error(body.error ?? '上传失败，请重试。');
						if (!body.data?.id) throw new Error('上传结果未确认，请刷新资源库核对。');
						resolveUpload(body.data);
					} catch (error) {
						reject(
							error instanceof Error && !(error instanceof SyntaxError)
								? error
								: new Error('上传结果未确认，请刷新资源库核对。')
						);
					}
				};
				const body = new FormData();
				body.set('file', file!);
				request.send(body);
			});
			file = null;
			if (input) input.value = '';
			message = `上传成功，图片 #${uploaded.id}。`;
			try {
				await onuploaded(uploaded);
			} catch {
				message = '上传成功，但列表刷新失败，请刷新页面核对。';
				failed = true;
			}
		} catch (error) {
			failed = true;
			message = error instanceof Error ? error.message : '上传失败，请重试。';
		} finally {
			busy = false;
			onbusy?.(false);
		}
	}
</script>

{#if mounted}<div class="media-upload">
		<label for={uid}>{label}</label><input
			bind:this={input}
			id={uid}
			type="file"
			accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml,image/x-icon,image/vnd.microsoft.icon"
			disabled={disabled || busy}
			onchange={(event) => {
				file = event.currentTarget.files?.[0] ?? null;
				message = '';
				failed = false;
			}}
			oninput={(event) => event.stopPropagation()}
		/>
		<p>JPEG、PNG、WebP、GIF、SVG、ICO，最大 5 MiB。</p>
		<div class="upload-actions">
			<button
				class="admin-primary-button"
				type="button"
				disabled={disabled || busy || !file}
				onclick={upload}>{busy ? '正在上传…' : failed && file ? '重新上传' : '上传所选图片'}</button
			>{#if busy}<span role="status"
					>{progress === null
						? '正在传输…'
						: progress === 100
							? '正在保存…'
							: `已传输 ${progress}%`}</span
				>{/if}
		</div>
		{#if busy}<progress max="100" value={progress ?? undefined} aria-label="图片上传进度"
			></progress>{/if}
		{#if message}<p class:error={failed} role={failed ? 'alert' : 'status'}>{message}</p>{/if}
	</div>{/if}

<style>
	.media-upload {
		display: grid;
		gap: 10px;
		min-width: 0;
	}
	label {
		color: var(--admin-text);
		font-weight: 600;
		font-size: 15px;
	}
	input {
		max-width: 100%;
		min-width: 0;
		min-height: 44px;
	}
	p {
		margin: 0;
		color: var(--admin-muted);
		font-size: 13px;
		line-height: 1.7;
		overflow-wrap: anywhere;
	}
	.error {
		color: var(--admin-danger);
	}
	.upload-actions {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 12px;
	}
	.upload-actions span {
		color: var(--admin-muted);
		font-size: 13px;
	}
	progress {
		width: 100%;
		height: 8px;
		accent-color: var(--admin-accent);
	}
</style>
