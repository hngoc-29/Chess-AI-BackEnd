import { createClient } from '@libsql/client';
import { env } from '../config/env';

/**
 * Turso database client - replaces Supabase for data storage.
 * Uses LibSQL (SQLite-compatible) with edge replication.
 */
export const turso = createClient({
    url: env.TURSO_DATABASE_URL,
    authToken: env.TURSO_AUTH_TOKEN,
});

/**
 * Helper to execute a query and return all rows
 */
export async function query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    const result = await turso.execute({ sql, args: params });
    return result.rows as T[];
}

/**
 * Helper to execute a query and return first row or null
 */
export async function queryOne<T = any>(sql: string, params: any[] = []): Promise<T | null> {
    const rows = await query<T>(sql, params);
    return rows[0] || null;
}

/**
 * Helper to execute an INSERT/UPDATE/DELETE and return affected rows
 */
export async function execute(sql: string, params: any[] = []): Promise<number> {
    const result = await turso.execute({ sql, args: params });
    return result.rowsAffected;
}

/**
 * Helper to execute INSERT and return the last inserted row ID
 */
export async function insert(sql: string, params: any[] = []): Promise<string> {
    const result = await turso.execute({ sql, args: params });
    return result.lastInsertRowid?.toString() || '';
}

/**
 * Transaction helper
 */
export async function transaction<T>(fn: () => Promise<T>): Promise<T> {
    await turso.execute('BEGIN TRANSACTION');
    try {
        const result = await fn();
        await turso.execute('COMMIT');
        return result;
    } catch (error) {
        await turso.execute('ROLLBACK');
        throw error;
    }
}
