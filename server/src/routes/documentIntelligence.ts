import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { config } from '../config'
import {
  MAX_DOCUMENT_BYTES,
  extractDocumentText,
  type TextDocument,
  type UploadedDocument,
} from '../services/documentText'
import { EngineUnavailableError, runDocumentIntelligence } from '../services/engineClient'
import type { DocumentIntelligence } from '../types/documentIntelligence'

const MAX_DOCUMENTS = 20
const MAX_TOTAL_BYTES = 40 * 1024 * 1024
const MAX_TOTAL_TEXT = 500_000
const MAX_BASE64_LENGTH = Math.ceil(MAX_DOCUMENT_BYTES / 3) * 4 + 4

export const documentIntelligenceBody = z.object({
  documents: z.array(z.object({
    id: z.string().trim().min(1).max(120),
    name: z.string().trim().min(1).max(240),
    mediaType: z.string().trim().min(1).max(160),
    dataBase64: z.string().max(MAX_BASE64_LENGTH),
  })).min(1).max(MAX_DOCUMENTS).refine(
    (documents) => new Set(documents.map((document) => document.id)).size === documents.length,
    'document ids must be unique',
  ),
})

function decodeDocument(input: z.infer<typeof documentIntelligenceBody>['documents'][number]): UploadedDocument {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(input.dataBase64) || input.dataBase64.length % 4 !== 0) {
    throw new Error(`${input.name} is not valid base64 data`)
  }
  return {
    id: input.id,
    name: input.name,
    mediaType: input.mediaType,
    data: Buffer.from(input.dataBase64, 'base64'),
  }
}

export function registerDocumentIntelligenceRoutes(
  app: FastifyInstance,
  dependencies: {
    extract?: (document: UploadedDocument) => Promise<TextDocument>
    run?: (documents: TextDocument[]) => Promise<DocumentIntelligence>
  } = {},
): void {
  const extract = dependencies.extract ?? extractDocumentText
  const run = dependencies.run ?? runDocumentIntelligence

  app.post(
    '/api/document-intelligence',
    {
      bodyLimit: 56 * 1024 * 1024,
      config: {
        rateLimit: { max: 10, timeWindow: config.battlegroundRateWindowMs },
      },
    },
    async (req, reply) => {
      const parsed = documentIntelligenceBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid documents' })
      }
      try {
        const uploads = parsed.data.documents.map(decodeDocument)
        if (uploads.reduce((sum, document) => sum + document.data.byteLength, 0) > MAX_TOTAL_BYTES) {
          return reply.status(413).send({ error: 'documents exceed the 40 MB combined limit' })
        }
        const documents: TextDocument[] = []
        let totalText = 0
        for (const upload of uploads) {
          const document = await extract(upload)
          totalText += document.text.length
          if (totalText > MAX_TOTAL_TEXT) {
            return reply.status(413).send({ error: 'documents exceed the 500,000-character combined limit' })
          }
          documents.push(document)
        }
        return await run(documents)
      } catch (error: unknown) {
        if (error instanceof EngineUnavailableError) {
          return reply.status(502).send({ error: error.message })
        }
        const message = error instanceof Error ? error.message : 'document could not be read'
        return reply.status(400).send({ error: message })
      }
    },
  )
}
