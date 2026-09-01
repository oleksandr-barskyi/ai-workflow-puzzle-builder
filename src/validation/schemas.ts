import { z } from 'zod'
import type { SchemaId, ValidationResult } from '../domain/types'

const actionItem = z.object({
  task: z.string().min(3),
  owner: z.string().min(1),
  due: z.string().min(4),
})

const meetingSummary = z.object({
  summary: z.string().min(10),
  decisions: z.array(z.string().min(3)).min(1),
  actionItems: z.array(actionItem).min(1),
})

const groundedAnswer = z.object({
  answer: z.string().min(5),
  citations: z.array(z.string().min(3)).min(1),
  answered: z.boolean(),
})

const ticketRouting = z.object({
  category: z.enum(['billing', 'account', 'technical', 'shipping']),
  priority: z.enum(['low', 'normal', 'high', 'urgent']),
  queue: z.string().min(3),
  confidence: z.number().min(0).max(1),
})

const outboundMessage = z.object({
  subject: z.string().min(3),
  body: z.string().min(20),
  tone: z.string().min(3),
})

const invoiceRecord = z.object({
  invoiceNumber: z.string().min(1),
  total: z.number().positive(),
  currency: z.string().length(3),
  issuedOn: z.string().min(8),
})

const researchDigest = z.object({
  digest: z.string().min(20),
  sourcesUsed: z.array(z.string().min(2)).min(1),
})

const SCHEMAS = {
  meetingSummary,
  groundedAnswer,
  ticketRouting,
  outboundMessage,
  invoiceRecord,
  researchDigest,
} as const

export const SCHEMA_FIELDS: Record<SchemaId, string[]> = {
  meetingSummary: ['summary', 'decisions', 'actionItems[].owner'],
  groundedAnswer: ['answer', 'citations', 'answered'],
  ticketRouting: ['category', 'priority', 'queue', 'confidence'],
  outboundMessage: ['subject', 'body', 'tone'],
  invoiceRecord: ['invoiceNumber', 'total', 'currency', 'issuedOn'],
  researchDigest: ['digest', 'sourcesUsed'],
}

export const SCHEMA_LABELS: Record<SchemaId, string> = {
  meetingSummary: 'Meeting summary',
  groundedAnswer: 'Grounded answer',
  ticketRouting: 'Ticket routing',
  outboundMessage: 'Outbound message',
  invoiceRecord: 'Invoice record',
  researchDigest: 'Research digest',
}

export function validateAgainst(schemaId: SchemaId, value: unknown): ValidationResult {
  const schema = SCHEMAS[schemaId]
  const parsed = schema.safeParse(value)
  if (parsed.success) {
    return {
      valid: true,
      schemaId,
      issues: [],
      checkedFields: SCHEMA_FIELDS[schemaId],
    }
  }
  return {
    valid: false,
    schemaId,
    issues: parsed.error.issues.map((issue) => ({
      path: issue.path.length > 0 ? issue.path.join('.') : '(root)',
      message: issue.message,
    })),
    checkedFields: SCHEMA_FIELDS[schemaId],
  }
}

export function confidenceOf(value: unknown): number | undefined {
  if (value && typeof value === 'object' && 'confidence' in (value as Record<string, unknown>)) {
    const raw = Number((value as Record<string, unknown>).confidence)
    return Number.isFinite(raw) ? raw : undefined
  }
  return undefined
}

export function hasEvidence(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  const citations = record.citations
  return Array.isArray(citations) && citations.length > 0
}
