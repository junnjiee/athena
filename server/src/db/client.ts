import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import { config } from '../config'
import * as schema from './schema'

if (!config.databaseUrl) throw new Error('DATABASE_URL is not set (see server/.env.example)')

/** One-shot HTTP driver, not the WebSocket pool -- this is a normal
 *  long-running Fastify process (not edge functions), so there's no
 *  cold-start pressure to justify a persistent pool. */
export const db = drizzle(neon(config.databaseUrl), { schema })
