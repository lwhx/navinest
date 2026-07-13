<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { appConfig } from '$lib/config';

	let notFound = $derived(page.status === 404);
</script>

<svelte:head>
	<title>{page.status} | {appConfig.displayName}</title>
	<meta name="robots" content="noindex,nofollow" />
</svelte:head>

<main class="error-page">
	<section class="error-panel">
		<p class="error-code">{page.status}</p>
		<h1>{notFound ? '没有找到这个页面' : '页面暂时不可用'}</h1>
		<p>{notFound ? '地址可能已更改，或内容尚未发布。' : '请求未能完成，请稍后再试。'}</p>
		<div class="admin-form-actions">
			<button class="admin-secondary-button" type="button" onclick={() => history.back()}
				>返回上一页</button
			><a class="primary-action" href={resolve('/')}>返回首页</a>
		</div>
	</section>
</main>
