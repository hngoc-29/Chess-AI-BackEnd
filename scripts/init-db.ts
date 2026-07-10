/**
 * Database Initialization Script
 * 
 * Applies the Turso schema to initialize all database tables.
 * Run this once when setting up a new database.
 * 
 * Usage:
 *   npx tsx scripts/init-db.ts
 */

import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';
import { join } from 'path';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL;
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN;

if (!TURSO_DATABASE_URL || !TURSO_AUTH_TOKEN) {
    console.error('❌ Error: TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be set in .env');
    process.exit(1);
}

// Split SQL file into individual statements
function splitSqlStatements(sql: string): string[] {
    const statements: string[] = [];
    let current = '';
    let inBeginEnd = false;

    const lines = sql.split('\n');

    for (let line of lines) {
        const trimmed = line.trim();

        // Skip comments and empty lines when not in a statement
        if (!current && (trimmed.startsWith('--') || trimmed === '')) {
            continue;
        }

        // Track BEGIN/END blocks (for triggers)
        if (trimmed.toUpperCase().startsWith('BEGIN')) {
            inBeginEnd = true;
        }

        current += line + '\n';

        // Statement ends with semicolon, but not if we're in a BEGIN/END block
        if (trimmed.endsWith(';')) {
            if (inBeginEnd && trimmed.toUpperCase().includes('END')) {
                inBeginEnd = false;
                statements.push(current.trim());
                current = '';
            } else if (!inBeginEnd) {
                statements.push(current.trim());
                current = '';
            }
        }
    }

    // Add any remaining statement
    if (current.trim()) {
        statements.push(current.trim());
    }

    return statements.filter(s => s.length > 0);
}

async function initDatabase() {
    console.log('🔧 Initializing Turso Database...\n');

    // Connect to Turso
    const client = createClient({
        url: TURSO_DATABASE_URL,
        authToken: TURSO_AUTH_TOKEN,
    });

    try {
        // Read SQL schema file
        const schemaPath = join(__dirname, '..', 'sql', 'turso-schema.sql');
        console.log(`📄 Reading schema from: ${schemaPath}`);
        const schemaSql = readFileSync(schemaPath, 'utf-8');

        // Split into individual statements
        const statements = splitSqlStatements(schemaSql);
        console.log(`📝 Found ${statements.length} SQL statements\n`);

        // Execute each statement
        let successCount = 0;
        let errorCount = 0;

        for (let i = 0; i < statements.length; i++) {
            const statement = statements[i];

            // Extract statement type for logging
            const firstLine = statement.split('\n')[0].trim();
            const statementType = firstLine.substring(0, 50);

            try {
                await client.execute(statement);
                successCount++;
                console.log(`✅ [${i + 1}/${statements.length}] ${statementType}`);
            } catch (error: any) {
                errorCount++;
                console.error(`❌ [${i + 1}/${statements.length}] Failed: ${statementType}`);
                console.error(`   Error: ${error.message}\n`);
            }
        }

        console.log(`\n📊 Summary:`);
        console.log(`   ✅ Successful: ${successCount}`);
        console.log(`   ❌ Failed: ${errorCount}`);

        if (errorCount === 0) {
            console.log('\n🎉 Database initialization completed successfully!');
        } else {
            console.log('\n⚠️  Database initialization completed with errors.');
            process.exit(1);
        }

    } catch (error: any) {
        console.error('❌ Fatal error:', error.message);
        process.exit(1);
    }
}

initDatabase();
