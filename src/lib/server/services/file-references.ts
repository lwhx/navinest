// Callers supply only static SQL identifiers, never request values.
export function fileReferenceCondition(id: string) {
	return `(EXISTS(SELECT 1 FROM items WHERE icon_file_id=${id} OR cover_file_id=${id})
		OR EXISTS(SELECT 1 FROM users WHERE avatar_file_id=${id} OR cover_file_id=${id})
		OR EXISTS(SELECT 1 FROM submissions WHERE status IN ('pending','reviewing') AND
		CAST(json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END,'$.iconFileId') AS INTEGER)=${id}))`;
}
export const FILE_REFERENCES = `
	SELECT icon_file_id AS file_id,'item' AS kind,id,title,'icon' AS usage FROM items WHERE icon_file_id IS NOT NULL
	UNION ALL SELECT cover_file_id,'item',id,title,'cover' FROM items WHERE cover_file_id IS NOT NULL
	UNION ALL SELECT avatar_file_id,'user',id,display_name,'avatar' FROM users WHERE avatar_file_id IS NOT NULL
	UNION ALL SELECT cover_file_id,'user',id,display_name,'profileCover' FROM users WHERE cover_file_id IS NOT NULL
	UNION ALL SELECT CAST(json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END,'$.iconFileId') AS INTEGER),
	'submission',id,title,'submission' FROM submissions WHERE status IN ('pending','reviewing')`;
