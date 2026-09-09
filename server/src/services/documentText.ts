import path from 'node:path'
import mammoth from 'mammoth'
import { PDFParse } from 'pdf-parse'

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024
export const MAX_DOCUMENT_TEXT = 100_000

export interface UploadedDocument {
  id: string
  name: string
  mediaType: string
  data: Buffer
}

export interface TextDocument {
  id: string
  name: string
  text: string
}

export class UnsupportedDocumentError extends Error {}
export class EmptyDocumentError extends Error {}

function extension(name: string): string {
  return path.extname(name).toLowerCase()
}

function boundedText(text: string, name: string): string {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\0/g, '').trim()
  if (!normalized) throw new EmptyDocumentError(`${name} contains no extractable text`)
  if (normalized.length > MAX_DOCUMENT_TEXT) {
    throw new UnsupportedDocumentError(
      `${name} contains more than ${MAX_DOCUMENT_TEXT.toLocaleString()} characters`,
    )
  }
  return normalized
}

/** Convert supported files in memory. Source bytes are never written to disk
 * and only the bounded plain text crosses the hosted-model boundary. */
export async function extractDocumentText(document: UploadedDocument): Promise<TextDocument> {
  if (document.data.byteLength > MAX_DOCUMENT_BYTES) {
    throw new UnsupportedDocumentError(`${document.name} is larger than 10 MB`)
  }

  const ext = extension(document.name)
  let text: string
  const type = document.mediaType.toLowerCase()
  const textType = type === 'text/plain' || type === 'text/markdown'
  const docxType = type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  const pdfType = type === 'application/pdf'
  const hasExtension = ext.length > 0

  // A recognized extension is authoritative. Do not let a contradictory MIME
  // type reinterpret arbitrary bytes as a different, more permissive format.
  if (ext === '.txt' || ext === '.md' || (!hasExtension && textType)) {
    text = document.data.toString('utf8')
  } else if (ext === '.docx' || (!hasExtension && docxType)) {
    const result = await mammoth.extractRawText({ buffer: document.data })
    text = result.value
  } else if (ext === '.pdf' || (!hasExtension && pdfType)) {
    const parser = new PDFParse({ data: new Uint8Array(document.data) })
    try {
      text = (await parser.getText()).text
    } finally {
      await parser.destroy()
    }
  } else {
    throw new UnsupportedDocumentError(
      `${document.name} is not a PDF, DOCX, Markdown, or plain-text document`,
    )
  }

  return { id: document.id, name: document.name, text: boundedText(text, document.name) }
}
