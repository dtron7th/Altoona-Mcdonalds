import { neon } from '@netlify/neon';
import { drizzle as drizzleNeon } from 'drizzle-orm/neon-http';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from './schema';

const netlifyDatabaseUrl = process.env.NETLIFY_DATABASE_URL;
const standardDatabaseUrl = process.env.DATABASE_URL;

if (!netlifyDatabaseUrl && !standardDatabaseUrl) {
    throw new Error('Set NETLIFY_DATABASE_URL or DATABASE_URL before using the database client.');
}

export const db = netlifyDatabaseUrl
    ? drizzleNeon({
        schema,
        client: neon()
    })
    : drizzlePg(
        new Pool({
            connectionString: standardDatabaseUrl,
            ssl: standardDatabaseUrl && standardDatabaseUrl.includes('localhost')
                ? false
                : { rejectUnauthorized: false }
        }),
        { schema }
    );