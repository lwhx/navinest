import type { Database } from '$lib/server/db';
import { createSessionToken } from '$lib/server/auth';
import { createUserSession, type UserIdentity } from '$lib/server/user-auth';

export const OAUTH_STATE_COOKIE = 'navinest_github_state';
export type GitHubProfile = {
	id: number;
	login: string;
	name: string | null;
	email: string | null;
	avatar_url: string | null;
};
export type GitHubEmail = { email: string; primary: boolean; verified: boolean };
export type NormalizedGitHubProfile = {
	providerUserId: string;
	providerUsername: string;
	email: string;
	usernameCandidate: string;
	displayName: string;
	avatarUrl: string | null;
};

export function createOAuthState(bytes = crypto.getRandomValues(new Uint8Array(32))) {
	return createSessionToken(bytes);
}
export function validateOAuthState(cookieState: string | null, callbackState: string | null) {
	if (!cookieState || !callbackState || cookieState.length !== callbackState.length) return false;
	let diff = 0;
	for (let i = 0; i < cookieState.length; i++)
		diff |= cookieState.charCodeAt(i) ^ callbackState.charCodeAt(i);
	return diff === 0;
}
export function normalizeGitHubProfile(
	profile: GitHubProfile,
	emails: GitHubEmail[]
): NormalizedGitHubProfile {
	const verified = emails.find((x) => x.primary && x.verified) ?? emails.find((x) => x.verified);
	const email = (
		profile.email && verified?.email.toLowerCase() === profile.email.toLowerCase()
			? profile.email
			: verified?.email
	)
		?.trim()
		.toLowerCase();
	if (!email) throw new Error('GitHub account requires a verified email.');
	const candidate =
		profile.login
			.toLowerCase()
			.replace(/[^a-z0-9_-]/g, '-')
			.replace(/-+/g, '-')
			.slice(0, 40) || `github-${profile.id}`;
	return {
		providerUserId: String(profile.id),
		providerUsername: profile.login,
		email,
		usernameCandidate: candidate,
		displayName: profile.name?.trim() || profile.login,
		avatarUrl: profile.avatar_url
	};
}
export function githubAuthorizeUrl(clientId: string, state: string, redirectUri: string) {
	const url = new URL('https://github.com/login/oauth/authorize');
	url.searchParams.set('client_id', clientId);
	url.searchParams.set('redirect_uri', redirectUri);
	url.searchParams.set('scope', 'read:user user:email');
	url.searchParams.set('state', state);
	return url.toString();
}
export async function exchangeGitHubCode(
	clientId: string,
	clientSecret: string,
	code: string,
	redirectUri: string,
	fetcher = fetch
) {
	const tokenResponse = await fetcher('https://github.com/login/oauth/access_token', {
		method: 'POST',
		headers: { accept: 'application/json', 'content-type': 'application/json' },
		body: JSON.stringify({
			client_id: clientId,
			client_secret: clientSecret,
			code,
			redirect_uri: redirectUri
		})
	});
	const token = (await tokenResponse.json()) as { access_token?: string; error?: string };
	if (!tokenResponse.ok || !token.access_token)
		throw new Error(token.error || 'GitHub token exchange failed.');
	const headers = {
		accept: 'application/vnd.github+json',
		authorization: `Bearer ${token.access_token}`,
		'user-agent': 'NaviNest'
	};
	const [profileResponse, emailResponse] = await Promise.all([
		fetcher('https://api.github.com/user', { headers }),
		fetcher('https://api.github.com/user/emails', { headers })
	]);
	if (!profileResponse.ok || !emailResponse.ok) throw new Error('GitHub profile request failed.');
	return normalizeGitHubProfile(
		(await profileResponse.json()) as GitHubProfile,
		(await emailResponse.json()) as GitHubEmail[]
	);
}

type OAuthUserRow = {
	id: number;
	email: string | null;
	username: string;
	display_name: string;
	role: string;
};
async function uniqueUsername(database: Database, candidate: string) {
	for (let i = 0; i < 100; i++) {
		const value = i === 0 ? candidate : `${candidate}-${i}`;
		const exists = (
			await database
				.prepare('SELECT id FROM users WHERE lower(username)=? LIMIT 1')
				.bind(value)
				.all<{ id: number }>()
		).results[0];
		if (!exists) return value;
	}
	return `github-${crypto.randomUUID()}`;
}
export async function loginWithGitHub(database: Database, profile: NormalizedGitHubProfile) {
	let user = (
		await database
			.prepare(
				`SELECT u.id,u.email,u.username,u.display_name,u.role FROM oauth_accounts o JOIN users u ON u.id=o.user_id WHERE o.provider='github' AND o.provider_user_id=? LIMIT 1`
			)
			.bind(profile.providerUserId)
			.all<OAuthUserRow>()
	).results[0];
	if (!user)
		user = (
			await database
				.prepare(
					'SELECT id,email,username,display_name,role FROM users WHERE lower(email)=? LIMIT 1'
				)
				.bind(profile.email)
				.all<OAuthUserRow>()
		).results[0];
	if (!user) {
		const username = await uniqueUsername(database, profile.usernameCandidate);
		user = (
			await database
				.prepare(
					`INSERT INTO users(email,username,display_name,role,status) VALUES(?,?,?,'user','active') RETURNING id,email,username,display_name,role`
				)
				.bind(profile.email, username, profile.displayName)
				.all<OAuthUserRow>()
		).results[0];
	}
	if (!user) throw new Error('Unable to create GitHub user.');
	await database
		.prepare(
			`INSERT INTO oauth_accounts(user_id,provider,provider_user_id,provider_username) VALUES(?,'github',?,?) ON CONFLICT(provider,provider_user_id) DO UPDATE SET provider_username=excluded.provider_username,updated_at=CURRENT_TIMESTAMP`
		)
		.bind(user.id, profile.providerUserId, profile.providerUsername)
		.all();
	const session = await createUserSession(database, user.id);
	return {
		user: {
			id: user.id,
			email: user.email,
			username: user.username,
			displayName: user.display_name,
			role: user.role
		} satisfies UserIdentity,
		...session
	};
}
