<script lang="ts">
	import ContentDetail from '$lib/components/ContentDetail.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<ContentDetail {data} />
