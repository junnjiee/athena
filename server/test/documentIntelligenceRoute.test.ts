import { describe, expect, test } from 'bun:test'
import Fastify from 'fastify'
import { registerDocumentIntelligenceRoutes } from '../src/routes/documentIntelligence'

describe('POST /api/document-intelligence', () => {
  test('decodes, extracts, and forwards bounded plain text', async () => {
    const app = Fastify()
    let forwarded: unknown
    registerDocumentIntelligenceRoutes(app, {
      run: async (documents) => {
        forwarded = documents
        return { proposals: [], rejected: [] }
      },
    })

    const response = await app.inject({
      method: 'POST',
      url: '/api/document-intelligence',
      payload: {
        documents: [{
          id: 'sitrep', name: 'sitrep.txt', mediaType: 'text/plain',
          dataBase64: Buffer.from('Reserve 1 IVO Kranji').toString('base64'),
        }],
      },
    })

    expect(response.statusCode).toBe(200)
    expect(forwarded).toEqual([{ id: 'sitrep', name: 'sitrep.txt', text: 'Reserve 1 IVO Kranji' }])
  })

  test('rejects malformed base64 and unsupported files', async () => {
    const app = Fastify()
    registerDocumentIntelligenceRoutes(app, { run: async () => ({ proposals: [], rejected: [] }) })

    const malformed = await app.inject({
      method: 'POST', url: '/api/document-intelligence',
      payload: { documents: [{ id: 'x', name: 'x.txt', mediaType: 'text/plain', dataBase64: '***=' }] },
    })
    const unsupported = await app.inject({
      method: 'POST', url: '/api/document-intelligence',
      payload: { documents: [{ id: 'x', name: 'x.png', mediaType: 'image/png', dataBase64: 'eA==' }] },
    })

    expect(malformed.statusCode).toBe(400)
    expect(unsupported.statusCode).toBe(400)
  })

  test('requires unique evidence ids and caps aggregate extracted text', async () => {
    const app = Fastify()
    registerDocumentIntelligenceRoutes(app, {
      extract: async (document) => ({ id: document.id, name: document.name, text: 'x'.repeat(300_000) }),
      run: async () => ({ proposals: [], rejected: [] }),
    })
    const encoded = Buffer.from('x').toString('base64')
    const duplicate = await app.inject({
      method: 'POST', url: '/api/document-intelligence',
      payload: { documents: [
        { id: 'same', name: 'a.txt', mediaType: 'text/plain', dataBase64: encoded },
        { id: 'same', name: 'b.txt', mediaType: 'text/plain', dataBase64: encoded },
      ] },
    })
    const aggregate = await app.inject({
      method: 'POST', url: '/api/document-intelligence',
      payload: { documents: [
        { id: 'a', name: 'a.txt', mediaType: 'text/plain', dataBase64: encoded },
        { id: 'b', name: 'b.txt', mediaType: 'text/plain', dataBase64: encoded },
      ] },
    })

    expect(duplicate.statusCode).toBe(400)
    expect(duplicate.json().error).toContain('unique')
    expect(aggregate.statusCode).toBe(413)
  })
})
