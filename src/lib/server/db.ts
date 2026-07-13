import type { RequestEvent } from '@sveltejs/kit';

export type DatabaseValue = string | number | null | ArrayBuffer;

export type DatabaseResult<T> = {
	results: T[];
};

export interface DatabaseStatement {
	bind(...values: DatabaseValue[]): DatabaseStatement;
	all<T>(): Promise<DatabaseResult<T>>;
}

export interface Database {
	prepare(query: string): DatabaseStatement;
}

export function getDatabase(platform: RequestEvent['platform']): Database | null {
	return platform?.env?.DB ?? null;
}

export class DatabaseUnavailableError extends Error {
	constructor() {
		super('The D1 database binding is unavailable.');
		this.name = 'DatabaseUnavailableError';
	}
}

export function requireDatabase(platform: RequestEvent['platform']): Database {
	const database = getDatabase(platform);

	if (!database) throw new DatabaseUnavailableError();

	return database;
}
