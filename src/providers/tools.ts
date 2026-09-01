import type { FailureKind, ToolName } from '../domain/types'

export class ToolTimeoutError extends Error {
  readonly toolName: ToolName
  readonly waitedMs: number

  constructor(toolName: ToolName, waitedMs: number) {
    super(`Tool "${toolName}" timed out after ${waitedMs}ms`)
    this.name = 'ToolTimeoutError'
    this.toolName = toolName
    this.waitedMs = waitedMs
  }
}

export class ToolFailureError extends Error {
  readonly toolName: ToolName

  constructor(toolName: ToolName, reason: string) {
    super(`Tool "${toolName}" failed: ${reason}`)
    this.name = 'ToolFailureError'
    this.toolName = toolName
  }
}

interface ToolCall {
  toolName: ToolName
  query: string
  attempt: number
  failures: FailureKind[]
}

const UNSTABLE_TOOLS: ToolName[] = ['newsFeed', 'crmLookup']

const TOOL_RESULTS: Record<ToolName, unknown> = {
  calendarLookup: {
    attendees: ['Dana', 'Mikael', 'Priya'],
    meeting: 'Billing rewrite sync',
    startedAt: '2026-09-01T09:00:00Z',
  },
  ticketDirectory: {
    categories: ['billing', 'account', 'technical', 'shipping'],
    queues: {
      billing: 'payments-tier-2',
      account: 'identity-tier-1',
      technical: 'platform-tier-2',
      shipping: 'logistics-tier-1',
    },
  },
  webSearch: {
    results: [
      {
        title: 'Quarterly shipments up 12 percent',
        snippet: 'Shipments rose 12 percent year over year across all regions.',
        url: 'https://example.org/quarterly',
      },
    ],
  },
  newsFeed: {
    results: [
      {
        title: 'Factory retooling pushed to next quarter',
        snippet: 'Sources say the retooling programme slipped by one quarter.',
        url: 'https://example.org/retooling',
      },
    ],
  },
  mailer: { queued: true, messageId: 'msg-77120' },
  crmLookup: {
    customer: 'Priya Raman',
    plan: 'Team',
    openInvoices: ['88213'],
  },
}

const RETRIEVAL_DOCUMENTS = [
  {
    id: 'policy-refunds-v4#section-2',
    title: 'Refund policy, section 2',
    text: 'Approved refunds are returned to the original payment method within five business days.',
  },
  {
    id: 'policy-shipping-v2#section-1',
    title: 'Shipping policy, section 1',
    text: 'Standard delivery takes three to five business days inside the EU.',
  },
]

export function callTool(call: ToolCall): unknown {
  const { toolName, failures, attempt } = call

  if (failures.includes('toolTimeout') && attempt <= 2) {
    throw new ToolTimeoutError(toolName, 5000)
  }
  if (failures.includes('toolFailure') && attempt <= 1 && UNSTABLE_TOOLS.includes(toolName)) {
    throw new ToolFailureError(toolName, 'upstream returned 503')
  }
  return TOOL_RESULTS[toolName]
}

export function retrieve(query: string, failures: FailureKind[]): { documents: typeof RETRIEVAL_DOCUMENTS; query: string } {
  if (failures.includes('emptyRetrieval')) {
    return { documents: [], query }
  }
  const normalised = query.toLowerCase()
  const matched = RETRIEVAL_DOCUMENTS.filter((doc) =>
    normalised.split(/\s+/).some((word) => word.length > 3 && doc.text.toLowerCase().includes(word)),
  )
  return { documents: matched.length > 0 ? matched : RETRIEVAL_DOCUMENTS.slice(0, 1), query }
}

export function fallbackToolFor(toolName: ToolName): ToolName {
  if (toolName === 'webSearch') return 'newsFeed'
  if (toolName === 'newsFeed') return 'webSearch'
  if (toolName === 'crmLookup') return 'ticketDirectory'
  return 'ticketDirectory'
}
