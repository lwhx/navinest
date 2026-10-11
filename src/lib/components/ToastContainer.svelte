<script lang="ts">
	import { getToasts, removeToast } from '$lib/toast';
	const toasts = $derived(getToasts());
</script>

{#if toasts.length}
	<div class="toast-container" role="status" aria-live="polite">
		{#each toasts as toast (toast.id)}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<div
				class="toast-item {toast.type}"
				role="button"
				tabindex="0"
				onclick={() => removeToast(toast.id)}
				onkeydown={(e) => {
					if (e.key === 'Enter' || e.key === ' ') removeToast(toast.id);
				}}
			>
				<span>{toast.message}</span>
			</div>
		{/each}
	</div>
{/if}

<style>
	.toast-container {
		position: fixed;
		top: 24px;
		left: 50%;
		transform: translateX(-50%);
		z-index: 1000;
		display: flex;
		flex-direction: column;
		gap: 8px;
		pointer-events: none;
		max-width: min(90vw, 420px);
	}
	.toast-item {
		pointer-events: auto;
		display: flex;
		align-items: center;
		padding: 10px 18px;
		border-radius: 12px;
		font-size: 13px;
		font-weight: 600;
		box-shadow: 0 10px 32px rgba(0, 0, 0, 0.2);
		backdrop-filter: blur(12px);
		animation: toast-slide-in 0.22s cubic-bezier(0.16, 1, 0.3, 1);
		cursor: pointer;
		color: #fff;
		background: #202631;
		border: 1px solid rgba(255, 255, 255, 0.15);
	}
	.toast-item.success {
		background: #1f6f5c;
		border-color: rgba(44, 166, 111, 0.4);
	}
	.toast-item.error {
		background: #b91c1c;
		border-color: rgba(239, 68, 68, 0.4);
	}
	@keyframes toast-slide-in {
		from {
			opacity: 0;
			transform: translateY(-12px) scale(0.96);
		}
		to {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
	}
</style>
