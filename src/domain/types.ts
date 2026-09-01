export type BlockKind =
  | 'input'
  | 'ai'
  | 'tool'
  | 'retrieval'
  | 'condition'
  | 'transform'
  | 'validator'
  | 'retry'
  | 'fallback'
  | 'humanReview'
  | 'safeStop'
  | 'output'

export type StepStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'paused'
  | 'retrying'
  | 'recovered'
  | 'safelyStopped'
  | 'skipped'

export type FailureKind =
  | 'modelTimeout'
  | 'toolTimeout'
  | 'invalidJson'
  | 'missingField'
  | 'schemaValidation'
  | 'emptyRetrieval'
  | 'lowConfidence'
  | 'toolFailure'

export type AiTask =
  | 'summarizeMeeting'
  | 'extractActionItems'
  | 'answerFromEvidence'
  | 'classifyTicket'
  | 'draftMessage'
  | 'extractInvoice'
  | 'planResearch'
  | 'synthesizeSources'

export type ToolName =
  | 'calendarLookup'
  | 'ticketDirectory'
  | 'webSearch'
  | 'newsFeed'
  | 'mailer'
  | 'crmLookup'

export type SchemaId =
  | 'meetingSummary'
  | 'groundedAnswer'
  | 'ticketRouting'
  | 'outboundMessage'
  | 'invoiceRecord'
  | 'researchDigest'

export type RecoveryKind =
  | 'retry'
  | 'fallbackModel'
  | 'fallbackTool'
  | 'repairOutput'
  | 'safeDefault'
  | 'routeToHuman'
  | 'safeStop'
  | 'resumeFromCheckpoint'

export interface BlockConfig {
  task?: AiTask
  prompt?: string
  toolName?: ToolName
  query?: string
  schemaId?: SchemaId
  maxAttempts?: number
  confidenceThreshold?: number
  fallbackTask?: AiTask
  fallbackToolName?: ToolName
  onFailure?: RecoveryKind
  safeDefault?: unknown
  conditionField?: string
  conditionEquals?: unknown
  transform?: 'pickFields' | 'toUpperTitle' | 'attachEvidence'
  transformFields?: string[]
  requiresApproval?: boolean
  timeoutMs?: number
}

export interface WorkflowBlock {
  id: string
  kind: BlockKind
  title: string
  hint: string
  config: BlockConfig
  removable: boolean
}

export interface Workflow {
  blocks: WorkflowBlock[]
}

export interface StepError {
  kind: FailureKind | 'humanRejection' | 'unhandled'
  message: string
  detail?: string
}

export interface ValidationIssue {
  path: string
  message: string
}

export interface ValidationResult {
  valid: boolean
  schemaId?: SchemaId
  issues: ValidationIssue[]
  checkedFields: string[]
}

export interface RecoveryAction {
  kind: RecoveryKind
  description: string
  attempt: number
  succeeded: boolean
}

export interface TraceEntry {
  id: string
  blockId: string
  blockKind: BlockKind
  title: string
  status: StepStatus
  attempt: number
  attemptsUsed: number
  input: unknown
  output: unknown
  validation?: ValidationResult
  error?: StepError
  recovery?: RecoveryAction
  note?: string
  usedMock: boolean
  durationMs: number
}

export type HumanDecisionKind = 'approve' | 'edit' | 'reject'

export interface HumanDecision {
  kind: HumanDecisionKind
  blockId: string
  editedOutput?: unknown
  comment?: string
  decidedAt: number
}

export interface PendingReview {
  blockId: string
  title: string
  payload: unknown
  question: string
}

export type RunStatus =
  | 'completed'
  | 'failed'
  | 'safelyStopped'
  | 'awaitingHuman'

export interface ReliabilitySignal {
  id: string
  label: string
  state: 'good' | 'warn' | 'bad' | 'neutral'
  detail: string
}

export interface ReliabilityReport {
  score: number
  grade: 'resilient' | 'fragile' | 'unfinished'
  headline: string
  signals: ReliabilitySignal[]
  unresolved: string[]
}

export interface RunResult {
  status: RunStatus
  trace: TraceEntry[]
  finalOutput: unknown
  pendingReview?: PendingReview
  reliability: ReliabilityReport
  checkpointBlockId?: string
}

export interface RunContext {
  input: unknown
  activeFailures: FailureKind[]
  humanDecisions: HumanDecision[]
  liveProvider?: LiveModelProvider
  resumeFromBlockId?: string
  completedBeforeResume?: TraceEntry[]
}

export interface ModelRequest {
  task: AiTask
  prompt: string
  input: unknown
  attempt: number
  blockId: string
  failures: FailureKind[]
}

export interface ModelResponse {
  raw: string
  parsed: unknown
  confidence: number
  provider: string
  usedMock: boolean
}

export interface LiveModelProvider {
  name: string
  complete(request: ModelRequest): Promise<ModelResponse>
}

export type Difficulty = 'beginner' | 'intermediate' | 'advanced'

export interface PuzzleFailureScenario {
  kind: FailureKind
  label: string
  description: string
  hint: string
}

export interface Puzzle {
  id: string
  title: string
  tagline: string
  difficulty: Difficulty
  objective: string
  story: string
  sampleInput: unknown
  expectedOutput: string
  schemaId?: SchemaId
  failureScenarios: PuzzleFailureScenario[]
  completionCriteria: CompletionCriterion[]
  starterWorkflow: Workflow
  solutionHint: string
  availableBlocks: WorkflowBlock[]
  requiresHumanReview: boolean
  requiresValidation: boolean
}

export type CriterionId =
  | 'runCompletes'
  | 'outputValid'
  | 'failureHandled'
  | 'retryUsed'
  | 'fallbackUsed'
  | 'humanDecisionRecorded'
  | 'safeStopUsed'
  | 'noUnhandledError'
  | 'resumedFromCheckpoint'

export interface CompletionCriterion {
  id: CriterionId
  label: string
  detail: string
}
