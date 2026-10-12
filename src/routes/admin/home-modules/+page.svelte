<script lang="ts">
	import { resolve } from '$app/paths';
	import { homeModuleLabels } from '$lib/admin-home-modules';
	import type { PageProps } from './$types';
	import {
		searchRecommendations,
		SEARCH_RECOMMENDATION_LIMIT,
		SEARCH_RECOMMENDATION_LENGTH
	} from '$lib/search';
	let { data, form }: PageProps = $props();
	const errors = $derived((form?.errors ?? {}) as Record<string, string>);
	let moduleType = $derived(value('type', data.editing?.type ?? 'content'));
	function configJson() {
		const config = { ...(data.editing?.config ?? {}) };
		return JSON.stringify(config, null, 2);
	}
	function value(name: string, fallback = '') {
		const submitted = form?.values?.[name];
		return typeof submitted === 'string' ? submitted : fallback;
	}
	function enabled() {
		return form?.values ? value('isEnabled') === 'on' : data.editing?.isEnabled !== false;
	}
</script>

<header class="admin-page-header">
	<div>
		<p class="eyebrow">站点呈现</p>
		<h1>首页模块</h1>
		<p class="admin-page-description">按使用顺序组织首页，选择分类和展示内容。</p>
	</div>
	{#if data.source === 'database'}<a
			class="admin-primary-button"
			href={resolve('/admin/home-modules?create=1')}>新增模块</a
		>{/if}
</header>
{#if data.source === 'fallback'}<p class="admin-notice">本地示例为只读数据。</p>{/if}
{#if data.source === 'database' && data.mode}<section class="admin-editor">
		<div class="admin-editor-header">
			<h2>{data.mode === 'create' ? '新增模块' : '编辑模块'}</h2>
			<a href={resolve('/admin/home-modules')} title="关闭">×</a>
		</div>
		{#if data.mode === 'create' || data.editing}<form
				class="admin-form"
				method="POST"
				action={data.mode === 'create' ? '?create=1&/create' : `?edit=${data.editing?.id}&/update`}
			>
				{#if data.editing}<input
						type="hidden"
						name="id"
						value={data.editing.id}
					/>{/if}{#if form?.message}<p class="admin-form-message">{form.message}</p>{/if}
				<div class="admin-form-grid">
					<label
						><span>类型</span><select
							name="type"
							value={moduleType}
							onchange={(event) => (moduleType = event.currentTarget.value)}
							><option value="search">搜索</option><option value="content">分类资源</option><option
								value="hot">热榜</option
							><option value="ranking">排行榜</option><option value="links">快捷链接</option><option
								value="custom_html">自定义 HTML</option
							></select
						>{#if errors.type}<small class="field-error">{errors.type}</small>{/if}</label
					><label
						><span>标题</span><input
							name="title"
							required
							maxlength="100"
							value={value('title', data.editing?.title)}
						/>{#if errors.title}<small class="field-error">{errors.title}</small>{/if}</label
					><label
						><span>展示顺序</span><input
							name="sortOrder"
							type="number"
							value={value('sortOrder', String(data.editing?.sortOrder ?? 0))}
						/></label
					>
					{#if moduleType === 'content'}<label class="admin-field-wide"
							><span id="module-category-label">资源分类</span><select
								name="categorySlug"
								aria-labelledby="module-category-label"
								aria-describedby="module-category-hint"
								required
								value={value(
									'categorySlug',
									typeof data.editing?.config.categorySlug === 'string'
										? data.editing.config.categorySlug
										: ''
								)}
								><option value="">请选择分类</option
								>{#if typeof data.editing?.config.categorySlug === 'string' && !data.categories.some((category) => category.slug === data.editing?.config.categorySlug)}<option
										value={data.editing.config.categorySlug}
										>{data.editing.config.categorySlug}（原分类未找到）</option
									>{/if}{#each data.categories as category (category.id)}<option
										value={category.slug}
										>{category.name}{category.isVisible ? '' : '（已隐藏）'}</option
									>{/each}</select
							><small id="module-category-hint"
								>首页只展示启用分类中的公开内容。隐藏或没有公开内容的分类不会显示。</small
							>{#if errors.categorySlug}<small class="field-error">{errors.categorySlug}</small
								>{/if}</label
						>{/if}
					<p class="admin-field-wide admin-form-hint">
						{homeModuleLabels[moduleType]?.description}
					</p>

					{#if moduleType === 'search'}<label class="admin-field-wide">
							<span>推荐搜索词</span>
							<textarea
								name="recommendedSearchesText"
								rows="4"
								aria-describedby="recommended-searches-hint"
								>{value(
									'recommendedSearchesText',
									searchRecommendations(data.editing?.config.recommendedSearches).join('\n')
								)}</textarea
							>
							<small id="recommended-searches-hint"
								>每行一个，最多 {SEARCH_RECOMMENDATION_LIMIT} 个，每个不超过 {SEARCH_RECOMMENDATION_LENGTH}
								个字符；留空隐藏推荐搜索。</small
							>
							{#if errors.recommendedSearchesText}<small class="field-error"
									>{errors.recommendedSearchesText}</small
								>{/if}
						</label>{/if}
					<details class="admin-advanced-config admin-field-wide" open={Boolean(errors.configJson)}>
						<summary>高级配置</summary>
						<p class="admin-form-hint">保留原有扩展配置。仅在需要调整快捷链接等高级内容时编辑。</p>
						<label
							><span>{moduleType === 'search' ? '其他 JSON 配置' : 'JSON 配置'}</span><textarea
								name="configJson"
								rows="6">{value('configJson', configJson())}</textarea
							>{#if errors.configJson}<small class="field-error">{errors.configJson}</small
								>{/if}</label
						>
					</details>
				</div>
				<label class="admin-checkbox"
					><input type="checkbox" name="isEnabled" checked={enabled()} /><span>启用</span></label
				>
				<div class="admin-form-actions">
					<button class="admin-primary-button" type="submit">保存模块</button><a
						class="admin-secondary-button"
						href={resolve('/admin/home-modules')}>取消</a
					>
				</div>
			</form>{:else}<p class="admin-notice">没有找到要编辑的模块。</p>{/if}
	</section>{/if}

<section class="admin-panel admin-home-plan" aria-labelledby="home-plan-title">
	<div class="admin-panel-heading">
		<h2 id="home-plan-title">已配置顺序</h2>
		<a href={resolve('/')} target="_blank" rel="noopener noreferrer">查看首页</a>
	</div>
	<p class="admin-plan-hint">
		排序数值越小越靠前，停用模块不展示。首页会在这些模块之外补齐未单独配置的启用分类。
	</p>
	<ol class="admin-module-list">
		{#each data.modules as module, index (module.id)}<li class:disabled={!module.isEnabled}>
				<span class="admin-module-position" aria-label={`第 ${index + 1} 个模块`}
					>{String(index + 1).padStart(2, '0')}</span
				>
				<div class="admin-module-copy">
					<div>
						<strong>{module.title}</strong><span
							class="admin-status"
							class:disabled={!module.isEnabled}>{module.isEnabled ? '启用' : '停用'}</span
						>
					</div>
					<p>
						{homeModuleLabels[module.type]?.label ?? module.type}{module.type === 'content'
							? ` · ${data.categories.find((category) => category.slug === module.config.categorySlug)?.name ?? '分类待配置'}`
							: ''} · 排序 {module.sortOrder}
					</p>
					<small>{homeModuleLabels[module.type]?.description}</small>
				</div>
				{#if data.source === 'database'}<div class="admin-row-actions">
						<a
							class="admin-secondary-button"
							href={resolve(`/admin/home-modules?edit=${module.id}`)}
							aria-label={`编辑模块 ${module.title}`}>编辑</a
						>
						<form
							method="POST"
							action="?/delete"
							onsubmit={(event) => {
								if (!confirm(`确定删除模块“${module.title}”吗？`)) event.preventDefault();
							}}
						>
							<input type="hidden" name="id" value={module.id} /><button
								type="submit"
								aria-label={`删除模块 ${module.title}`}>删除</button
							>
						</form>
					</div>{/if}
			</li>{:else}<li class="admin-panel-empty">
				还没有配置模块。新增搜索或分类资源模块，开始整理首页。
			</li>{/each}
	</ol>
</section>
