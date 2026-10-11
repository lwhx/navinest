export type Toast = {
	id: number;
	type: 'info' | 'success' | 'error';
	message: string;
};

let counter = 0;
const toasts = $state<Toast[]>([]);

export function getToasts(): Toast[] {
	return toasts;
}

export function showToast(
	message: string,
	type: 'info' | 'success' | 'error' = 'info',
	duration = 3200
): number {
	const id = ++counter;
	toasts.push({ id, type, message });
	if (duration > 0) {
		setTimeout(() => {
			removeToast(id);
		}, duration);
	}
	return id;
}

export function removeToast(id: number) {
	const index = toasts.findIndex((t) => t.id === id);
	if (index !== -1) {
		toasts.splice(index, 1);
	}
}
