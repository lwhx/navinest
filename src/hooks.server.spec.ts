import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { handle } from './hooks.server';
import { hashSessionToken } from '$lib/server/auth';
import type { Database, DatabaseStatement, DatabaseValue } from '$lib/server/db';

const connections: DatabaseSync[] = [];
afterEach(() => connections.splice(0).forEach((connection) => connection.close()));

async function fixture() {
	const sqlite = new DatabaseSync(':memory:');
	connections.push(sqlite);
	sqlite.exec(`
		CREATE TABLE users(id INTEGER PRIMARY KEY,email TEXT,username TEXT,display_name TEXT,role TEXT,status TEXT,password_hash TEXT);
		CREATE TABLE user_sessions(token_hash TEXT PRIMARY KEY,user_id INTEGER,expires_at TEXT);
		INSERT INTO users VALUES(7,'admin@example.com','owner','管理员','admin','active',NULL);
	`);
	sqlite
		.prepare('INSERT INTO user_sessions VALUES(?,7,?)')
		.run(await hashSessionToken('valid-token'), '2099-01-01T00:00:00.000Z');
	const database: Database = {
		prepare(query) {
			let values: DatabaseValue[] = [];
			const statement: DatabaseStatement = {
				bind(...next) {
					values = next;
					return statement;
				},
				async all<T>() {
					return {
						results: sqlite
							.prepare(query)
							.all(
								...values.map((value) =>
									value instanceof ArrayBuffer ? new Uint8Array(value) : value
								)
							) as T[]
					};
				}
			};
			return statement;
		}
	};
	function event(
		path = '/admin/items?type=site',
		token: string | null = 'valid-token',
		mode = 'session',
		method = 'GET'
	) {
		const url = new URL(path, 'https://nss.whks.de');
		return {
			url,
			request: new Request(url, {
				method,
				headers: {
					'cf-access-authenticated-user-email': 'admin@example.com',
					'cf-access-jwt-assertion': 'untrusted-client-header'
				}
			}),
			platform: { env: { DB: database, ADMIN_AUTH_MODE: mode } },
			cookies: { get: () => token },
			locals: { user: null, admin: null }
		} as unknown as RequestEvent;
	}
	const resolve = vi.fn(async () => new Response('authorized'));
	const run = (request = event()) => handle({ event: request, resolve });
	return { sqlite, event, resolve, run };
}

describe('deployed admin session guard', () => {
	it('reuses a verified admin session without Access and keeps security headers', async () => {
		const { event, run, resolve } = await fixture();
		const request = event();
		request.request = new Request(request.url);
		const response = await run(request);
		expect(response.status).toBe(200);
		expect(request.locals.admin).toMatchObject({ id: 7, source: 'session' });
		expect(resolve).toHaveBeenCalledOnce();
		expect(response.headers.get('cache-control')).toBe('private, no-store');
		expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
	});
	it.each(['missing', 'forged', 'expired', 'revoked', 'inactive'])(
		'requires sign-in for %s sessions even with forged Access headers',
		async (state) => {
			const { sqlite, event, run, resolve } = await fixture();
			if (state === 'expired')
				sqlite.exec("UPDATE user_sessions SET expires_at='2000-01-01T00:00:00.000Z'");
			if (state === 'revoked') sqlite.exec('DELETE FROM user_sessions');
			if (state === 'inactive') sqlite.exec("UPDATE users SET status='disabled'");
			const request = event(
				'/admin/items?type=site',
				state === 'missing' ? null : state === 'forged' ? 'fake-token' : 'valid-token'
			);
			await expect(run(request)).rejects.toMatchObject({
				status: 303,
				location: '/login?returnTo=%2Fadmin%2Fitems%3Ftype%3Dsite'
			});
			expect(resolve).not.toHaveBeenCalled();
			expect(request.locals.admin).toBeNull();
		}
	);
	it('reads the current role so a demoted session cannot administer the site', async () => {
		const { sqlite, run, resolve } = await fixture();
		sqlite.exec("UPDATE users SET role='user'");
		await expect(run()).rejects.toMatchObject({ status: 403 });
		expect(resolve).not.toHaveBeenCalled();
	});
	it('protects admin APIs and POST actions instead of redirecting unauthorized writes', async () => {
		const { event, run, resolve } = await fixture();
		for (const [path, method] of [
			['/api/admin/users', 'GET'],
			['/api/admin/items', 'POST'],
			['/admin/items', 'POST']
		])
			await expect(run(event(path, null, 'session', method))).rejects.toMatchObject({
				status: 401
			});
		expect(resolve).not.toHaveBeenCalled();
	});
	it('does not substitute a site session in Access mode', async () => {
		const { event, run, resolve } = await fixture();
		const request = event('/admin', 'valid-token', 'access');
		request.request = new Request(request.url);
		await expect(run(request)).rejects.toMatchObject({ status: 401 });
		expect(resolve).not.toHaveBeenCalled();
	});
	it('does not require administrator permission on public pages', async () => {
		const { event, run } = await fixture();
		expect((await run(event('/search?q=工具', null))).status).toBe(200);
	});
});
