import { neon } from '@neondatabase/serverless'
import { drizzle as drizzleNeon } from 'drizzle-orm/neon-http'
import { drizzle as drizzlePg, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { config } from '../config'
import * as schema from './schema'

if (!config.databaseUrl) throw new Error('DATABASE_URL is not set (see server/.env.example)')

/**
 * Postgres, over whichever protocol the connection string implies.
 *
 * Neon's serverless driver speaks Neon's own HTTP protocol, not the Postgres
 * wire protocol, so it cannot reach an ordinary Postgres server — including the
 * one in docker-compose. The host decides: `*.neon.tech` gets the HTTP driver,
 * anything else gets a normal TCP pool.
 *
 * Both are one-shot query paths for our purposes. We issue plain selects,
 * inserts and updates and never open an interactive transaction, which is the
 * one thing neon-http cannot do, so the two are interchangeable here.
 */
function isNeon(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith('.neon.tech')
  } catch {
    // Not a parseable URL -- let the driver produce the connection error rather
    // than guessing, and take the ordinary Postgres path to get there.
    return false
  }
}

/** The two drivers expose the same query builder but are nominally distinct
 *  types, so the union is collapsed once here instead of at every call site. */
export const db = (
  isNeon(config.databaseUrl)
    ? drizzleNeon(neon(config.databaseUrl), { schema })
    : drizzlePg(new Pool({ connectionString: config.databaseUrl }), { schema })
) as unknown as NodePgDatabase<typeof schema>
