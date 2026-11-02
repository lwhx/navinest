<script lang="ts">
	let {
		discard = $bindable(null),
		onclear
	}: { discard: (() => void) | null; onclear: () => void } = $props();
	let dialog = $state<HTMLDialogElement>();
	$effect(() => {
		if (discard && dialog && !dialog.open) dialog.showModal();
		else if (!discard && dialog?.open) dialog.close();
	});
	function approve() {
		const action = discard;
		discard = null;
		onclear();
		action?.();
	}
</script>

<dialog
	class="discard-dialog"
	bind:this={dialog}
	oncancel={(event) => {
		event.preventDefault();
		discard = null;
	}}
	aria-labelledby="discard-title"
>
	<h2 id="discard-title">放弃未保存的修改？</h2>
	<p>当前编辑内容尚未保存，继续会丢弃这些修改。</p>
	<div class="actions">
		<button onclick={() => (discard = null)}>继续编辑</button><button
			class="danger"
			onclick={approve}>放弃修改并继续</button
		>
	</div>
</dialog>

<style>
	.discard-dialog {
		border: 1px solid #ccd1da;
		border-radius: 15px;
		max-width: 440px;
		width: calc(100% - 32px);
		padding: 24px;
		box-sizing: border-box;
		background: #fff;
		color: #252c36;
	}
	.discard-dialog::backdrop {
		background: #11182799;
	}
	.discard-dialog h2 {
		margin: 0 0 10px;
	}
	.discard-dialog p {
		line-height: 1.7;
	}
	.discard-dialog button {
		--nw-bg: #fff;
		--nw-border: #ccd1da;
		--nw-text: #252c36;
	}
	:global([data-theme='dark']) .discard-dialog {
		background: #20252d;
		color: #edf0f5;
	}
	:global([data-theme='dark']) .discard-dialog button {
		--nw-bg: #20252d;
		--nw-border: #444d5b;
		--nw-text: #edf0f5;
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
	button.danger {
		color: #b62333;
		border-color: #dba8af;
	}
	button:disabled {
		opacity: 0.48;
		cursor: not-allowed;
	}
</style>
