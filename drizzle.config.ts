import { defineConfig } from 'drizzle-kit';

const drizzleDatabaseUrl = process.env.NETLIFY_DATABASE_URL || process.env.DATABASE_URL;

if (!drizzleDatabaseUrl) {
    throw new Error('Set NETLIFY_DATABASE_URL or DATABASE_URL before running Drizzle commands.');
}

export default defineConfig({
    dialect: 'postgresql',
    dbCredentials: {
        url: drizzleDatabaseUrl
    },
    schema: './db/schema.ts',
    /**
     * Never edit the migrations directly, only use drizzle.
     * There are scripts in the package.json "db:generate" and "db:migrate" to handle this.
     */
    out: './migrations'
});