<script lang="ts">
	import { getToasts, removeToast, type Toast } from '$lib/toast.svelte';
	const toasts = $derived(getToasts());
</script>

{#snippet message(toast: Toast)}
	<div class="toast-item {toast.type}">
		<span class="toast-icon" aria-hidden="true"
			>{toast.type === 'success' ? '✓' : toast.type === 'error' ? '!' : 'i'}</span
		>
		<span class="toast-message">{toast.message}</span>
		<button type="button" aria-label="关闭提示" onclick={() => removeToast(toast.id)}>×</button>
	</div>
{/snippet}

<div class="toast-container" aria-label="操作反馈">
	<div class="toast-region" role="status" aria-live="polite">
		{#each toasts.filter((toast) => toast.type !== 'error') as toast (toast.id)}{@render message(
				toast
			)}{/each}
	</div>
	<div class="toast-region" role="alert" aria-live="assertive">
		{#each toasts.filter((toast) => toast.type === 'error') as toast (toast.id)}{@render message(
				toast
			)}{/each}
	</div>
</div>

<style>
	.toast-container {
		position: fixed;
		top: 96px;
		left: 50%;
		transform: translateX(-50%);
		z-index: var(--ui-layer-toast);
		display: grid;
		gap: 0;
		width: min(calc(100vw - 32px), 420px);
		pointer-events: none;
	}
	.toast-region {
		display: grid;
		gap: var(--ui-space-2);
	}
	.toast-region:not(:empty) {
		margin-bottom: var(--ui-space-2);
	}
	.toast-item {
		pointer-events: auto;
		display: flex;
		align-items: center;
		gap: var(--ui-space-3);
		border: 1px solid var(--ui-line);
		border-left: 4px solid var(--ui-accent);
		border-radius: var(--ui-radius-card);
		padding: 8px 8px 8px 12px;
		font-size: var(--ui-font-body);
		line-height: 1.5;
		color: var(--ui-text);
		background: var(--ui-surface);
		box-shadow: var(--ui-shadow-overlay);
		animation: toast-slide-in var(--ui-motion-overlay) var(--ui-ease);
	}
	.toast-message {
		flex: 1;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.toast-icon {
		font-weight: 700;
		color: var(--ui-accent);
	}
	.toast-item.success {
		border-left-color: var(--ui-success);
	}
	.toast-item.success .toast-icon {
		color: var(--ui-success);
	}
	.toast-item.error {
		border-left-color: var(--ui-error);
	}
	.toast-item.error .toast-icon {
		color: var(--ui-error);
	}
	button {
		flex: 0 0 var(--ui-control);
		width: var(--ui-control);
		height: var(--ui-control);
		border: 0;
		border-radius: var(--ui-radius-small);
		color: var(--ui-muted);
		background: transparent;
		font-size: 20px;
		cursor: pointer;
	}
	button:hover {
		color: var(--ui-text);
		background: var(--ui-soft);
	}
	button:focus-visible {
		outline: 2px solid var(--ui-accent);
		outline-offset: 2px;
	}
	@keyframes toast-slide-in {
		from {
			opacity: 0;
			transform: translateY(-8px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
</style>
