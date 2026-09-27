<script lang="ts">
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const errors = $derived((form?.errors ?? {}) as Record<string, string>);

	function value(name: string, fallback: string): string {
		const submitted = form?.values?.[name];
		return typeof submitted === 'string' ? submitted : fallback;
	}

	function checked(name: string, fallback: boolean): boolean {
		const submitted = form?.values?.[name];
		if (submitted === undefined) return fallback;
		const raw = Array.isArray(submitted) ? submitted[0] : submitted;
		return raw === 'on' || raw === 'true' || raw === '1';
	}
</script>

<header class="admin-page-header">
	<div>
		<p class="eyebrow">Settings</p>
		<h1>站点设置</h1>
		<p class="admin-page-note">
			这里保存的设置会立即生效：站点标识驱动浏览器标题、分享卡片与页脚；公告条显示在所有公开页面顶部；投稿开关同时控制投稿页、网页智能填充和投稿接口。
		</p>
	</div>
</header>
{#if data.source === 'fallback'}<p class="admin-notice">本地示例为只读数据。</p>{/if}
{#if form?.message}<p class="admin-form-message" role="alert">{form.message}</p>{/if}

<form class="admin-form site-settings-form" method="POST" action="?/save">
	<section class="admin-editor" aria-labelledby="identity-title">
		<div class="admin-editor-header"><h2 id="identity-title">站点标识</h2></div>
		<div class="admin-form-grid">
			<label
				><span>站点名称</span><input
					name="siteName"
					maxlength="40"
					required
					value={value('siteName', data.settings.siteName)}
				/>{#if errors.siteName}<small class="field-error">{errors.siteName}</small>{/if}</label
			>
			<label
				><span>副标题</span><input
					name="siteTagline"
					maxlength="60"
					value={value('siteTagline', data.settings.siteTagline)}
				/>{#if errors.siteTagline}<small class="field-error">{errors.siteTagline}</small
					>{/if}</label
			>
			<label class="admin-field-wide"
				><span>站点描述</span><textarea name="siteDescription" rows="2" maxlength="200"
					>{value('siteDescription', data.settings.siteDescription)}</textarea
				>{#if errors.siteDescription}<small class="field-error">{errors.siteDescription}</small
					>{/if}</label
			>
		</div>
	</section>

	<section class="admin-editor" aria-labelledby="announcement-title">
		<div class="admin-editor-header"><h2 id="announcement-title">公告条</h2></div>
		<div class="admin-form-grid">
			<label class="checkbox-field"
				><input
					type="checkbox"
					name="announcementEnabled"
					checked={checked('announcementEnabled', data.settings.announcementEnabled)}
				/><span>在公开页面顶部显示公告</span></label
			>
			<label class="admin-field-wide"
				><span>公告内容</span><textarea name="announcementMessage" rows="2" maxlength="240"
					>{value('announcementMessage', data.settings.announcementMessage)}</textarea
				>{#if errors.announcementMessage}<small class="field-error"
						>{errors.announcementMessage}</small
					>{/if}</label
			>
			<label
				><span>公告链接</span><input
					name="announcementLink"
					maxlength="300"
					placeholder="/bulletins/example 或 https://…"
					value={value('announcementLink', data.settings.announcementLink)}
				/>{#if errors.announcementLink}<small class="field-error">{errors.announcementLink}</small
					>{/if}</label
			>
			<label
				><span>链接文字</span><input
					name="announcementLinkLabel"
					maxlength="40"
					value={value('announcementLinkLabel', data.settings.announcementLinkLabel)}
				/>{#if errors.announcementLinkLabel}<small class="field-error"
						>{errors.announcementLinkLabel}</small
					>{/if}</label
			>
		</div>
	</section>

	<section class="admin-editor" aria-labelledby="content-title">
		<div class="admin-editor-header"><h2 id="content-title">投稿与收录</h2></div>
		<div class="admin-form-grid">
			<label class="checkbox-field"
				><input
					type="checkbox"
					name="submissionsOpen"
					checked={checked('submissionsOpen', data.settings.submissionsOpen)}
				/><span>开放用户投稿</span></label
			>
		</div>
		<p class="admin-form-hint">
			关闭后：投稿页显示“投稿暂未开放”，网页智能填充与投稿接口返回 403。已提交的待审核投稿不受影响。
		</p>
	</section>

	<section class="admin-editor" aria-labelledby="seo-title">
		<div class="admin-editor-header"><h2 id="seo-title">搜索引擎</h2></div>
		<div class="admin-form-grid">
			<label class="checkbox-field"
				><input
					type="checkbox"
					name="sitemapEnabled"
					checked={checked('sitemapEnabled', data.settings.sitemapEnabled)}
				/><span>输出 sitemap.xml</span></label
			>
			<label class="admin-field-wide"
				><span>robots.txt 附加规则</span><textarea name="robotsExtra" rows="3" maxlength="500"
					>{value('robotsExtra', data.settings.robotsExtra)}</textarea
				>{#if errors.robotsExtra}<small class="field-error">{errors.robotsExtra}</small>{/if}</label
			>
		</div>
		<p class="admin-form-hint">
			附加规则会接在默认 Disallow 列表之后；关闭 sitemap 后 robots.txt 不再输出 Sitemap
			行，/sitemap.xml 返回 404。
		</p>
	</section>

	<div class="admin-form-actions">
		<button class="admin-primary-button" type="submit">保存设置</button>
	</div>
</form>

<style>
	.admin-page-note {
		margin: 6px 0 0;
		color: #7b8087;
		font-size: 13px;
		line-height: 1.6;
	}

	.site-settings-form {
		display: grid;
		gap: 16px;
	}

	.site-settings-form .admin-editor {
		margin: 0;
	}

	.checkbox-field {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 14px;
	}

	.checkbox-field input {
		width: 16px;
		height: 16px;
	}

	.admin-form-hint {
		margin: 0;
		color: #7b8087;
		font-size: 13px;
		line-height: 1.6;
	}
</style>
