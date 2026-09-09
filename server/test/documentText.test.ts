import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import JSZip from 'jszip'
import {
  EmptyDocumentError,
  MAX_DOCUMENT_BYTES,
  UnsupportedDocumentError,
  extractDocumentText,
} from '../src/services/documentText'

async function minimalDocx(): Promise<Buffer> {
  const archive = new JSZip()
  archive.file('[Content_Types].xml', `<?xml version="1.0"?>
    <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Default Extension="xml" ContentType="application/xml"/>
      <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
    </Types>`)
  archive.folder('_rels')!.file('.rels', `<?xml version="1.0"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
    </Relationships>`)
  archive.folder('word')!.file('document.xml', `<?xml version="1.0"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body><w:p><w:r><w:t>Reserve 1 IVO Kranji</w:t></w:r></w:p></w:body>
    </w:document>`)
  return archive.generateAsync({ type: 'nodebuffer' })
}

describe('document text extraction', () => {
  test('reads UTF-8 text and strips a BOM and nulls', async () => {
    const result = await extractDocumentText({
      id: 'sitrep', name: 'sitrep.txt', mediaType: 'text/plain',
      data: Buffer.from('\uFEFFReserve\0 1 IVO Kranji\n'),
    })
    expect(result).toEqual({ id: 'sitrep', name: 'sitrep.txt', text: 'Reserve 1 IVO Kranji' })
  })

  test('extracts the repository training PDF used by the doctrine workflow', async () => {
    const result = await extractDocumentText({
      id: 'training-aggressor', name: 'Training Aggressor_v8.pdf', mediaType: 'application/pdf',
      data: await readFile('../Training Aggressor_v8.pdf'),
    })
    expect(result.text).toContain('SAF Training Aggressor')
    expect(result.text).toContain('RESTRICTED')
  })

  test('extracts raw paragraphs from DOCX', async () => {
    const result = await extractDocumentText({
      id: 'orders', name: 'orders.docx',
      mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      data: await minimalDocx(),
    })
    expect(result.text).toBe('Reserve 1 IVO Kranji')
  })

  test('refuses unsupported formats before they cross the model boundary', async () => {
    await expect(extractDocumentText({
      id: 'image', name: 'map.png', mediaType: 'image/png', data: Buffer.from('not an image'),
    })).rejects.toBeInstanceOf(UnsupportedDocumentError)
    await expect(extractDocumentText({
      id: 'disguised', name: 'map.png', mediaType: 'text/plain', data: Buffer.from('instructions'),
    })).rejects.toBeInstanceOf(UnsupportedDocumentError)
  })

  test('refuses empty and oversized documents', async () => {
    await expect(extractDocumentText({
      id: 'empty', name: 'empty.md', mediaType: 'text/markdown', data: Buffer.from('  '),
    })).rejects.toBeInstanceOf(EmptyDocumentError)
    await expect(extractDocumentText({
      id: 'large', name: 'large.txt', mediaType: 'text/plain',
      data: Buffer.alloc(MAX_DOCUMENT_BYTES + 1),
    })).rejects.toBeInstanceOf(UnsupportedDocumentError)
  })
})
