import { describe, expect, it } from 'vitest';
import { load } from '../routes/go/+page.server';

describe('safe outbound navigation', () => {
	it('redirects a valid public HTTP target immediately', async () => {
		await expect(
			Promise.resolve().then(() =>
				load({
					url: new URL('https://nss.whks.de/go?url=https%3A%2F%2Fexample.com%2Fdocs%3Fa%3D1')
				} as never)
			)
		).rejects.toMatchObject({ status: 302, location: 'https://example.com/docs?a=1' });
	});

	it('keeps invalid and private targets on the error page', async () => {
		await expect(
			Promise.resolve(
				load({ url: new URL('https://nss.whks.de/go?url=javascript%3Aalert(1)') } as never)
			)
		).resolves.toMatchObject({ valid: false });
		await expect(
			Promise.resolve(
				load({ url: new URL('https://nss.whks.de/go?url=http%3A%2F%2F127.0.0.1%2Fadmin') } as never)
			)
		).resolves.toMatchObject({ valid: false });
	});
});
