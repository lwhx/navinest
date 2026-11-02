<script lang="ts">
	import type { NavigationCategory, NavigationEditor } from '$lib/custom-navigation-workspace';

	let {
		editor,
		locked,
		busy,
		dirty,
		stale,
		hasReview,
		categories,
		editorElement = $bindable<HTMLElement>(),
		onsave,
		onclose,
		onreload
	}: {
		editor: NavigationEditor;
		locked: boolean;
		busy: boolean;
		dirty: boolean;
		stale: boolean;
		hasReview: boolean;
		categories: NavigationCategory[];
		editorElement?: HTMLElement;
		onsave: () => void;
		onclose: () => void;
		onreload: () => void;
	} = $props();
</script>

<section class="panel editor" aria-labelledby="navigation-editor-title" bind:this={editorElement}>
	<div class="workspace-header">
		<div>
			<h3 id="navigation-editor-title">
				{editor.id ? '编辑' : '新增'}{editor.resource === 'link' ? '链接' : '分类'}
			</h3>
			<p class="muted">
				{dirty ? '有未保存的修改' : '填写后点击保存'}{editor.id ? ` · 编号 #${editor.id}` : ''}
			</p>
		</div>
		<button disabled={locked} onclick={onclose}>关闭编辑</button>
	</div>
	{#if stale}<div class="notice">
			<p>列表已变化，草稿仍保留。保存前请载入最新记录重新核对；此操作会放弃当前草稿。</p>
			<button disabled={locked} onclick={onreload}>载入最新记录</button>
		</div>{/if}
	<form
		onsubmit={(event) => {
			event.preventDefault();
			onsave();
		}}
	>
		<fieldset disabled={locked || hasReview} class="editor-grid">
			{#if editor.resource === 'link'}
				<label
					><span>链接标题</span><input
						bind:value={editor.data.title}
						required
						maxlength="120"
					/></label
				><label
					><span>网址</span><input
						bind:value={editor.data.url}
						required
						type="url"
						maxlength="2048"
					/></label
				>
				<label
					><span>链接分类</span><select bind:value={editor.data.categoryId}
						><option value={null}>未分类</option>{#each categories as category (category.id)}<option
								value={category.id}>{category.name} #{category.id}</option
							>{/each}</select
					></label
				>
				<label
					><span>链接状态</span><select bind:value={editor.data.status}
						><option value="active">启用</option><option value="inactive">停用</option></select
					></label
				>
				<label class="wide"
					><span>链接摘要</span><textarea bind:value={editor.data.summary} maxlength="300" rows="3"
					></textarea></label
				>
			{:else}<label class="wide"
					><span>分类名称</span><input
						bind:value={editor.data.name}
						required
						maxlength="80"
					/></label
				>{/if}
			<label
				><span>排序值</span><input
					type="number"
					bind:value={editor.data.sortOrder}
					required
					step="1"
					min="-1000000000000"
					max="1000000000000"
				/></label
			>
			<div class="actions wide">
				<button class="primary" type="submit"
					>{busy ? '保存中…' : '保存' + (editor.resource === 'link' ? '链接' : '分类')}</button
				><button type="button" onclick={onclose}>取消编辑</button>
			</div>
		</fieldset>
	</form>
</section>

<style>
	.panel,
	.notice {
		padding: 18px;
		background: var(--nw-soft);
		border: 1px solid var(--nw-border);
		border-radius: 12px;
		margin: 14px 0;
		overflow-wrap: anywhere;
	}
	.notice {
		border-left: 3px solid #c42b3b;
	}
	h3 {
		color: var(--nw-text);
		margin: 0 0 6px;
	}
	p {
		margin: 0 0 10px;
		line-height: 1.6;
	}
	.muted {
		color: var(--nw-muted);
		font-size: 13px;
	}
	.workspace-header {
		display: flex;
		justify-content: space-between;
		gap: 16px;
		align-items: flex-start;
		margin-bottom: 18px;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		align-items: center;
	}
	button {
		min-height: 44px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		border: 1px solid var(--nw-border);
		border-radius: 9px;
		background: var(--nw-bg);
		color: var(--nw-text);
		padding: 10px 13px;
		font: inherit;
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
		text-align: center;
		line-height: 1.4;
	}
	button:hover:not(:disabled) {
		border-color: #c22c3c;
		background: var(--nw-soft);
	}
	button.primary {
		background: #c42b3b;
		border-color: #c42b3b;
		color: white;
	}
	button:disabled {
		opacity: 0.48;
		cursor: not-allowed;
	}
	fieldset {
		border: 0;
		padding: 0;
		margin: 0;
		min-width: 0;
	}
	.editor-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 14px;
	}
	.wide {
		grid-column: 1/-1;
	}
	label {
		display: grid;
		gap: 7px;
		font-size: 13px;
		min-width: 0;
	}
	input:not([type='checkbox']),
	select,
	textarea {
		box-sizing: border-box;
		min-width: 0;
		width: 100%;
		min-height: 44px;
		border: 1px solid var(--nw-border);
		background: var(--nw-bg);
		border-radius: 8px;
		color: var(--nw-text);
		padding: 10px;
		font: inherit;
	}
	textarea {
		resize: vertical;
	}
	@media (max-width: 600px) {
		.editor-grid {
			grid-template-columns: minmax(0, 1fr);
		}
		.panel,
		.notice {
			padding: 12px;
		}
		.workspace-header {
			flex-wrap: wrap;
		}
	}
</style>
