import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const read = (path: string) => readFileSync(path, 'utf8');

describe('AI-assisted submission workflow', () => {
	it('keeps AI suggestions user-controlled in the contribution flow', () => {
		const page = read('src/routes/contribute/+page.svelte');
		expect(page).toContain("fetch('/api/submissions/enrich'");
		expect(page).toContain('智能获取网页信息');
		expect(page).toContain('采用建议');
		expect(page).toContain('全部采用');
		expect(page).toContain('AI生成内容可能不准确');
		expect(page).toContain('webSnapshot: snapshot');
		expect(page).toContain('aiSuggestion');
	});

	it('provides masked tested-before-enabled provider management', () => {
		const page = read('src/routes/admin/ai-providers/+page.svelte'),
			server = read('src/routes/admin/ai-providers/+page.server.ts'),
			migration = read('migrations/0011_ai_providers.sql');
		expect(page).toContain('数据库只保存AES-GCM密文');
		expect(page).toContain('只有测试通过的服务才能启用');
		expect(page).toContain('provider.testStatus');
		expect(server).toContain('enableAiProvider');
		expect(migration).toContain("test_status TEXT NOT NULL DEFAULT 'untested'");
		expect(migration).toContain('ai_usage_events');
	});

	it('uses a review queue with user, webpage and AI evidence', () => {
		const page = read('src/routes/admin/submissions/+page.svelte');
		expect(page).toContain('review-workbench');
		expect(page).toContain('用户最终提交');
		expect(page).toContain('网页原始提取');
		expect(page).toContain('AI建议');
		expect(page).toContain('最终发布内容');
		expect(page).toContain('正式标签');
		expect(page).toContain('resolve(`/go?url=');
	});
});
