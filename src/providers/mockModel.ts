import type {
  AiTask,
  FailureKind,
  ModelRequest,
  ModelResponse,
} from '../domain/types'

export class ModelTimeoutError extends Error {
  readonly blockId: string
  readonly waitedMs: number

  constructor(blockId: string, waitedMs: number) {
    super(`Model call timed out after ${waitedMs}ms`)
    this.name = 'ModelTimeoutError'
    this.blockId = blockId
    this.waitedMs = waitedMs
  }
}

const HEALTHY_RESPONSES: Record<AiTask, () => unknown> = {
  summarizeMeeting: () => ({
    summary:
      'The team agreed to ship the billing rewrite behind a feature flag and to postpone the pricing page refresh.',
    decisions: [
      'Ship billing rewrite behind a flag on Thursday',
      'Postpone pricing page refresh to next cycle',
    ],
    actionItems: [
      { task: 'Prepare the migration script', owner: 'Dana', due: '2026-09-04' },
      { task: 'Draft the rollback plan', owner: 'Mikael', due: '2026-09-05' },
    ],
  }),
  extractActionItems: () => ({
    actionItems: [
      { task: 'Prepare the migration script', owner: 'Dana', due: '2026-09-04' },
      { task: 'Draft the rollback plan', owner: 'Mikael', due: '2026-09-05' },
    ],
  }),
  answerFromEvidence: () => ({
    answer:
      'Refunds are issued to the original payment method within five business days of approval.',
    citations: ['policy-refunds-v4#section-2'],
    answered: true,
  }),
  classifyTicket: () => ({
    category: 'billing',
    priority: 'high',
    queue: 'payments-tier-2',
    confidence: 0.91,
  }),
  draftMessage: () => ({
    subject: 'About your recent invoice',
    body:
      'Hello Priya, we found a duplicate charge on invoice 88213 and have queued a refund of 240.00 EUR. It should reach your card within five business days.',
    tone: 'apologetic',
    requiresApproval: true,
  }),
  extractInvoice: () => ({
    invoiceNumber: '88213',
    total: 240.0,
    currency: 'EUR',
    issuedOn: '2026-08-14',
    lineItems: [
      { description: 'Team plan, August', amount: 240.0 },
    ],
  }),
  planResearch: () => ({
    steps: [
      'Collect the latest quarterly figures',
      'Cross-check against the public filing',
      'Summarise the delta for the newsletter',
    ],
    sources: ['webSearch', 'newsFeed'],
  }),
  synthesizeSources: () => ({
    digest:
      'Both sources agree that shipments grew by 12 percent, while only the newsletter mentions the delayed factory retooling.',
    sourcesUsed: ['webSearch', 'newsFeed'],
    conflicts: ['Factory retooling delay is unconfirmed by the primary source'],
  }),
}

const BROKEN_JSON: Record<string, string> = {
  summarizeMeeting:
    '{ "summary": "The team agreed to ship the billing rewrite", "decisions": ["Ship billing rewrite"], "actionItems": [ { "task": "Prepare the migration script", "owner": ',
  extractInvoice:
    '{ "invoiceNumber": "88213", "total": "two hundred forty", "currency": "EUR", ',
}

function missingFieldVariant(task: AiTask): unknown {
  const healthy = HEALTHY_RESPONSES[task]() as Record<string, unknown>
  if (task === 'summarizeMeeting') {
    return {
      ...healthy,
      actionItems: [
        { task: 'Prepare the migration script', due: '2026-09-04' },
        { task: 'Draft the rollback plan', due: '2026-09-05' },
      ],
    }
  }
  if (task === 'classifyTicket') {
    const { category: _ignored, ...rest } = healthy
    return rest
  }
  if (task === 'extractInvoice') {
    const { total: _ignored, ...rest } = healthy
    return rest
  }
  const keys = Object.keys(healthy)
  const clone = { ...healthy }
  delete clone[keys[0]]
  return clone
}

function lowConfidenceVariant(task: AiTask): unknown {
  const healthy = HEALTHY_RESPONSES[task]() as Record<string, unknown>
  return { ...healthy, confidence: 0.24 }
}

function schemaBreakingVariant(task: AiTask): unknown {
  const healthy = HEALTHY_RESPONSES[task]() as Record<string, unknown>
  if (task === 'classifyTicket') {
    return { ...healthy, confidence: 4.2, priority: 'volcanic' }
  }
  if (task === 'extractInvoice') {
    return { ...healthy, total: 'two hundred forty' }
  }
  return { ...healthy, unexpectedShape: true, summary: 42 }
}

function repairedVariant(task: AiTask): unknown {
  const healthy = HEALTHY_RESPONSES[task]() as Record<string, unknown>
  if (task === 'summarizeMeeting') {
    return {
      ...healthy,
      actionItems: (healthy.actionItems as Array<Record<string, unknown>>).map((item) => ({
        ...item,
        owner: item.owner ?? 'unassigned',
      })),
    }
  }
  return healthy
}

export function repairPayload(task: AiTask, broken: unknown): unknown {
  if (broken && typeof broken === 'object') {
    const record = broken as Record<string, unknown>
    const healthy = HEALTHY_RESPONSES[task]() as Record<string, unknown>
    const merged: Record<string, unknown> = { ...healthy }
    for (const [key, value] of Object.entries(record)) {
      if (value !== undefined && value !== null) merged[key] = value
    }
    if (task === 'summarizeMeeting' && Array.isArray(merged.actionItems)) {
      merged.actionItems = (merged.actionItems as Array<Record<string, unknown>>).map((item) => ({
        ...item,
        owner: typeof item.owner === 'string' && item.owner.length > 0 ? item.owner : 'unassigned',
      }))
    }
    if (task === 'classifyTicket') {
      const confidence = Number(merged.confidence)
      merged.confidence = Number.isFinite(confidence) && confidence >= 0 && confidence <= 1 ? confidence : 0.72
      const allowed = ['low', 'normal', 'high', 'urgent']
      if (!allowed.includes(String(merged.priority))) merged.priority = 'high'
      const categories = ['billing', 'account', 'technical', 'shipping']
      if (!categories.includes(String(merged.category))) merged.category = 'billing'
    }
    if (task === 'extractInvoice' && typeof merged.total !== 'number') {
      merged.total = 240.0
    }
    return merged
  }
  return repairedVariant(task)
}

function failureAppliesToAttempt(failure: FailureKind, attempt: number): boolean {
  if (failure === 'modelTimeout') return attempt <= 2
  if (failure === 'invalidJson') return attempt <= 1
  if (failure === 'schemaValidation') return true
  if (failure === 'missingField') return true
  if (failure === 'lowConfidence') return true
  return false
}

export function callMockModel(request: ModelRequest): ModelResponse {
  const { task, failures, attempt, blockId } = request

  if (failures.includes('modelTimeout') && failureAppliesToAttempt('modelTimeout', attempt)) {
    throw new ModelTimeoutError(blockId, 4000)
  }

  if (failures.includes('invalidJson') && failureAppliesToAttempt('invalidJson', attempt)) {
    const raw = BROKEN_JSON[task] ?? '{ "summary": "truncated'
    return {
      raw,
      parsed: undefined,
      confidence: 0.55,
      provider: 'mock-model/deterministic',
      usedMock: true,
    }
  }

  let parsed: unknown
  if (failures.includes('missingField')) {
    parsed = missingFieldVariant(task)
  } else if (failures.includes('schemaValidation')) {
    parsed = schemaBreakingVariant(task)
  } else if (failures.includes('lowConfidence')) {
    parsed = lowConfidenceVariant(task)
  } else {
    parsed = HEALTHY_RESPONSES[task]()
  }

  const confidence =
    parsed && typeof parsed === 'object' && 'confidence' in (parsed as Record<string, unknown>)
      ? Number((parsed as Record<string, unknown>).confidence)
      : failures.includes('lowConfidence')
        ? 0.24
        : 0.88

  return {
    raw: JSON.stringify(parsed, null, 2),
    parsed,
    confidence: Number.isFinite(confidence) ? confidence : 0.5,
    provider: 'mock-model/deterministic',
    usedMock: true,
  }
}

export function healthyResponseFor(task: AiTask): unknown {
  return HEALTHY_RESPONSES[task]()
}
