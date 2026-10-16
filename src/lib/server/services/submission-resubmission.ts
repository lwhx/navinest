// Static SQL: `source` is always the owned original row, never a client-provided alias.
// A new record consumes this source once. A rejected child can itself be revised.
export const resubmissionSourceCondition = `source.status='rejected'
 AND source.type IN ('site','post') AND source.target_item_id IS NULL AND source.review_token IS NULL
 AND json_valid(source.payload_json) AND json_type(CASE WHEN json_valid(source.payload_json) THEN source.payload_json ELSE '{}' END)='object'
 AND COALESCE(json_extract(CASE WHEN json_valid(source.payload_json) THEN source.payload_json ELSE '{}' END,'$._review.state'),'')<>'running'
 AND NOT EXISTS(SELECT 1 FROM submissions child WHERE child.user_id=source.user_id
 AND CAST(json_extract(CASE WHEN json_valid(child.payload_json) THEN child.payload_json ELSE '{}' END,'$.sourceSubmissionId') AS INTEGER)=source.id)`;
