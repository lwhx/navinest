<script lang="ts">
	import { enhance } from '$app/forms';
	import { beforeNavigate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onMount, tick } from 'svelte';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { announcementTarget } from '$lib/site-settings-preview';
	import { siteDisplayName, type SiteSettings } from '$lib/types/site';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
	type TextKey = {
		[K in keyof SiteSettings]: SiteSettings[K] extends string ? K : never;
	}[keyof SiteSettings];
	type FlagKey = Exclude<keyof SiteSettings, TextKey>;
	const labels: Record<keyof SiteSettings, string> = {
		siteName: '站点名称',
		siteTagline: '副标题',
		siteDescription: '站点描述',
		announcementEnabled: '公告开关',
		announcementMessage: '公告内容',
		announcementLink: '公告链接',
		announcementLinkLabel: '链接文字',
		submissionsOpen: '开放投稿',
		registrationOpen: '公开注册',
		sitemapEnabled: '站点地图',
		robotsExtra: '抓取附加规则'
	};
	function initialDraft(): SiteSettings {
		const values = form && 'values' in form ? (form.values as Record<string, unknown>) : null;
		const next = { ...data.settings };
		if (values)
			for (const name of Object.keys(next) as (keyof SiteSettings)[]) {
				if (typeof next[name] === 'boolean')
					(next as Record<string, unknown>)[name] = values[name] === 'on';
				else
					(next as Record<string, unknown>)[name] =
						typeof values[name] === 'string' ? values[name] : next[name];
			}
		return next;
	}
	let draft = $derived(initialDraft());
	let mounted = $state(false),
		busy = $state(false),
		notice = $state(''),
		showPreview = $state(false);
	onMount(() => {
		mounted = true;
	});
	const errors = $derived((form && 'errors' in form ? form.errors : {}) as Record<string, string>);
	const changed = $derived(
		(Object.keys(labels) as (keyof SiteSettings)[]).filter(
			(name) => draft[name] !== data.settings[name]
		)
	);
	const currentRevision = $derived(
		form && 'values' in form && typeof form.values?.revision === 'string'
			? form.values.revision
			: data.revision
	);
	const previewVisible = $derived(showPreview || Boolean(form && 'preview' in form));
	const target = $derived(announcementTarget(draft.announcementLink));
	const writable = $derived(data.source === 'database');
	function edit(event: Event) {
		const control = event.target;
		if (
			!(control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) ||
			!(control.name in labels)
		)
			return;
		draft = {
			...draft,
			[control.name]:
				control instanceof HTMLInputElement && control.type === 'checkbox'
					? control.checked
					: control.value
		};
	}
	beforeNavigate(({ cancel }) => {
		if (busy) cancel();
	});
	const submit: SubmitFunction = ({ cancel }) => {
		if (busy) {
			cancel();
			return;
		}
		busy = true;
		notice = '';
		return async ({ result, update }) => {
			busy = false;
			if (result.type === 'error') {
				notice = '保存结果待核对，填写内容已保留。请打开已保存设置确认后再操作。';
				return;
			}
			await update({ reset: false });
			if (result.type === 'failure') {
				await tick();
				document.querySelector<HTMLElement>('.site-settings-form [aria-invalid=true]')?.focus();
			}
		};
	};
</script>

{#snippet field(name: TextKey, label: string, max: number, multiline = false, hint = '')}
	<label class:admin-field-wide={multiline}
		><span>{label}</span>
		{#if multiline}<textarea
				{name}
				rows={name === 'robotsExtra' ? 4 : 3}
				maxlength={max}
				value={draft[name]}
				aria-invalid={Boolean(errors[name])}></textarea>
		{:else}<input
				{name}
				maxlength={max}
				required={name === 'siteName'}
				value={draft[name]}
				aria-invalid={Boolean(errors[name])}
			/>{/if}
		{#if hint}<small class="settings-hint">{hint}</small>{/if}
		{#if errors[name]}<small class="field-error">{errors[name]}</small>{/if}</label
	>
{/snippet}
{#snippet flag(name: FlagKey, title: string, hint: string)}
	<label class="settings-switch"
		><input type="checkbox" {name} checked={draft[name]} /><span
			><strong>{title}</strong><small>{hint}</small></span
		></label
	>
{/snippet}

<header class="admin-page-header">
	<div>
		<p class="eyebrow">SITE SETTINGS</p>
		<h1>站点设置</h1>
		<p class="admin-page-description">
			先核对展示与开放范围，保存后供新请求使用。当前已打开的页面需要刷新。
		</p>
	</div>
</header>
{#if data.readError}<p class="admin-notice" role="alert">
		{data.readError} <a href={resolve('/admin/settings')}>重新读取</a>
	</p>
{:else if !writable}<p class="admin-notice">当前为只读示例，不能保存设置。</p>{/if}
{#if writable}<section class="settings-overview" aria-label="已保存的站点状态">
		<div><span>已保存的站点名称</span><strong>{siteDisplayName(data.settings)}</strong></div>
		<div>
			<span>投稿 / 公开注册</span><strong
				>{data.settings.submissionsOpen ? '投稿开放' : '投稿关闭'} · {data.settings.registrationOpen
					? '注册开放'
					: '注册关闭'}</strong
			>
		</div>
		<div>
			<span>公告 / 站点地图</span><strong
				>{data.settings.announcementEnabled ? '公告开启' : '公告关闭'} · {data.settings
					.sitemapEnabled
					? '地图开启'
					: '地图关闭'}</strong
			>
		</div>
	</section>{/if}
{#if notice}<p class="admin-form-message" role="status">
		{notice} <a href={resolve('/admin/settings')} target="_blank" rel="noopener">打开已保存设置</a>
	</p>
{:else if form?.message}<p class="admin-form-message" role="status">
		{form.message}
		{#if form && 'success' in form && form.success === false}<a
				href={resolve('/admin/settings')}
				target="_blank"
				rel="noopener">核对最新设置</a
			>{/if}
	</p>
{:else if data.saved && changed.length === 0}<p class="admin-form-message" role="status">
		设置已保存。新请求将使用当前配置。
	</p>{/if}

{#if data.source !== 'unavailable' || (form && 'values' in form)}<form
		class="admin-form site-settings-form"
		method="POST"
		action="?/save"
		oninput={edit}
		use:enhance={submit}
	>
		<input type="hidden" name="revision" value={currentRevision} />
		<fieldset disabled={busy || !writable}>
			<section class="admin-editor" aria-labelledby="identity-title">
				<div class="admin-editor-header">
					<div>
						<h2 id="identity-title">站点标识</h2>
						<p class="settings-hint">
							用于浏览器标题、分享站点名称与页脚；不同内容页仍保留自己的标题和描述。
						</p>
					</div>
				</div>
				<div class="admin-form-grid">
					{@render field('siteName', '站点名称', 40)}{@render field(
						'siteTagline',
						'副标题',
						60
					)}{@render field('siteDescription', '站点描述', 200, true)}
				</div>
			</section>
			<section class="admin-editor" aria-labelledby="announcement-title">
				<div class="admin-editor-header"><h2 id="announcement-title">站点公告</h2></div>
				{@render flag(
					'announcementEnabled',
					'显示公告条',
					'公告出现在站点页面顶部，包含后台；访客可在自己的浏览器中关闭。更改公告正文后会重新展示。'
				)}
				<div class="admin-form-grid">
					{@render field('announcementMessage', '公告内容', 240, true)}{@render field(
						'announcementLink',
						'公告链接',
						300,
						false,
						'可留空。仅支持 / 开头的站内路径或公网 HTTP/HTTPS 地址。'
					)}{@render field('announcementLinkLabel', '链接文字', 40, false, '留空显示“查看详情”。')}
				</div>
			</section>
			<section class="admin-editor" aria-labelledby="access-title">
				<div class="admin-editor-header"><h2 id="access-title">投稿与注册</h2></div>
				<div class="settings-flags">
					{@render flag(
						'submissionsOpen',
						'开放用户投稿',
						'关闭后投稿页、网页智能填充和投稿接口停止接收新投稿；已有投稿仍可审核。'
					)}{@render flag(
						'registrationOpen',
						'开放公开注册',
						'开启后允许访客创建普通用户账号。关闭不影响已有账号登录。'
					)}
				</div>
			</section>
			<section class="admin-editor" aria-labelledby="seo-title">
				<div class="admin-editor-header"><h2 id="seo-title">搜索引擎收录</h2></div>
				{@render flag(
					'sitemapEnabled',
					'输出站点地图',
					'关闭后 /sitemap.xml 返回 404，robots.txt 不再输出 Sitemap 行。'
				)}
				<div class="admin-form-grid">
					{@render field(
						'robotsExtra',
						'robots.txt 附加规则',
						500,
						true,
						'追加在默认规则之后，供搜索引擎参考；抓取规则不能代替访问权限。'
					)}
				</div>
			</section>
			<div class="settings-actions">
				<div>
					<strong
						>{changed.length
							? '有 ' + changed.length + ' 项未保存'
							: '当前没有未保存的修改'}</strong
					>{#if changed.length}<small>{changed.map((name) => labels[name]).join('、')}</small>{/if}
				</div>
				<div class="settings-buttons">
					<button
						class="admin-secondary-button"
						type={mounted ? 'button' : 'submit'}
						formaction="?/preview"
						onclick={mounted
							? () => {
									showPreview = true;
								}
							: undefined}>预览展示</button
					><button class="admin-primary-button" type="submit"
						>{busy ? '保存中…' : '保存设置'}</button
					>
				</div>
			</div>
		</fieldset>
	</form>{/if}
{#if previewVisible}<section class="admin-panel settings-preview" aria-label="未保存的展示预览">
		<div class="admin-panel-heading">
			<h2>展示预览</h2>
			<span>仅用于核对，不会保存或请求公告链接</span>
		</div>
		<div class="settings-preview-identity">
			<small>站点标识</small><strong>{siteDisplayName(draft) || '尚未填写站点名称'}</strong>
			<p>{draft.siteDescription || '尚未填写站点描述'}</p>
		</div>
		<div class="settings-preview-banner">
			{#if draft.announcementEnabled}<strong>公告条</strong>
				<p>{draft.announcementMessage || '开启公告后需要填写内容。'}</p>
				{#if target === null}<p class="field-error">
						公告链接无效，请使用站内路径或公网 HTTP/HTTPS 地址。
					</p>{:else if target}<span>{draft.announcementLinkLabel || '查看详情'}</span><code
						>{target}</code
					>{/if}{:else}<p>公告条已关闭，正文和链接继续保留在草稿中。</p>{/if}
		</div>
	</section>{/if}

<style>
	.site-settings-form {
		display: grid;
		gap: 16px;
		padding: 0;
	}
	fieldset {
		min-width: 0;
		padding: 0;
		border: 0;
		display: grid;
		gap: 16px;
	}
	.site-settings-form .admin-editor {
		margin: 0;
	}
	.settings-overview {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 12px;
		margin-bottom: 20px;
	}
	.settings-overview > div {
		padding: 18px;
		border: 1px solid var(--admin-border);
		background: var(--admin-surface);
		border-radius: 14px;
		display: grid;
		gap: 8px;
		overflow-wrap: anywhere;
	}
	.settings-overview span,
	.settings-hint,
	.settings-switch small,
	.settings-actions small,
	.settings-preview small,
	.settings-preview .admin-panel-heading span {
		color: var(--admin-muted);
		font-size: 13px;
		line-height: 1.65;
	}
	.settings-overview strong {
		font-size: 16px;
	}
	.settings-hint {
		margin: 4px 0;
	}
	.settings-switch {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		min-height: 44px;
		margin: 12px 16px 20px;
		cursor: pointer;
	}
	.settings-switch input {
		width: 20px;
		height: 20px;
		flex: 0 0 20px;
		margin: 3px 0;
	}
	.settings-switch span {
		display: grid;
		gap: 5px;
	}
	.settings-switch strong {
		font-size: 14px;
	}
	.settings-flags {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 24px;
		padding: 0 16px;
	}
	.settings-flags .settings-switch {
		margin-left: 0;
		margin-right: 0;
	}
	.settings-actions {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 20px;
		padding: 18px;
		border: 1px solid var(--admin-border);
		border-radius: 14px;
		background: var(--admin-surface);
	}
	.settings-actions > div:first-child {
		min-width: 0;
		display: grid;
		gap: 6px;
		font-size: 14px;
		overflow-wrap: anywhere;
	}
	.settings-buttons {
		display: flex;
		gap: 10px;
		flex-shrink: 0;
	}
	.settings-preview {
		margin-top: 20px;
		overflow-wrap: anywhere;
	}
	.settings-preview-identity,
	.settings-preview-banner {
		padding: 18px;
		border: 1px solid var(--admin-border);
		border-radius: 12px;
		margin-top: 16px;
	}
	.settings-preview-identity strong {
		display: block;
		margin-top: 6px;
		font-size: 20px;
	}
	.settings-preview p {
		font-size: 14px;
		line-height: 1.7;
		white-space: pre-wrap;
	}
	.settings-preview code {
		display: block;
		font-size: 13px;
		margin-top: 8px;
		overflow-wrap: anywhere;
		white-space: pre-wrap;
	}
	@media (max-width: 700px) {
		.settings-overview,
		.settings-flags {
			grid-template-columns: 1fr;
		}
		.settings-actions {
			flex-direction: column;
			align-items: stretch;
		}
		.settings-buttons {
			display: grid;
			grid-template-columns: 1fr 1fr;
		}
	}
</style>
