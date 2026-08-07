import type { FastifyInstance } from 'fastify'
import { config } from '../config'

/**
 * Voice-assistant session brokering.
 *
 * The ElevenLabs API key is a server-side secret, so the browser never sees it.
 * Instead the client asks for a short-lived WebRTC conversation token scoped to
 * the Athena agent, and hands that to the ElevenLabs SDK.
 */

interface TokenResponse {
  token?: string
}

/** Everything that must be configured before a voice session can start. */
function missingAssistantConfig(): string | null {
  if (!config.elevenLabsApiKey) return 'ELEVENLABS_API_KEY is not set'
  if (!config.elevenLabsAgentId) {
    return 'ELEVENLABS_AGENT_ID is not set — run `bun run agent:sync` to create the agent'
  }
  return null
}

export function registerAssistantRoutes(app: FastifyInstance): void {
  /** Which integrations are wired up. Booleans only — never key material. */
  app.get('/api/settings/status', async () => ({
    database: config.databaseUrl !== '',
    elevenLabsKey: config.elevenLabsApiKey !== '',
    elevenLabsAgent: config.elevenLabsAgentId !== '',
    agentId: config.elevenLabsAgentId || null,
  }))

  /** Mints a conversation token for a new voice session. 503 (not 500) when the
   *  server simply hasn't been configured yet, so the UI can tell "needs setup"
   *  apart from "something broke". */
  app.get('/api/assistant/session', async (_req, reply) => {
    const missing = missingAssistantConfig()
    if (missing) return reply.status(503).send({ error: missing })

    const url = `${config.elevenLabsApiUrl}/convai/conversation/token?agent_id=${encodeURIComponent(config.elevenLabsAgentId)}`

    let res: Response
    try {
      res = await fetch(url, {
        headers: { 'xi-api-key': config.elevenLabsApiKey },
        signal: AbortSignal.timeout(config.elevenLabsTimeoutMs),
      })
    } catch (error: unknown) {
      app.log.error({ error }, 'elevenlabs token request failed')
      return reply.status(502).send({ error: 'could not reach the voice service' })
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      app.log.error({ status: res.status, detail }, 'elevenlabs token request rejected')
      // The upstream body can echo account/key details, so don't forward it.
      return reply
        .status(502)
        .send({ error: `voice service rejected the session request (HTTP ${res.status})` })
    }

    const body = (await res.json()) as TokenResponse
    if (!body.token) {
      return reply.status(502).send({ error: 'voice service returned no token' })
    }

    return { conversationToken: body.token, agentId: config.elevenLabsAgentId }
  })
}
