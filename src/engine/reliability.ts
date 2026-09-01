import type {
  CompletionCriterion,
  CriterionId,
  ReliabilityReport,
  ReliabilitySignal,
  RunResult,
  RunStatus,
  TraceEntry,
} from '../domain/types'

export interface RunFacts {
  completed: boolean
  safelyStopped: boolean
  awaitingHuman: boolean
  finalOutputValid: boolean
  injectedFailureSeen: boolean
  retryAttempts: number
  retrySucceeded: boolean
  fallbackUsed: boolean
  fallbackSucceeded: boolean
  humanDecisionRecorded: boolean
  humanApproved: boolean
  humanRejected: boolean
  safeStopUsed: boolean
  unhandledFailures: TraceEntry[]
  validationRun: boolean
  resumedFromCheckpoint: boolean
}

function wasCaughtLater(trace: TraceEntry[], failedIndex: number): boolean {
  for (let index = failedIndex + 1; index < trace.length; index += 1) {
    const entry = trace[index]
    if (entry.recovery?.succeeded) return true
    if (entry.recovery?.kind === 'resumeFromCheckpoint') return true
    if (entry.blockKind === 'safeStop' || entry.status === 'safelyStopped') return true
    if (entry.blockKind === 'humanReview' && entry.status !== 'failed') return true
    if (entry.status === 'recovered') return true
  }
  return false
}

export function collectRunFacts(trace: TraceEntry[], status: RunStatus, resumed = false): RunFacts {
  const failedEntries = trace.filter(
    (entry, index) => entry.status === 'failed' && !wasCaughtLater(trace, index),
  )
  const lastValidated = [...trace].reverse().find((entry) => entry.validation !== undefined)

  return {
    completed: status === 'completed',
    safelyStopped: status === 'safelyStopped',
    awaitingHuman: status === 'awaitingHuman',
    finalOutputValid: status === 'completed' && (lastValidated?.validation?.valid ?? false),
    injectedFailureSeen: trace.some((entry) => entry.error !== undefined),
    retryAttempts: trace.filter((entry) => entry.status === 'retrying').length,
    retrySucceeded: trace.some((entry) => entry.status === 'recovered' && entry.recovery?.kind === 'retry'),
    fallbackUsed: trace.some((entry) => entry.blockKind === 'fallback'),
    fallbackSucceeded: trace.some((entry) => entry.blockKind === 'fallback' && entry.recovery?.succeeded === true),
    humanDecisionRecorded: trace.some(
      (entry) => entry.blockKind === 'humanReview' && (entry.status === 'completed' || entry.status === 'safelyStopped'),
    ),
    humanApproved: trace.some((entry) => entry.blockKind === 'humanReview' && entry.status === 'completed'),
    humanRejected: trace.some(
      (entry) => entry.blockKind === 'humanReview' && entry.error?.kind === 'humanRejection',
    ),
    safeStopUsed: trace.some((entry) => entry.blockKind === 'safeStop' || entry.status === 'safelyStopped'),
    unhandledFailures: failedEntries.filter((entry) => entry.recovery === undefined),
    validationRun: trace.some((entry) => entry.validation !== undefined),
    resumedFromCheckpoint:
      resumed || trace.some((entry) => entry.recovery?.kind === 'resumeFromCheckpoint'),
  }
}

export function buildReliabilityReport(trace: TraceEntry[], status: RunStatus, resumed = false): ReliabilityReport {
  const facts = collectRunFacts(trace, status, resumed)
  const signals: ReliabilitySignal[] = []
  let score = 0

  if (facts.completed) {
    score += 30
    signals.push({
      id: 'completion',
      label: 'Workflow finished',
      state: 'good',
      detail: 'Every step produced a result and the workflow reached its output block.',
    })
  } else if (facts.safelyStopped) {
    score += 22
    signals.push({
      id: 'completion',
      label: 'Stopped safely',
      state: 'good',
      detail: 'The workflow refused to pass an untrusted result downstream. That is a correct outcome, not a crash.',
    })
  } else if (facts.awaitingHuman) {
    signals.push({
      id: 'completion',
      label: 'Waiting for a human',
      state: 'neutral',
      detail: 'The workflow paused and is holding its state until a person decides.',
    })
  } else {
    signals.push({
      id: 'completion',
      label: 'Workflow failed',
      state: 'bad',
      detail: 'A step failed and nothing caught it. Add a retry, fallback, human review, or safe stop.',
    })
  }

  if (facts.validationRun) {
    score += 12
    signals.push({
      id: 'validation',
      label: facts.finalOutputValid ? 'Output validated' : 'Validation ran',
      state: facts.finalOutputValid ? 'good' : 'warn',
      detail: facts.finalOutputValid
        ? 'The final result was checked against the schema and passed.'
        : 'A validator inspected the result, but the run did not end with a validated output.',
    })
  } else {
    signals.push({
      id: 'validation',
      label: 'No validation',
      state: 'warn',
      detail: 'Nothing checked the shape of the model output. Add a Validator block.',
    })
  }

  if (facts.injectedFailureSeen) {
    const handled =
      facts.retrySucceeded ||
      facts.fallbackSucceeded ||
      facts.safeStopUsed ||
      facts.humanDecisionRecorded ||
      facts.resumedFromCheckpoint
    if (handled) score += 24
    signals.push({
      id: 'failure',
      label: handled ? 'Failure handled' : 'Failure not handled',
      state: handled ? 'good' : 'bad',
      detail: handled
        ? 'The injected failure was caught and the workflow recovered or stopped on purpose.'
        : 'A failure happened and the workflow had no answer for it.',
    })
  } else {
    score += 10
    signals.push({
      id: 'failure',
      label: 'No failure injected',
      state: 'neutral',
      detail: 'This run was clean. Turn on a failure scenario to test how resilient the design really is.',
    })
  }

  if (facts.retryAttempts > 0) {
    score += facts.retrySucceeded ? 12 : 4
    signals.push({
      id: 'retry',
      label: `${facts.retryAttempts} retry attempt(s)`,
      state: facts.retrySucceeded ? 'good' : 'warn',
      detail: facts.retrySucceeded
        ? 'A retry recovered the step, so the transient failure never reached the user.'
        : 'Retries were spent without success. A fallback would help here.',
    })
  }

  if (facts.fallbackUsed) {
    score += facts.fallbackSucceeded ? 12 : 3
    signals.push({
      id: 'fallback',
      label: facts.fallbackSucceeded ? 'Fallback saved the run' : 'Fallback did not help',
      state: facts.fallbackSucceeded ? 'good' : 'warn',
      detail: facts.fallbackSucceeded
        ? 'The backup path produced a usable result after the primary one failed.'
        : 'The backup path ran but still did not produce a valid result.',
    })
  }

  if (facts.humanDecisionRecorded) {
    score += 10
    signals.push({
      id: 'human',
      label: facts.humanRejected ? 'Human rejected the result' : 'Human decision recorded',
      state: 'good',
      detail: facts.humanRejected
        ? 'A person stopped the workflow before anything left the building. The decision is in the trace.'
        : 'A person approved or edited the result before the workflow continued.',
    })
  }

  if (facts.resumedFromCheckpoint) {
    score += 8
    signals.push({
      id: 'resume',
      label: 'Resumed from checkpoint',
      state: 'good',
      detail: 'The workflow continued from the last successful step instead of starting over.',
    })
  }

  const unresolved: string[] = []
  for (const entry of facts.unhandledFailures) {
    unresolved.push(`${entry.title}: ${entry.error?.message ?? 'failed with no recovery'}`)
  }
  if (!facts.validationRun) unresolved.push('No validator guards the structured output.')
  if (
    facts.injectedFailureSeen &&
    facts.retryAttempts === 0 &&
    !facts.fallbackUsed &&
    !facts.safeStopUsed &&
    !facts.humanDecisionRecorded &&
    !facts.resumedFromCheckpoint
  ) {
    unresolved.push('A failure occurred but no retry, fallback, or safe stop was configured.')
  }

  const bounded = Math.max(0, Math.min(100, score))
  const grade: ReliabilityReport['grade'] =
    facts.awaitingHuman ? 'unfinished' : bounded >= 70 ? 'resilient' : 'fragile'

  const headline =
    grade === 'resilient'
      ? 'This workflow survives the failure you threw at it.'
      : grade === 'unfinished'
        ? 'The workflow is paused and waiting for a person.'
        : 'This workflow is still fragile. Look at the unresolved items below.'

  return { score: bounded, grade, headline, signals, unresolved }
}

export function evaluateCriteria(
  criteria: CompletionCriterion[],
  result: RunResult,
  resumed = false,
): Record<CriterionId, boolean> {
  const facts = collectRunFacts(result.trace, result.status, resumed)
  const met: Partial<Record<CriterionId, boolean>> = {}
  for (const criterion of criteria) {
    switch (criterion.id) {
      case 'runCompletes':
        met.runCompletes = facts.completed
        break
      case 'outputValid':
        met.outputValid = facts.finalOutputValid
        break
      case 'failureHandled':
        met.failureHandled =
          facts.injectedFailureSeen &&
          (facts.retrySucceeded || facts.fallbackSucceeded || facts.safeStopUsed || facts.humanDecisionRecorded)
        break
      case 'retryUsed':
        met.retryUsed = facts.retryAttempts > 0
        break
      case 'fallbackUsed':
        met.fallbackUsed = facts.fallbackUsed
        break
      case 'humanDecisionRecorded':
        met.humanDecisionRecorded = facts.humanDecisionRecorded
        break
      case 'safeStopUsed':
        met.safeStopUsed = facts.safeStopUsed
        break
      case 'noUnhandledError':
        met.noUnhandledError = facts.unhandledFailures.length === 0
        break
      case 'resumedFromCheckpoint':
        met.resumedFromCheckpoint = facts.resumedFromCheckpoint
        break
    }
  }
  return met as Record<CriterionId, boolean>
}
