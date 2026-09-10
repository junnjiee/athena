/**
 * Applies the migrations in ./drizzle over whichever protocol the connection
 * string implies.
 *
 *   bun run db:migrate
 *
 * drizzle-kit's own `migrate` always speaks the Postgres wire protocol on 5432.
 * Neon also serves its HTTP protocol on 443, and networks that filter 5432 are
 * common enough that a migration is otherwise unrunnable from them even though
 * the server itself connects fine — src/db/client.ts already picks the HTTP
 * driver for Neon hosts. This script makes the migration follow the same rule,
 * so both paths reach the database from the same places.
 */

import { neon } from '@neondatabase/serverless'
import { drizzle as drizzleNeon } from 'drizzle-orm/neon-http'
import { migrate as migrateNeon } from 'drizzle-orm/neon-http/migrator'
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres'
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'
import { config } from '../src/config'

if (!config.databaseUrl) throw new Error('DATABASE_URL is not set (see server/.env.example)')

const migrationsFolder = new URL('../drizzle', import.meta.url).pathname

function isNeon(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith('.neon.tech')
  } catch {
    return false
  }
}

if (isNeon(config.databaseUrl)) {
  await migrateNeon(drizzleNeon(neon(config.databaseUrl)), { migrationsFolder })
} else {
  const pool = new Pool({ connectionString: config.databaseUrl })
  await migratePg(drizzlePg(pool), { migrationsFolder })
  await pool.end()
}

console.log('migrations applied')
