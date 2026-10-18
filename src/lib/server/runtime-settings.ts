// Transient diagnostics and private import receipts do not belong to portable site configuration.
export const portableSettingsScope =
	" WHERE key NOT GLOB 'admin:link-check:*' AND key NOT GLOB 'user:bookmark-import:*'";
export const runtimeSetting = (key: string) =>
	key.startsWith('admin:link-check:') || key.startsWith('user:bookmark-import:');
