import { fail, redirect } from '@sveltejs/kit';
import { getDatabase, requireDatabase } from '$lib/server/db';
import { invalidAction } from '$lib/server/admin-mutations';
import { AdminWriteError } from '$lib/server/services/admin-write';
import {
	loadMessageBatches,
	listMessageRecipients,
	messageStats,
	previewAdminMessage,
	sendAdminMessage,
	validateAdminMessageInput,
	withdrawMessageBatch,
	messageProof,
	getMessageBatch
} from '$lib/server/services/admin-messages';
import { messageFilters } from '$lib/messages';
import type { Actions, PageServerLoad } from './$types';
export const load: PageServerLoad = async ({ platform, url }) => {
	const db = getDatabase(platform),
		recipientQuery = (url.searchParams.get('recipientQ') ?? '').trim().slice(0, 100);
	if (!db)
		return {
			source: 'fallback' as const,
			recipients: [],
			hasMore: false,
			recipientQuery,
			filters: messageFilters(url.searchParams, true),
			batches: [],
			total: 0,
			pageCount: 1,
			stats: { batches: 0, announcements: 0, system: 0, review: 0, unread: 0 },
			selected: null
		};
	const [history, recipients, stats, selected] = await Promise.all([
		loadMessageBatches(db, url.searchParams),
		listMessageRecipients(db, recipientQuery),
		messageStats(db),
		url.searchParams.has('batch')
			? getMessageBatch(db, (url.searchParams.get('batch') ?? '').slice(0, 80))
			: null
	]);
	return {
		source: 'database' as const,
		...history,
		...recipients,
		stats,
		recipientQuery,
		selected
	};
};
export const actions: Actions = {
	edit: async ({ request }) => ({
		success: true,
		values: Object.fromEntries(await request.formData()),
		message: ''
	}),
	preview: async ({ platform, request, locals }) => {
		const form = await request.formData(),
			validation = validateAdminMessageInput(Object.fromEntries(form));
		if (!validation.valid) return invalidAction(validation, form);
		try {
			const preview = await previewAdminMessage(
				requireDatabase(platform),
				locals.admin!.id,
				validation.data
			);
			return { success: true, preview, values: Object.fromEntries(form), message: '' };
		} catch (error) {
			return fail(error instanceof AdminWriteError ? error.status : 500, {
				success: false,
				values: Object.fromEntries(form),
				message: error instanceof AdminWriteError ? error.message : '检查失败，请稍后重试。'
			});
		}
	},
	send: async ({ platform, request, locals }) => {
		const form = await request.formData(),
			values = Object.fromEntries(form),
			validation = validateAdminMessageInput(values);
		if (!validation.valid) return invalidAction(validation, form);
		try {
			if (form.get('confirmed') !== 'yes') throw new AdminWriteError('请确认接收范围和消息内容。');
			const proof = messageProof({
				batchId: form.get('batchId'),
				digest: form.get('digest'),
				createdAt: Number(form.get('createdAt'))
			});
			const result = await sendAdminMessage(
				requireDatabase(platform),
				locals.admin!.id,
				validation.data,
				proof
			);
			redirect(303, '/admin/messages?sent=1&batch=' + encodeURIComponent(result.batchId));
		} catch (error) {
			if (error && typeof error === 'object' && 'status' in error && error.status === 303)
				throw error;
			return fail(error instanceof AdminWriteError ? error.status : 500, {
				success: false,
				values,
				preview: {
					batchId: String(values.batchId ?? ''),
					digest: String(values.digest ?? ''),
					createdAt: Number(values.createdAt),
					recipients: Number(values.recipients),
					scopeLabel: String(values.scopeLabel ?? ''),
					title: validation.data.title,
					content: validation.data.content,
					type: validation.data.type
				},
				message:
					error instanceof AdminWriteError
						? error.message
						: '发送结果待核对。请沿用原预览重试或查看批次记录。'
			});
		}
	},
	withdraw: async ({ platform, request }) => {
		const form = await request.formData(),
			id = String(form.get('batchId') ?? '');
		if (form.get('confirmed') !== 'yes')
			return fail(400, { success: false, message: '请先确认撤回该批次。' });
		try {
			await withdrawMessageBatch(requireDatabase(platform), id);
		} catch (error) {
			return fail(error instanceof AdminWriteError ? error.status : 500, {
				success: false,
				message: error instanceof AdminWriteError ? error.message : '撤回结果待核对，请刷新该批次。'
			});
		}
		redirect(303, '/admin/messages?batch=' + encodeURIComponent(id));
	}
};
