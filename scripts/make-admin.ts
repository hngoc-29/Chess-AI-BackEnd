import { createClient } from '@libsql/client';
import dotenv from 'dotenv';
dotenv.config();

const userId = process.argv[2];

if (!userId) {
    console.error('Usage: tsx scripts/make-admin.ts <user-id>');
    process.exit(1);
}

const client = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
});

async function makeAdmin() {
    try {
        await client.execute({
            sql: "UPDATE users SET role = 'admin' WHERE id = ?",
            args: [userId]
        });
        console.log(`✅ User ${userId} is now an admin!`);
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

makeAdmin();
