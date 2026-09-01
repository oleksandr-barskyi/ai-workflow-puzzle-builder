import type { Puzzle, WorkflowBlock } from '../domain/types'

let blockCounter = 0

function block(
  kind: WorkflowBlock['kind'],
  title: string,
  hint: string,
  config: WorkflowBlock['config'] = {},
  removable = true,
): WorkflowBlock {
  blockCounter += 1
  return { id: `b${blockCounter}`, kind, title, hint, config, removable }
}

function paletteFor(kinds: Array<[WorkflowBlock['kind'], string, string, WorkflowBlock['config']]>): WorkflowBlock[] {
  return kinds.map(([kind, title, hint, config]) => block(kind, title, hint, config))
}

const RETRY_HINT = 'Repeats the step before it, up to the configured number of attempts.'
const VALIDATOR_HINT = 'Checks the previous result against a schema and rejects it if the shape is wrong.'
const FALLBACK_HINT = 'Runs a backup path when the step before it has used up its attempts.'
const HUMAN_HINT = 'Pauses the workflow and waits for a person to approve, edit, or reject.'
const SAFE_STOP_HINT = 'Ends the workflow on purpose instead of passing an untrusted result on.'

export const PUZZLES: Puzzle[] = [
  {
    id: 'meeting-summarizer',
    title: 'Fix the Meeting Summarizer',
    tagline: 'Stop invalid data',
    difficulty: 'beginner',
    objective:
      'Turn raw meeting notes into a summary with decisions and action items, and make sure every action item has an owner.',
    story:
      'The summarizer looks fine until you read the action items: the model keeps dropping the owner field. Nobody notices until a task has no one attached to it.',
    sampleInput: {
      meeting: 'Billing rewrite sync',
      notes:
        'Dana will prepare the migration script by Friday. Mikael takes the rollback plan. We agreed to ship behind a feature flag on Thursday and to postpone the pricing page refresh.',
    },
    expectedOutput: 'A meetingSummary object where every action item carries task, owner, and due.',
    schemaId: 'meetingSummary',
    requiresHumanReview: false,
    requiresValidation: true,
    failureScenarios: [
      {
        kind: 'missingField',
        label: 'Model drops the owner field',
        description: 'The model returns action items without an owner, every single time.',
        hint: 'Retrying will not help here, because the model fails the same way each attempt. Repair the output instead.',
      },
    ],
    completionCriteria: [
      { id: 'runCompletes', label: 'The workflow finishes', detail: 'Execution reaches the output block.' },
      { id: 'outputValid', label: 'The result is valid', detail: 'The final object passes the meetingSummary schema.' },
      { id: 'failureHandled', label: 'The failure is handled', detail: 'The missing owner is caught and fixed.' },
    ],
    solutionHint:
      'Add a Validator (meetingSummary) right after the AI step so the missing owner is detected, then add a Fallback set to "repair output".',
    starterWorkflow: {
      blocks: [
        block('input', 'Meeting notes', 'The committed sample input for this puzzle.', {}, false),
        block('ai', 'Summarize the meeting', 'Asks the model for a summary, decisions, and action items.', {
          task: 'summarizeMeeting',
          prompt: 'Summarise the notes into summary, decisions, and action items with owners.',
        }, false),
        block('output', 'Final summary', 'Whatever arrives here is treated as the answer.', {}, false),
      ],
    },
    availableBlocks: paletteFor([
      ['validator', 'Validator', VALIDATOR_HINT, { schemaId: 'meetingSummary' }],
      ['retry', 'Retry', RETRY_HINT, { maxAttempts: 3 }],
      ['fallback', 'Fallback: repair output', FALLBACK_HINT, { onFailure: 'repairOutput' }],
      ['humanReview', 'Human review', HUMAN_HINT, {}],
      ['safeStop', 'Safe stop', SAFE_STOP_HINT, {}],
    ]),
  },

  {
    id: 'knowledge-assistant',
    title: 'Ground the Knowledge Assistant',
    tagline: 'Refuse to guess',
    difficulty: 'beginner',
    objective:
      'Answer a policy question using retrieved evidence, and refuse to answer at all when the retrieval comes back empty.',
    story:
      'A confident assistant with no sources is worse than no assistant. When the knowledge base returns nothing, the workflow must stop instead of inventing a policy.',
    sampleInput: { question: 'How long does a refund take once it is approved?' },
    expectedOutput: 'A groundedAnswer object with citations, or a deliberate safe stop when there is no evidence.',
    schemaId: 'groundedAnswer',
    requiresHumanReview: false,
    requiresValidation: true,
    failureScenarios: [
      {
        kind: 'emptyRetrieval',
        label: 'The knowledge base returns nothing',
        description: 'Retrieval finds zero documents, so there is no evidence to ground an answer on.',
        hint: 'There is nothing to retry here. The correct behaviour is to stop safely.',
      },
    ],
    completionCriteria: [
      { id: 'failureHandled', label: 'The empty result is handled', detail: 'The workflow reacts to the empty retrieval.' },
      { id: 'safeStopUsed', label: 'The workflow stops safely', detail: 'No answer is invented without evidence.' },
      { id: 'noUnhandledError', label: 'Nothing crashes', detail: 'No step fails without a recovery path.' },
    ],
    solutionHint:
      'Put a Safe stop right after the retrieval step. Stopping on purpose scores better than answering without sources.',
    starterWorkflow: {
      blocks: [
        block('input', 'Customer question', 'The committed sample input for this puzzle.', {}, false),
        block('retrieval', 'Search the policy base', 'Looks for supporting documents.', {
          query: 'refund approved payment method business days',
        }, false),
        block('transform', 'Attach evidence ids', 'Carries the document ids alongside the text.', {
          transform: 'attachEvidence',
        }),
        block('ai', 'Answer from evidence', 'Answers strictly from the retrieved documents.', {
          task: 'answerFromEvidence',
          prompt: 'Answer only from the retrieved documents and cite them.',
        }, false),
        block('output', 'Answer', 'Whatever arrives here is shown to the customer.', {}, false),
      ],
    },
    availableBlocks: paletteFor([
      ['safeStop', 'Safe stop', SAFE_STOP_HINT, {}],
      ['validator', 'Validator', VALIDATOR_HINT, { schemaId: 'groundedAnswer' }],
      ['retry', 'Retry', RETRY_HINT, { maxAttempts: 2 }],
      ['humanReview', 'Human review', HUMAN_HINT, {}],
    ]),
  },

  {
    id: 'ticket-router',
    title: 'Repair the Ticket Router',
    tagline: 'Repair the broken workflow',
    difficulty: 'intermediate',
    objective:
      'Classify a support ticket into a category and queue, and recover when the model returns an impossible priority or a confidence above one.',
    story:
      'The router keeps sending tickets to a queue called "volcanic" with a confidence of 4.2. The values are nonsense, but nothing in the workflow notices.',
    sampleInput: {
      ticket: 'I was charged twice for invoice 88213 and I want the duplicate refunded.',
      customer: 'Priya Raman',
    },
    expectedOutput: 'A ticketRouting object with an allowed category, an allowed priority, and confidence between 0 and 1.',
    schemaId: 'ticketRouting',
    requiresHumanReview: false,
    requiresValidation: true,
    failureScenarios: [
      {
        kind: 'schemaValidation',
        label: 'Impossible priority and confidence',
        description: 'The model returns priority "volcanic" and confidence 4.2 on the first two attempts.',
        hint: 'A retry alone gets there eventually, but a validator plus repair is faster and more honest.',
      },
    ],
    completionCriteria: [
      { id: 'runCompletes', label: 'The workflow finishes', detail: 'Execution reaches the output block.' },
      { id: 'outputValid', label: 'The routing is valid', detail: 'The result passes the ticketRouting schema.' },
      { id: 'retryUsed', label: 'A retry is attempted', detail: 'The workflow retries before giving up.' },
      { id: 'failureHandled', label: 'The bad shape is handled', detail: 'The invalid values never reach the queue.' },
    ],
    solutionHint:
      'Order matters: AI step, then Validator (ticketRouting), then Retry with three attempts, then a Fallback that repairs the output.',
    starterWorkflow: {
      blocks: [
        block('input', 'Support ticket', 'The committed sample input for this puzzle.', {}, false),
        block('tool', 'Look up the queue directory', 'Fetches allowed categories and queues.', {
          toolName: 'ticketDirectory',
        }),
        block('ai', 'Classify the ticket', 'Chooses a category, priority, and queue.', {
          task: 'classifyTicket',
          prompt: 'Classify the ticket and return category, priority, queue, and confidence.',
        }, false),
        block('output', 'Routing decision', 'Whatever arrives here is sent to the queue.', {}, false),
      ],
    },
    availableBlocks: paletteFor([
      ['validator', 'Validator', VALIDATOR_HINT, { schemaId: 'ticketRouting' }],
      ['retry', 'Retry', RETRY_HINT, { maxAttempts: 3 }],
      ['fallback', 'Fallback: repair output', FALLBACK_HINT, { onFailure: 'repairOutput' }],
      ['humanReview', 'Human review', HUMAN_HINT, {}],
      ['safeStop', 'Safe stop', SAFE_STOP_HINT, {}],
    ]),
  },

  {
    id: 'research-timeout',
    title: 'Survive the Research Timeout',
    tagline: 'Survive the timeout',
    difficulty: 'intermediate',
    objective:
      'Combine two sources into a digest while the primary search tool times out on the first two attempts.',
    story:
      'The primary search tool is having a bad day. It answers on the third attempt, and there is a second source sitting right there unused.',
    sampleInput: { topic: 'quarterly shipment growth and factory retooling' },
    expectedOutput: 'A researchDigest object naming the sources that actually answered.',
    schemaId: 'researchDigest',
    requiresHumanReview: false,
    requiresValidation: false,
    failureScenarios: [
      {
        kind: 'toolTimeout',
        label: 'The search tool times out',
        description: 'The primary tool times out on attempts one and two, then recovers.',
        hint: 'Three retries are enough on their own. A fallback tool gets there sooner.',
      },
    ],
    completionCriteria: [
      { id: 'runCompletes', label: 'The workflow finishes', detail: 'Execution reaches the output block.' },
      { id: 'failureHandled', label: 'The timeout is handled', detail: 'The timeout does not end the run.' },
      { id: 'retryUsed', label: 'A retry is attempted', detail: 'The workflow retries the timing-out tool.' },
    ],
    solutionHint:
      'Add a Retry with three attempts after the search tool. If you would rather not wait, add a Fallback tool instead and let the backup source answer.',
    starterWorkflow: {
      blocks: [
        block('input', 'Research topic', 'The committed sample input for this puzzle.', {}, false),
        block('tool', 'Primary web search', 'Queries the primary source.', { toolName: 'webSearch' }, false),
        block('ai', 'Synthesize the sources', 'Merges what the sources returned into a digest.', {
          task: 'synthesizeSources',
          prompt: 'Merge the sources into a digest and name any conflicts.',
        }, false),
        block('output', 'Research digest', 'Whatever arrives here goes into the newsletter.', {}, false),
      ],
    },
    availableBlocks: paletteFor([
      ['retry', 'Retry', RETRY_HINT, { maxAttempts: 3 }],
      ['fallback', 'Fallback: backup tool', FALLBACK_HINT, { onFailure: 'fallbackTool', fallbackToolName: 'newsFeed' }],
      ['validator', 'Validator', VALIDATOR_HINT, { schemaId: 'researchDigest' }],
      ['safeStop', 'Safe stop', SAFE_STOP_HINT, {}],
    ]),
  },

  {
    id: 'approve-before-sending',
    title: 'Approve Before Sending',
    tagline: 'Ask a human before continuing',
    difficulty: 'intermediate',
    objective:
      'Draft an apology message about a duplicate charge, but never let it reach the customer without a human decision.',
    story:
      'The draft is good. It is also a message about money, going to a real customer, written by a model. Somebody has to say yes first.',
    sampleInput: {
      customer: 'Priya Raman',
      issue: 'duplicate charge on invoice 88213 for 240.00 EUR',
    },
    expectedOutput: 'An outboundMessage object that a person has approved, edited, or rejected on the record.',
    schemaId: 'outboundMessage',
    requiresHumanReview: true,
    requiresValidation: true,
    failureScenarios: [
      {
        kind: 'lowConfidence',
        label: 'The model is unsure',
        description: 'The draft comes back with a confidence of 0.24, well below any sensible threshold.',
        hint: 'Low confidence is exactly when a human should look at it. The decision goes into the trace either way.',
      },
    ],
    completionCriteria: [
      { id: 'humanDecisionRecorded', label: 'A human decided', detail: 'Approve, edit, or reject is recorded in the trace.' },
      { id: 'noUnhandledError', label: 'Nothing crashes', detail: 'No step fails without a recovery path.' },
    ],
    solutionHint:
      'Place a Human review block between the draft and the mailer. Rejecting is a valid solution: the workflow stops safely and the decision is recorded.',
    starterWorkflow: {
      blocks: [
        block('input', 'Customer and issue', 'The committed sample input for this puzzle.', {}, false),
        block('tool', 'Look up the customer', 'Fetches the plan and open invoices.', { toolName: 'crmLookup' }),
        block('ai', 'Draft the message', 'Writes the outbound message.', {
          task: 'draftMessage',
          prompt: 'Draft a short apology with the refund amount and the expected timeline.',
        }, false),
        block('tool', 'Send the message', 'Hands the message to the mailer.', { toolName: 'mailer' }, false),
        block('output', 'Sent message', 'Whatever arrives here has been sent.', {}, false),
      ],
    },
    availableBlocks: paletteFor([
      ['humanReview', 'Human review', HUMAN_HINT, {}],
      ['validator', 'Validator', VALIDATOR_HINT, { schemaId: 'outboundMessage', confidenceThreshold: 0.6 }],
      ['retry', 'Retry', RETRY_HINT, { maxAttempts: 2 }],
      ['safeStop', 'Safe stop', SAFE_STOP_HINT, {}],
    ]),
  },

  {
    id: 'activate-the-fallback',
    title: 'Activate the Fallback',
    tagline: 'Add a safe fallback',
    difficulty: 'advanced',
    objective:
      'Extract a structured invoice record while the primary model times out twice and then returns a total written in words.',
    story:
      'Two failures stacked on top of each other: first the model does not answer at all, then it answers with "two hundred forty" where a number belongs. One recovery strategy is not enough.',
    sampleInput: {
      document:
        'INVOICE 88213. Issued 2026-08-14. Team plan, August. Amount due: 240.00 EUR. Payable within 14 days.',
    },
    expectedOutput: 'An invoiceRecord object where total is a real number and currency is a three-letter code.',
    schemaId: 'invoiceRecord',
    requiresHumanReview: false,
    requiresValidation: true,
    failureScenarios: [
      {
        kind: 'modelTimeout',
        label: 'The model times out twice',
        description: 'Attempts one and two never come back.',
        hint: 'You need at least three attempts to get past this one.',
      },
      {
        kind: 'schemaValidation',
        label: 'The total arrives as words',
        description: 'Once the model answers, it writes the total as text instead of a number.',
        hint: 'A retry will not fix a model that is confidently wrong. Repair the output.',
      },
    ],
    completionCriteria: [
      { id: 'runCompletes', label: 'The workflow finishes', detail: 'Execution reaches the output block.' },
      { id: 'outputValid', label: 'The record is valid', detail: 'The result passes the invoiceRecord schema.' },
      { id: 'retryUsed', label: 'A retry is attempted', detail: 'The timeouts are absorbed by retries.' },
      { id: 'fallbackUsed', label: 'A fallback runs', detail: 'A backup path handles what retries cannot.' },
      { id: 'noUnhandledError', label: 'Nothing crashes', detail: 'No step fails without a recovery path.' },
    ],
    solutionHint:
      'Turn both failures on. Use Retry with three attempts to survive the timeouts, a Validator to catch the text total, and a Fallback that repairs the output.',
    starterWorkflow: {
      blocks: [
        block('input', 'Invoice document', 'The committed sample input for this puzzle.', {}, false),
        block('ai', 'Extract the invoice', 'Pulls the structured record out of the text.', {
          task: 'extractInvoice',
          prompt: 'Extract invoiceNumber, total as a number, currency, and issuedOn.',
        }, false),
        block('output', 'Invoice record', 'Whatever arrives here goes into the ledger.', {}, false),
      ],
    },
    availableBlocks: paletteFor([
      ['retry', 'Retry', RETRY_HINT, { maxAttempts: 3 }],
      ['validator', 'Validator', VALIDATOR_HINT, { schemaId: 'invoiceRecord' }],
      ['fallback', 'Fallback: repair output', FALLBACK_HINT, { onFailure: 'repairOutput' }],
      ['humanReview', 'Human review', HUMAN_HINT, {}],
      ['safeStop', 'Safe stop', SAFE_STOP_HINT, {}],
    ]),
  },

  {
    id: 'malformed-json',
    title: 'Catch the Half-Written Answer',
    tagline: 'Recover from a truncated reply',
    difficulty: 'beginner',
    objective:
      'Extract a structured invoice when the model cuts its answer off mid-sentence on the first attempt.',
    story:
      'The model starts writing JSON, then stops in the middle of a word. There is no field to validate, because there is no object at all, only a broken string.',
    sampleInput: {
      document:
        'INVOICE 88213. Issued 2026-08-14. Team plan, August. Amount due: 240.00 EUR. Payable within 14 days.',
    },
    expectedOutput: 'An invoiceRecord object, produced after the truncated first answer is discarded.',
    schemaId: 'invoiceRecord',
    requiresHumanReview: false,
    requiresValidation: false,
    failureScenarios: [
      {
        kind: 'invalidJson',
        label: 'The reply is cut off',
        description: 'Attempt one returns a truncated string that cannot be parsed. Attempt two is fine.',
        hint: 'This one is genuinely transient, so a single extra attempt is all it takes.',
      },
    ],
    completionCriteria: [
      { id: 'runCompletes', label: 'The workflow finishes', detail: 'Execution reaches the output block.' },
      { id: 'retryUsed', label: 'A retry is attempted', detail: 'The broken answer is thrown away and asked again.' },
      { id: 'failureHandled', label: 'The failure is handled', detail: 'The truncated reply never reaches the ledger.' },
      { id: 'noUnhandledError', label: 'Nothing crashes', detail: 'No step fails without a recovery path.' },
    ],
    solutionHint:
      'Add a Retry after the extraction step. Two attempts are enough, because the truncation only happens on the first one.',
    starterWorkflow: {
      blocks: [
        block('input', 'Invoice document', 'The committed sample input for this puzzle.', {}, false),
        block('ai', 'Extract the invoice', 'Pulls the structured record out of the text.', {
          task: 'extractInvoice',
          prompt: 'Extract invoiceNumber, total as a number, currency, and issuedOn.',
        }, false),
        block('output', 'Invoice record', 'Whatever arrives here goes into the ledger.', {}, false),
      ],
    },
    availableBlocks: paletteFor([
      ['retry', 'Retry', RETRY_HINT, { maxAttempts: 2 }],
      ['validator', 'Validator', VALIDATOR_HINT, { schemaId: 'invoiceRecord' }],
      ['fallback', 'Fallback: backup model', FALLBACK_HINT, { onFailure: 'fallbackModel' }],
      ['safeStop', 'Safe stop', SAFE_STOP_HINT, {}],
    ]),
  },

  {
    id: 'resume-the-mission',
    title: 'Resume the Interrupted Mission',
    tagline: 'Recover from the last successful step',
    difficulty: 'advanced',
    objective:
      'A long research workflow is interrupted partway through. Continue it from the last successful step instead of starting over.',
    story:
      'Three steps went fine and then the second source went down. Re-running the whole thing would throw away work that already succeeded, and the trace already knows where you got to.',
    sampleInput: { topic: 'quarterly shipment growth and factory retooling' },
    expectedOutput: 'A research digest, reached by continuing the run rather than restarting it.',
    requiresHumanReview: false,
    requiresValidation: false,
    failureScenarios: [
      {
        kind: 'toolFailure',
        label: 'The second source goes down',
        description: 'The news feed returns 503 on the first attempt of the run.',
        hint: 'Run it once and let it fail, then press "Resume from last good step" above the trace. The earlier steps are kept.',
      },
    ],
    completionCriteria: [
      { id: 'resumedFromCheckpoint', label: 'The run is resumed', detail: 'Work continues from the last successful step.' },
      { id: 'runCompletes', label: 'The workflow finishes', detail: 'Execution reaches the output block.' },
    ],
    solutionHint:
      'Run the workflow as it is. When it fails, the Resume button appears above the execution trace. Adding a Retry also works, but then you are solving a different puzzle: this one is about not repeating work you already paid for.',
    starterWorkflow: {
      blocks: [
        block('input', 'Research topic', 'The committed sample input for this puzzle.', {}, false),
        block('tool', 'Primary web search', 'Queries the primary source.', { toolName: 'webSearch' }, false),
        block('ai', 'Plan the research', 'Decides which sources are worth reading.', {
          task: 'planResearch',
          prompt: 'Plan the steps and name the sources to consult.',
        }, false),
        block('tool', 'Secondary news feed', 'Queries the second source. This is the one that goes down.', {
          toolName: 'newsFeed',
        }, false),
        block('ai', 'Synthesize the sources', 'Merges what the sources returned into a digest.', {
          task: 'synthesizeSources',
          prompt: 'Merge the sources into a digest and name any conflicts.',
        }, false),
        block('output', 'Research digest', 'Whatever arrives here goes into the newsletter.', {}, false),
      ],
    },
    availableBlocks: paletteFor([
      ['retry', 'Retry', RETRY_HINT, { maxAttempts: 2 }],
      ['fallback', 'Fallback: backup tool', FALLBACK_HINT, { onFailure: 'fallbackTool', fallbackToolName: 'webSearch' }],
      ['safeStop', 'Safe stop', SAFE_STOP_HINT, {}],
      ['humanReview', 'Human review', HUMAN_HINT, {}],
    ]),
  },
]

export function cloneBlock(source: WorkflowBlock): WorkflowBlock {
  blockCounter += 1
  return {
    ...source,
    id: `b${blockCounter}`,
    config: { ...source.config },
  }
}

export function findPuzzle(id: string): Puzzle {
  const puzzle = PUZZLES.find((item) => item.id === id)
  if (!puzzle) throw new Error(`Unknown puzzle: ${id}`)
  return puzzle
}
