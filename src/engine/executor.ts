import type {
  BlockKind,
  FailureKind,
  HumanDecision,
  RecoveryAction,
  RunContext,
  RunResult,
  RunStatus,
  StepError,
  TraceEntry,
  ValidationResult,
  Workflow,
  WorkflowBlock,
} from '../domain/types'
import { ModelTimeoutError, callMockModel, repairPayload } from '../providers/mockModel'
import { ToolFailureError, ToolTimeoutError, callTool, fallbackToolFor, retrieve } from '../providers/tools'
import { confidenceOf, validateAgainst } from '../validation/schemas'
import { buildReliabilityReport } from './reliability'

const EXECUTABLE_KINDS: BlockKind[] = [
  'input',
  'ai',
  'tool',
  'retrieval',
  'condition',
  'transform',
  'output',
]

const MODIFIER_KINDS: BlockKind[] = ['retry', 'fallback', 'validator', 'safeStop']

const STEP_DURATION: Record<BlockKind, number> = {
  input: 12,
  ai: 640,
  tool: 220,
  retrieval: 180,
  condition: 8,
  transform: 14,
  validator: 22,
  retry: 0,
  fallback: 0,
  humanReview: 0,
  safeStop: 0,
  output: 10,
}

interface StepPolicies {
  maxAttempts: number
  retryBlock?: WorkflowBlock
  validatorBlock?: WorkflowBlock
  fallbackBlock?: WorkflowBlock
  safeStopBlock?: WorkflowBlock
  humanReviewBlock?: WorkflowBlock
}

interface StepOutcome {
  status: 'ok' | 'stopped' | 'failed' | 'awaitingHuman'
  value?: unknown
  pendingBlock?: WorkflowBlock
}

function isExecutable(block: WorkflowBlock): boolean {
  return EXECUTABLE_KINDS.includes(block.kind)
}

function collectPolicies(blocks: WorkflowBlock[], startIndex: number): { policies: StepPolicies; nextIndex: number } {
  const policies: StepPolicies = { maxAttempts: 1 }
  let index = startIndex
  while (index < blocks.length) {
    const block = blocks[index]
    if (MODIFIER_KINDS.includes(block.kind)) {
      if (block.kind === 'retry') {
        policies.retryBlock = block
        policies.maxAttempts = Math.max(1, block.config.maxAttempts ?? 2)
      }
      if (block.kind === 'validator') policies.validatorBlock = block
      if (block.kind === 'fallback') policies.fallbackBlock = block
      if (block.kind === 'safeStop') policies.safeStopBlock = block
      index += 1
      continue
    }
    if (block.kind === 'humanReview') {
      policies.humanReviewBlock = block
    }
    break
  }
  return { policies, nextIndex: index }
}

function toStepError(error: unknown): StepError {
  if (error instanceof ModelTimeoutError) {
    return {
      kind: 'modelTimeout',
      message: 'The AI model did not answer in time',
      detail: error.message,
    }
  }
  if (error instanceof ToolTimeoutError) {
    return {
      kind: 'toolTimeout',
      message: `The tool "${error.toolName}" did not answer in time`,
      detail: error.message,
    }
  }
  if (error instanceof ToolFailureError) {
    return {
      kind: 'toolFailure',
      message: 'The tool returned an error',
      detail: error.message,
    }
  }
  return {
    kind: 'unhandled',
    message: error instanceof Error ? error.message : 'Unknown failure',
  }
}

async function runExecutable(
  block: WorkflowBlock,
  input: unknown,
  attempt: number,
  failures: FailureKind[],
  liveProvider?: RunContext['liveProvider'],
  overrides?: { task?: WorkflowBlock['config']['task']; toolName?: WorkflowBlock['config']['toolName'] },
): Promise<{ value: unknown; usedMock: boolean; note?: string }> {
  switch (block.kind) {
    case 'input':
      return { value: input, usedMock: false, note: 'Committed sample input' }

    case 'ai': {
      const task = overrides?.task ?? block.config.task
      if (!task) throw new Error('AI block has no task configured')
      const request = {
        task,
        prompt: block.config.prompt ?? '',
        input,
        attempt,
        blockId: block.id,
        failures,
      }
      const response = liveProvider ? await liveProvider.complete(request) : callMockModel(request)
      if (response.parsed === undefined) {
        const error: StepError = {
          kind: 'invalidJson',
          message: 'The model returned text that is not valid JSON',
          detail: response.raw.slice(0, 160),
        }
        const thrown = new Error(error.message) as Error & { stepError?: StepError }
        thrown.stepError = error
        throw thrown
      }
      return {
        value: response.parsed,
        usedMock: response.usedMock,
        note: `${response.provider}, confidence ${response.confidence.toFixed(2)}`,
      }
    }

    case 'tool': {
      const toolName = overrides?.toolName ?? block.config.toolName
      if (!toolName) throw new Error('Tool block has no tool configured')
      const value = callTool({
        toolName,
        query: block.config.query ?? '',
        attempt,
        failures,
      })
      return { value: { tool: toolName, result: value, input }, usedMock: true, note: `Simulated tool ${toolName}` }
    }

    case 'retrieval': {
      const result = retrieve(block.config.query ?? String(input ?? ''), failures)
      if (result.documents.length === 0) {
        const thrown = new Error('Retrieval returned no documents') as Error & { stepError?: StepError }
        thrown.stepError = {
          kind: 'emptyRetrieval',
          message: 'Retrieval returned no supporting documents',
          detail: `query: ${result.query}`,
        }
        throw thrown
      }
      return { value: { ...result, input }, usedMock: true, note: `${result.documents.length} document(s) retrieved` }
    }

    case 'condition': {
      const field = block.config.conditionField ?? 'answered'
      const record = (input ?? {}) as Record<string, unknown>
      const actual = record[field]
      const matches = actual === (block.config.conditionEquals ?? true)
      return {
        value: input,
        usedMock: false,
        note: matches ? `Condition met: ${field}` : `Condition not met: ${field}`,
      }
    }

    case 'transform': {
      const record = (input ?? {}) as Record<string, unknown>
      if (block.config.transform === 'pickFields' && block.config.transformFields) {
        const picked: Record<string, unknown> = {}
        for (const key of block.config.transformFields) {
          if (key in record) picked[key] = record[key]
        }
        return { value: picked, usedMock: false, note: 'Selected fields' }
      }
      if (block.config.transform === 'attachEvidence') {
        const documents = (record.documents ?? []) as Array<{ id: string; text: string }>
        return {
          value: { ...record, evidence: documents.map((doc) => doc.id) },
          usedMock: false,
          note: 'Attached evidence ids',
        }
      }
      return { value: input, usedMock: false, note: 'Passed through' }
    }

    case 'output':
      return { value: input, usedMock: false, note: 'Final result' }

    default:
      return { value: input, usedMock: false }
  }
}

function validateStep(
  validatorBlock: WorkflowBlock | undefined,
  value: unknown,
): ValidationResult | undefined {
  if (!validatorBlock) return undefined
  const schemaId = validatorBlock.config.schemaId
  if (!schemaId) return undefined
  const base = validateAgainst(schemaId, value)
  const threshold = validatorBlock.config.confidenceThreshold
  if (base.valid && typeof threshold === 'number') {
    const confidence = confidenceOf(value)
    if (typeof confidence === 'number' && confidence < threshold) {
      return {
        valid: false,
        schemaId,
        checkedFields: [...base.checkedFields, 'confidence'],
        issues: [
          {
            path: 'confidence',
            message: `confidence ${confidence.toFixed(2)} is below the required ${threshold.toFixed(2)}`,
          },
        ],
      }
    }
  }
  return base
}

function findDecision(decisions: HumanDecision[], blockId: string): HumanDecision | undefined {
  return decisions.find((decision) => decision.blockId === blockId)
}

export async function runWorkflow(workflow: Workflow, context: RunContext): Promise<RunResult> {
  const trace: TraceEntry[] = context.completedBeforeResume ? [...context.completedBeforeResume] : []
  const failures = context.activeFailures
  let carried: unknown = context.input
  let status: RunStatus = 'completed'
  let pendingReview: RunResult['pendingReview']
  let checkpointBlockId: string | undefined
  let traceCounter = trace.length

  const blocks = workflow.blocks
  let index = 0

  if (context.resumeFromBlockId) {
    const resumeIndex = blocks.findIndex((block) => block.id === context.resumeFromBlockId)
    if (resumeIndex >= 0) {
      index = resumeIndex
      const lastCompleted = [...trace].reverse().find((entry) => entry.status === 'completed')
      if (lastCompleted) carried = lastCompleted.output
    }
  }

  const push = (entry: Omit<TraceEntry, 'id'>): TraceEntry => {
    traceCounter += 1
    const withId: TraceEntry = { ...entry, id: `t${traceCounter}` }
    trace.push(withId)
    return withId
  }

  while (index < blocks.length) {
    const block = blocks[index]

    if (!isExecutable(block)) {
      if (block.kind === 'humanReview') {
        const decision = findDecision(context.humanDecisions, block.id)
        if (!decision) {
          push({
            blockId: block.id,
            blockKind: block.kind,
            title: block.title,
            status: 'paused',
            attempt: 1,
            attemptsUsed: 1,
            input: carried,
            output: undefined,
            note: 'Waiting for a human decision',
            usedMock: false,
            durationMs: 0,
          })
          pendingReview = {
            blockId: block.id,
            title: block.title,
            payload: carried,
            question: 'Approve this result, edit it, or reject the workflow?',
          }
          status = 'awaitingHuman'
          break
        }
        if (decision.kind === 'reject') {
          push({
            blockId: block.id,
            blockKind: block.kind,
            title: block.title,
            status: 'safelyStopped',
            attempt: 1,
            attemptsUsed: 1,
            input: carried,
            output: undefined,
            error: {
              kind: 'humanRejection',
              message: 'A human rejected the result',
              detail: decision.comment,
            },
            recovery: {
              kind: 'safeStop',
              description: 'Workflow stopped safely after human rejection',
              attempt: 1,
              succeeded: true,
            },
            note: decision.comment,
            usedMock: false,
            durationMs: 0,
          })
          status = 'safelyStopped'
          break
        }
        const approvedValue = decision.kind === 'edit' ? decision.editedOutput : carried
        push({
          blockId: block.id,
          blockKind: block.kind,
          title: block.title,
          status: 'completed',
          attempt: 1,
          attemptsUsed: 1,
          input: carried,
          output: approvedValue,
          note:
            decision.kind === 'edit'
              ? `Human edited the result${decision.comment ? `: ${decision.comment}` : ''}`
              : `Human approved the result${decision.comment ? `: ${decision.comment}` : ''}`,
          usedMock: false,
          durationMs: 0,
        })
        carried = approvedValue
        checkpointBlockId = block.id
        index += 1
        continue
      }
      index += 1
      continue
    }

    const { policies, nextIndex } = collectPolicies(blocks, index + 1)
    const outcome = await executeStep(block, policies, carried, failures, context, push, trace)

    if (outcome.status === 'failed') {
      status = 'failed'
      break
    }
    if (outcome.status === 'stopped') {
      status = 'safelyStopped'
      break
    }
    if (outcome.status === 'awaitingHuman' && outcome.pendingBlock) {
      pendingReview = {
        blockId: outcome.pendingBlock.id,
        title: outcome.pendingBlock.title,
        payload: outcome.value,
        question: 'The automatic checks could not clear this result. Approve, edit, or reject?',
      }
      status = 'awaitingHuman'
      break
    }

    carried = outcome.value
    checkpointBlockId = block.id
    index = nextIndex
  }

  const reliability = buildReliabilityReport(trace, status)

  return {
    status,
    trace,
    finalOutput: status === 'completed' ? carried : undefined,
    pendingReview,
    reliability,
    checkpointBlockId,
  }
}

async function executeStep(
  block: WorkflowBlock,
  policies: StepPolicies,
  input: unknown,
  failures: FailureKind[],
  context: RunContext,
  push: (entry: Omit<TraceEntry, 'id'>) => TraceEntry,
  trace: TraceEntry[],
): Promise<StepOutcome> {
  const maxAttempts = policies.maxAttempts
  let lastError: StepError | undefined
  let lastValidation: ValidationResult | undefined
  let lastValue: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const isLastAttempt = attempt === maxAttempts
    try {
      const executed = await runExecutable(block, input, attempt, failures, context.liveProvider)
      lastValue = executed.value
      const validation = validateStep(policies.validatorBlock, executed.value)
      lastValidation = validation

      if (!validation || validation.valid) {
        push({
          blockId: block.id,
          blockKind: block.kind,
          title: block.title,
          status: attempt > 1 ? 'recovered' : 'completed',
          attempt,
          attemptsUsed: attempt,
          input,
          output: executed.value,
          validation,
          note: executed.note,
          recovery:
            attempt > 1
              ? {
                  kind: 'retry',
                  description: `Succeeded on attempt ${attempt} of ${maxAttempts}`,
                  attempt,
                  succeeded: true,
                }
              : undefined,
          usedMock: executed.usedMock,
          durationMs: STEP_DURATION[block.kind],
        })
        if (policies.validatorBlock && validation) {
          push({
            blockId: policies.validatorBlock.id,
            blockKind: 'validator',
            title: policies.validatorBlock.title,
            status: 'completed',
            attempt: 1,
            attemptsUsed: 1,
            input: executed.value,
            output: { valid: true },
            validation,
            note: `Checked ${validation.checkedFields.join(', ')}`,
            usedMock: false,
            durationMs: STEP_DURATION.validator,
          })
        }
        return { status: 'ok', value: executed.value }
      }

      lastError = {
        kind: 'schemaValidation',
        message: 'The result did not match the required schema',
        detail: validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '),
      }

      push({
        blockId: block.id,
        blockKind: block.kind,
        title: block.title,
        status: isLastAttempt ? 'failed' : 'retrying',
        attempt,
        attemptsUsed: attempt,
        input,
        output: executed.value,
        validation,
        error: lastError,
        recovery: isLastAttempt
          ? undefined
          : {
              kind: 'retry',
              description: `Validation failed, retrying (attempt ${attempt + 1} of ${maxAttempts})`,
              attempt,
              succeeded: false,
            },
        note: executed.note,
        usedMock: executed.usedMock,
        durationMs: STEP_DURATION[block.kind],
      })
    } catch (error) {
      const typed = error as Error & { stepError?: StepError }
      lastError = typed.stepError ?? toStepError(error)
      push({
        blockId: block.id,
        blockKind: block.kind,
        title: block.title,
        status: isLastAttempt ? 'failed' : 'retrying',
        attempt,
        attemptsUsed: attempt,
        input,
        output: undefined,
        error: lastError,
        recovery: isLastAttempt
          ? undefined
          : {
              kind: 'retry',
              description: `Failed with ${lastError.kind}, retrying (attempt ${attempt + 1} of ${maxAttempts})`,
              attempt,
              succeeded: false,
            },
        usedMock: block.kind !== 'input',
        durationMs: STEP_DURATION[block.kind],
      })
    }
  }

  return recoverStep(block, policies, input, failures, context, push, trace, lastError, lastValue, lastValidation)
}

async function recoverStep(
  block: WorkflowBlock,
  policies: StepPolicies,
  input: unknown,
  failures: FailureKind[],
  context: RunContext,
  push: (entry: Omit<TraceEntry, 'id'>) => TraceEntry,
  trace: TraceEntry[],
  lastError: StepError | undefined,
  lastValue: unknown,
  lastValidation: ValidationResult | undefined,
): Promise<StepOutcome> {
  const strategy = policies.fallbackBlock?.config.onFailure ?? block.config.onFailure

  if (policies.fallbackBlock) {
    const fallbackBlock = policies.fallbackBlock
    const kind: RecoveryAction['kind'] =
      block.kind === 'tool' ? 'fallbackTool' : strategy === 'repairOutput' ? 'repairOutput' : 'fallbackModel'

    if (kind === 'repairOutput' && block.config.task && lastValue !== undefined) {
      const repaired = repairPayload(block.config.task, lastValue)
      const validation = validateStep(policies.validatorBlock, repaired)
      const ok = !validation || validation.valid
      push({
        blockId: fallbackBlock.id,
        blockKind: 'fallback',
        title: fallbackBlock.title,
        status: ok ? 'recovered' : 'failed',
        attempt: 1,
        attemptsUsed: 1,
        input: lastValue,
        output: repaired,
        validation,
        error: ok ? undefined : lastError,
        recovery: {
          kind: 'repairOutput',
          description: 'Repaired the malformed result and revalidated it',
          attempt: 1,
          succeeded: ok,
        },
        note: 'Repair strategy',
        usedMock: true,
        durationMs: 30,
      })
      if (ok) return { status: 'ok', value: repaired }
    } else {
      const overrides =
        block.kind === 'tool'
          ? { toolName: fallbackBlock.config.fallbackToolName ?? fallbackToolFor(block.config.toolName ?? 'webSearch') }
          : { task: fallbackBlock.config.fallbackTask ?? block.config.task }
      const cleanFailures = failures.filter(
        (failure) => failure !== 'modelTimeout' && failure !== 'toolTimeout' && failure !== 'toolFailure',
      )
      try {
        const executed = await runExecutable(block, input, 1, cleanFailures, context.liveProvider, overrides)
        const validation = validateStep(policies.validatorBlock, executed.value)
        const ok = !validation || validation.valid
        push({
          blockId: fallbackBlock.id,
          blockKind: 'fallback',
          title: fallbackBlock.title,
          status: ok ? 'recovered' : 'failed',
          attempt: 1,
          attemptsUsed: 1,
          input,
          output: executed.value,
          validation,
          error: ok ? undefined : lastError,
          recovery: {
            kind,
            description:
              block.kind === 'tool'
                ? `Switched to the backup tool ${overrides.toolName}`
                : 'Switched to the backup model provider',
            attempt: 1,
            succeeded: ok,
          },
          note: executed.note,
          usedMock: true,
          durationMs: STEP_DURATION[block.kind],
        })
        if (ok) return { status: 'ok', value: executed.value }
      } catch (error) {
        const typed = error as Error & { stepError?: StepError }
        push({
          blockId: fallbackBlock.id,
          blockKind: 'fallback',
          title: fallbackBlock.title,
          status: 'failed',
          attempt: 1,
          attemptsUsed: 1,
          input,
          output: undefined,
          error: typed.stepError ?? toStepError(error),
          recovery: { kind, description: 'The backup path also failed', attempt: 1, succeeded: false },
          usedMock: true,
          durationMs: STEP_DURATION[block.kind],
        })
      }
    }
  }

  if (policies.humanReviewBlock) {
    const decision = findDecision(context.humanDecisions, policies.humanReviewBlock.id)
    if (!decision) {
      push({
        blockId: policies.humanReviewBlock.id,
        blockKind: 'humanReview',
        title: policies.humanReviewBlock.title,
        status: 'paused',
        attempt: 1,
        attemptsUsed: 1,
        input: lastValue,
        output: undefined,
        error: lastError,
        recovery: {
          kind: 'routeToHuman',
          description: 'Automatic recovery did not clear the result, routing to a human',
          attempt: 1,
          succeeded: false,
        },
        note: 'Waiting for a human decision',
        usedMock: false,
        durationMs: 0,
      })
      return { status: 'awaitingHuman', value: lastValue, pendingBlock: policies.humanReviewBlock }
    }
  }

  if (strategy === 'safeDefault' && block.config.safeDefault !== undefined) {
    push({
      blockId: block.id,
      blockKind: block.kind,
      title: block.title,
      status: 'recovered',
      attempt: 1,
      attemptsUsed: 1,
      input,
      output: block.config.safeDefault,
      recovery: {
        kind: 'safeDefault',
        description: 'Used the configured safe default instead of the failed result',
        attempt: 1,
        succeeded: true,
      },
      usedMock: true,
      durationMs: 5,
    })
    return { status: 'ok', value: block.config.safeDefault }
  }

  if (policies.safeStopBlock) {
    push({
      blockId: policies.safeStopBlock.id,
      blockKind: 'safeStop',
      title: policies.safeStopBlock.title,
      status: 'safelyStopped',
      attempt: 1,
      attemptsUsed: 1,
      input: lastValue,
      output: {
        stopped: true,
        reason: lastError?.message ?? 'The step could not produce a trustworthy result',
      },
      error: lastError,
      validation: lastValidation,
      recovery: {
        kind: 'safeStop',
        description: 'Stopped safely instead of passing an untrusted result downstream',
        attempt: 1,
        succeeded: true,
      },
      usedMock: false,
      durationMs: 0,
    })
    return { status: 'stopped', value: lastValue }
  }

  const note =
    policies.maxAttempts > 1
      ? 'Every attempt was used and no fallback, human review, or safe stop was configured'
      : 'No retry, fallback, human review, or safe stop was configured for this step'

  const existing = [...trace].reverse().find((entry) => entry.blockId === block.id && entry.status === 'failed')
  if (existing) {
    existing.note = note
  } else {
    push({
      blockId: block.id,
      blockKind: block.kind,
      title: block.title,
      status: 'failed',
      attempt: policies.maxAttempts,
      attemptsUsed: policies.maxAttempts,
      input,
      output: lastValue,
      error: lastError ?? { kind: 'unhandled', message: 'The step failed with no recovery configured' },
      validation: lastValidation,
      note,
      usedMock: false,
      durationMs: 0,
    })
  }
  return { status: 'failed', value: lastValue }
}
