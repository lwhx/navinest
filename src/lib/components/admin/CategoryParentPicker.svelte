<script lang="ts">
	import { onMount } from 'svelte';
	import type { ContentType } from '$lib/types/content';
	import {
		categoryParentCandidates,
		categoryParentPath,
		type ParentCategory
	} from '$lib/category-parent-selection';
	let {
		categories,
		type,
		editingId,
		purpose = 'parent',
		value = $bindable(''),
		error
	}: {
		categories: ParentCategory[];
		type: ContentType;
		editingId?: number;
		purpose?: 'parent' | 'content';
		value?: string;
		error?: string;
	} = $props();
	const id = $props.id();
	let mounted = $state(false);
	onMount(() => {
		mounted = true;
	});
	const candidates = $derived(categoryParentCandidates(categories, type, editingId));
	const path = $derived(categoryParentPath(candidates, value));
	const invalidParent = $derived(path === null);
	const levels = $derived.by(() => {
		const result = [candidates.filter((category) => category.parentId === null)];
		for (const parent of path ?? []) {
			const children = candidates.filter((category) => category.parentId === parent.id);
			if (!children.length) break;
			result.push(children);
		}
		return result;
	});
	const fallbackOptions = $derived(
		candidates.flatMap((category) => {
			const branch = categoryParentPath(candidates, String(category.id));
			return branch
				? [{ id: category.id, label: branch.map((parent) => parent.name).join(' / ') }]
				: [];
		})
	);
	function levelLabel(index: number) {
		return index < 3 ? ['一级分类', '二级分类', '三级分类'][index] : `第 ${index + 1} 级分类`;
	}
	function choose(index: number, selected: string) {
		value = selected || (index === 0 ? '' : String(path?.[index - 1]?.id ?? ''));
	}
</script>

<fieldset class="category-parent-picker">
	<legend class="sr-only">{purpose === 'parent' ? '父级分类' : '内容分类'}</legend>
	<input
		type="hidden"
		name={purpose === 'parent' ? 'parentId' : 'categoryId'}
		{value}
		disabled={!mounted}
	/>
	<div class="parent-selection-levels" hidden={!mounted}>
		{#each levels as options, index (index)}
			<label for={`${id}-level-${index}`}>
				<span id={`${id}-label-${index}`}>{levelLabel(index)}</span>
				<select
					id={`${id}-level-${index}`}
					aria-labelledby={`${id}-label-${index}`}
					aria-describedby={`${id}-hint`}
					disabled={!mounted}
					value={index === 0 && invalidParent ? value : String(path?.[index]?.id ?? '')}
					onchange={(event) => choose(index, event.currentTarget.value)}
				>
					{#if index === 0 && invalidParent}<option {value}>原父级不可用，请重新选择</option>{/if}
					<option value=""
						>{index === 0
							? purpose === 'parent'
								? '无父级（设为一级分类）'
								: '未分类'
							: `使用“${path?.[index - 1]?.name}”${purpose === 'parent' ? '为父级' : '分类'}`}</option
					>
					{#each options as category (category.id)}<option value={String(category.id)}
							>{category.name}</option
						>{/each}
				</select>
			</label>
		{/each}
	</div>
	<noscript>
		<label
			><span id={`${id}-fallback-label`}
				>{purpose === 'parent' ? '父级分类' : '内容分类'}（完整路径）</span
			><select
				name={purpose === 'parent' ? 'parentId' : 'categoryId'}
				aria-labelledby={`${id}-fallback-label`}
			>
				{#if invalidParent}<option {value} selected>原父级不可用，请重新选择</option>{/if}
				<option value="" selected={value === ''}
					>{purpose === 'parent' ? '无父级（设为一级分类）' : '未分类'}</option
				>
				{#each fallbackOptions as category (category.id)}<option
						value={String(category.id)}
						selected={value === String(category.id)}>{category.label}</option
					>{/each}
			</select></label
		>
	</noscript>
	{#if mounted}<p
			id={`${id}-hint`}
			class="parent-selection-path"
			role={invalidParent ? 'alert' : undefined}
		>
			{#if invalidParent}原父级已不可用，请重新选择后保存。
			{:else if path?.length}{purpose === 'parent' ? '当前父级' : '当前分类'}：{path
					.map((category) => category.name)
					.join(' / ')}{#if purpose === 'parent'}。保存后为第 {path.length + 1} 级分类。{/if}
			{:else}{purpose === 'parent' ? '无父级，保存后为一级分类。' : '尚未选择分类。'}{/if}
		</p>{/if}
	{#if error}<small class="field-error" role="alert">{error}</small>{/if}
</fieldset>

<style>
	.category-parent-picker {
		min-width: 0;
		margin: 0;
		padding: 0;
		border: 0;
	}
	.parent-selection-levels {
		display: flex;
		flex-wrap: wrap;
		gap: 12px;
	}
	.parent-selection-levels[hidden] {
		display: none;
	}
	.parent-selection-levels label {
		flex: 1 1 180px;
		min-width: 0;
	}
	.parent-selection-path {
		margin: 8px 0 0;
		color: var(--admin-muted);
		font-size: 13px;
		line-height: 1.6;
		overflow-wrap: anywhere;
	}
</style>
