import { describe, expect, it } from 'vitest';
import type { Database, DatabaseStatement } from '$lib/server/db';
import { authorizeAdmin } from '$lib/server/admin-auth';

function databaseWithUser(user: unknown): Database {
	return {
		prepare() {
			const statement: DatabaseStatement = {
				bind() {
					return statement;
				},
				async all<T>() {
					return { results: user ? [user as T] : [] };
				}
			};
			return statement;
		}
	};
}

describe('administrator authorization', () => {
	it('allows the explicit loopback development context', async () => {
		const result = await authorizeAdmin({
			database: null,
			isLocal: true,
			email: null,
			assertion: null
		});

		expect(result).toMatchObject({ authorized: true, identity: { source: 'local' } });
	});

	it('requires both Cloudflare Access identity headers', async () => {
		const result = await authorizeAdmin({
			database: databaseWithUser(null),
			isLocal: false,
			email: 'admin@example.com',
			assertion: null
		});

		expect(result).toEqual({
			authorized: false,
			status: 401,
			message: 'Cloudflare Access authentication required.'
		});
	});

	it('allows only active D1 users with the admin role', async () => {
		const context = {
			isLocal: false,
			email: 'admin@example.com',
			assertion: 'signed-access-token'
		};
		const allowed = await authorizeAdmin({
			...context,
			database: databaseWithUser({
				id: 7,
				email: 'admin@example.com',
				display_name: 'Admin',
				role: 'admin',
				status: 'active'
			})
		});
		const denied = await authorizeAdmin({
			...context,
			database: databaseWithUser({
				id: 8,
				email: 'admin@example.com',
				display_name: 'Member',
				role: 'user',
				status: 'active'
			})
		});

		expect(allowed).toMatchObject({
			authorized: true,
			identity: { id: 7, source: 'access' }
		});
		expect(denied).toMatchObject({ authorized: false, status: 403 });
	});

	it('fails closed when the deployed database binding is unavailable', async () => {
		const result = await authorizeAdmin({
			database: null,
			isLocal: false,
			email: 'admin@example.com',
			assertion: 'signed-access-token'
		});

		expect(result).toMatchObject({ authorized: false, status: 503 });
	});
});
