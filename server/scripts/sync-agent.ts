/**
 * Creates or updates the Athena voice agent from services/assistantAgent.ts.
 *
 *   bun run agent:sync
 *
 * With ELEVENLABS_AGENT_ID set in server/.env, the existing agent is updated in
 * place. Without it, a new agent is created and the id is printed for you to
 * paste into server/.env.
 *
 * Keeping the agent definition in the repo means the prompt and tool catalog
 * are reviewable and reproducible instead of living only in a web dashboard.
 */

import { config } from '../src/config'
import {
  ATHENA_SYSTEM_PROMPT,
  ATHENA_TOOLS,
  toElevenLabsTool,
} from '../src/services/assistantAgent'

const AGENT_NAME = 'Athena'
/** Rachel — a clear, calm default. Override with ELEVENLABS_VOICE_ID. */
const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM'

function agentBody(): unknown {
  return {
    name: AGENT_NAME,
    conversation_config: {
      agent: {
        prompt: {
          prompt: ATHENA_SYSTEM_PROMPT,
          llm: 'gemini-2.0-flash',
          temperature: 0.3,
          tools: ATHENA_TOOLS.map(toElevenLabsTool),
        },
        first_message:
          'Athena ready. Name the ground you want to work on, or tell me what to plan.',
        language: 'en',
      },
      tts: { voice_id: process.env.ELEVENLABS_VOICE_ID ?? DEFAULT_VOICE_ID },
    },
  }
}

async function main(): Promise<void> {
  if (!config.elevenLabsApiKey) {
    console.error('ELEVENLABS_API_KEY is not set. Add it to server/.env (see .env.example).')
    process.exit(1)
  }

  const existingId = config.elevenLabsAgentId
  const url = existingId
    ? `${config.elevenLabsApiUrl}/convai/agents/${existingId}`
    : `${config.elevenLabsApiUrl}/convai/agents/create`

  const res = await fetch(url, {
    method: existingId ? 'PATCH' : 'POST',
    headers: {
      'xi-api-key': config.elevenLabsApiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(agentBody()),
  })

  if (!res.ok) {
    console.error(`ElevenLabs rejected the request (HTTP ${res.status}):`)
    console.error(await res.text().catch(() => '<no body>'))
    process.exit(1)
  }

  const body = (await res.json()) as { agent_id?: string }
  const agentId = body.agent_id ?? existingId

  console.log(
    `${existingId ? 'Updated' : 'Created'} agent "${AGENT_NAME}" with ${ATHENA_TOOLS.length} tools.`,
  )
  if (!existingId) {
    console.log(`\nAdd this to server/.env:\n\n  ELEVENLABS_AGENT_ID=${agentId}\n`)
  }
}

await main()
