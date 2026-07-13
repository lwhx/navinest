<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
	function sizeLabel(size: number | null) {
		if (size === null) return '未知';
		if (size < 1024) return `${size} B`;
		if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KiB`;
		return `${(size / 1024 / 1024).toFixed(1)} MiB`;
	}
</script>

<header class="admin-page-header">
	<div>
		<p class="eyebrow">Storage</p>
		<h1>文件管理</h1>
		<p class="admin-page-description">管理私有R2图片、内容引用和安全删除。</p>
	</div>
	<span class="admin-count-badge">{data.files.length} 个文件</span>
</header>
{#if data.source === 'fallback'}<p class="admin-notice">
		本地环境没有 D1，文件管理保持只读。
	</p>{:else if !data.storageAvailable}<p class="admin-notice">
		R2 FILES binding 不可用，暂时不能上传或删除。
	</p>{/if}
{#if form?.message}<p class="admin-form-message" role="alert">{form.message}</p>{/if}
{#if data.source === 'database' && data.storageAvailable}
	<section class="admin-editor" aria-labelledby="upload-title">
		<div class="admin-editor-header">
			<div>
				<h2 id="upload-title">上传图片</h2>
				<p>文件保持私有，仅通过受控端点读取。</p>
			</div>
		</div>
		<form class="admin-form" method="POST" action="?/upload" enctype="multipart/form-data">
			<div class="admin-form-grid">
				<label class="admin-field-wide"
					><span>图片文件</span><input
						name="file"
						type="file"
						accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml"
						required
					/><small>支持 JPEG、PNG、WebP、GIF、SVG，最大 5 MiB。</small></label
				>
			</div>
			<div class="admin-form-actions">
				<button class="admin-primary-button" type="submit">上传文件</button>
			</div>
		</form>
	</section>
{/if}
{#if data.files.length}
	<section class="admin-file-grid" aria-label="文件列表">
		{#each data.files as file (file.id)}<article class="admin-file-card">
				<div class="admin-file-preview">
					<img
						src={resolve('/api/admin/files/[id]', { id: String(file.id) })}
						alt={`文件 #${file.id} 预览`}
						loading="lazy"
					/>
				</div>
				<div class="admin-file-body">
					<div class="admin-file-heading">
						<div>
							<strong>文件 #{file.id}</strong><small
								>{file.mimeType ?? '未知类型'} · {sizeLabel(file.size)}</small
							>
						</div>
						<span class:used={file.references.length > 0} class="admin-reference-badge"
							>{file.references.length > 0 ? `${file.references.length} 个引用` : '未引用'}</span
						>
					</div>
					<code>{file.objectKey}</code><time datetime={file.createdAt}>{file.createdAt}</time
					>{#if file.references.length}<div class="admin-reference-list">
							<strong>内容引用</strong
							>{#each file.references as reference (`${reference.itemId}-${reference.usage}`)}<a
									href={resolve(`/admin/items?edit=${reference.itemId}` as '/')}
									><span>{reference.title}</span><small
										>{reference.usage === 'icon' ? '图标' : '封面'}</small
									></a
								>{/each}
						</div>
						<p class="admin-protection-note">
							被内容引用的文件受到保护，解除关联后才可删除。
						</p>{:else if file.references.length === 0 && data.source === 'database' && data.storageAvailable}<form
							method="POST"
							action="?/delete"
							onsubmit={(event) => {
								if (!confirm(`确定删除文件“${file.objectKey}”吗？`)) event.preventDefault();
							}}
						>
							<input type="hidden" name="id" value={file.id} /><button
								class="admin-danger-button"
								type="submit">删除未引用文件</button
							>
						</form>{/if}
				</div>
			</article>{/each}
	</section>
{:else}<div class="admin-empty-state">
		<strong>暂无文件</strong>
		<p>上传第一张图片后，可在内容编辑器中关联为图标或封面。</p>
	</div>{/if}
