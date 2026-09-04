import { describe, expect, it } from 'vitest'
import type { HumanDecision, Puzzle, Workflow, WorkflowBlock } from '../domain/types'
import { PUZZLES, cloneBlock, findPuzzle } from '../puzzles/puzzles'
import { runWorkflow } from './executor'
import { evaluateCriteria } from './reliability'

function starter(puzzle: Puzzle): Workflow {
  return { blocks: puzzle.starterWorkflow.blocks.map((block) => ({ ...block, config: { ...block.config } })) }
}

function palette(puzzle: Puzzle, kind: WorkflowBlock['kind'], index = 0): WorkflowBlock {
  const matches = puzzle.availableBlocks.filter((block) => block.kind === kind)
  const source = matches[index]
  if (!source) throw new Error(`Puzzle ${puzzle.id} has no ${kind} block in its palette`)
  return cloneBlock(source)
}

function insertBefore(workflow: Workflow, kind: WorkflowBlock['kind'], block: WorkflowBlock): Workflow {
  const blocks = [...workflow.blocks]
  const index = blocks.findIndex((item) => item.kind === kind)
  blocks.splice(index < 0 ? blocks.length : index, 0, block)
  return { blocks }
}

function run(puzzle: Puzzle, workflow: Workflow, decisions: HumanDecision[] = []) {
  return runWorkflow(workflow, {
    input: puzzle.sampleInput,
    activeFailures: puzzle.failureScenarios.map((scenario) => scenario.kind),
    humanDecisions: decisions,
  })
}

async function solvedBy(puzzle: Puzzle, workflow: Workflow, decisions: HumanDecision[] = []): Promise<boolean> {
  const result = await run(puzzle, workflow, decisions)
  const met = evaluateCriteria(puzzle.completionCriteria, result)
  return puzzle.completionCriteria.every((criterion) => met[criterion.id])
}

describe('starter workflows', () => {
  it('every puzzle starts unsolved, so there is something to do', async () => {
    for (const puzzle of PUZZLES) {
      expect(await solvedBy(puzzle, starter(puzzle)), `${puzzle.id} should start unsolved`).toBe(false)
    }
  })

  it('every puzzle ships a palette with at least one reliability block', async () => {
    for (const puzzle of PUZZLES) {
      const reliabilityKinds: WorkflowBlock['kind'][] = ['retry', 'fallback', 'validator', 'safeStop', 'humanReview']
      const found = puzzle.availableBlocks.some((block) => reliabilityKinds.includes(block.kind))
      expect(found, `${puzzle.id} palette`).toBe(true)
    }
  })
})

describe('puzzle 1, meeting summarizer', () => {
  const puzzle = findPuzzle('meeting-summarizer')

  it('fails validation while the owner field is missing', async () => {
    const workflow = insertBefore(starter(puzzle), 'output', palette(puzzle, 'validator'))
    const result = await run(puzzle, workflow)
    expect(result.status).toBe('failed')
    const failed = result.trace.find((entry) => entry.status === 'failed')
    expect(failed?.validation?.valid).toBe(false)
  })

  it('is solved by a validator plus a repair fallback', async () => {
    let workflow = insertBefore(starter(puzzle), 'output', palette(puzzle, 'validator'))
    workflow = insertBefore(workflow, 'output', palette(puzzle, 'fallback'))
    expect(await solvedBy(puzzle, workflow)).toBe(true)
  })
})

describe('puzzle 2, knowledge assistant', () => {
  const puzzle = findPuzzle('knowledge-assistant')

  it('fails outright when retrieval is empty and nothing catches it', async () => {
    const result = await run(puzzle, starter(puzzle))
    expect(result.status).toBe('failed')
    expect(result.trace.some((entry) => entry.error?.kind === 'emptyRetrieval')).toBe(true)
  })

  it('is solved by stopping safely after the retrieval step', async () => {
    const workflow = starter(puzzle)
    const blocks = [...workflow.blocks]
    const retrievalIndex = blocks.findIndex((block) => block.kind === 'retrieval')
    blocks.splice(retrievalIndex + 1, 0, palette(puzzle, 'safeStop'))
    const result = await run(puzzle, { blocks })
    expect(result.status).toBe('safelyStopped')
    expect(await solvedBy(puzzle, { blocks })).toBe(true)
  })
})

describe('puzzle 3, ticket router', () => {
  const puzzle = findPuzzle('ticket-router')

  it('is solved by validator, retry, and repair fallback', async () => {
    let workflow = insertBefore(starter(puzzle), 'output', palette(puzzle, 'validator'))
    workflow = insertBefore(workflow, 'output', palette(puzzle, 'retry'))
    workflow = insertBefore(workflow, 'output', palette(puzzle, 'fallback'))
    const result = await run(puzzle, workflow)
    expect(result.status).toBe('completed')
    expect(await solvedBy(puzzle, workflow)).toBe(true)
  })

  it('records a retry attempt in the trace', async () => {
    let workflow = insertBefore(starter(puzzle), 'output', palette(puzzle, 'validator'))
    workflow = insertBefore(workflow, 'output', palette(puzzle, 'retry'))
    workflow = insertBefore(workflow, 'output', palette(puzzle, 'fallback'))
    const result = await run(puzzle, workflow)
    expect(result.trace.some((entry) => entry.status === 'retrying')).toBe(true)
  })
})

describe('puzzle 4, research timeout', () => {
  const puzzle = findPuzzle('research-timeout')

  it('survives the timeout with three retries', async () => {
    const workflow = starter(puzzle)
    const blocks = [...workflow.blocks]
    const toolIndex = blocks.findIndex((block) => block.kind === 'tool')
    blocks.splice(toolIndex + 1, 0, palette(puzzle, 'retry'))
    const result = await run(puzzle, { blocks })
    expect(result.status).toBe('completed')
    expect(await solvedBy(puzzle, { blocks })).toBe(true)
  })
})

describe('puzzle 5, approve before sending', () => {
  const puzzle = findPuzzle('approve-before-sending')

  it('pauses and waits for a person', async () => {
    const workflow = starter(puzzle)
    const blocks = [...workflow.blocks]
    const aiIndex = blocks.findIndex((block) => block.kind === 'ai')
    blocks.splice(aiIndex + 1, 0, palette(puzzle, 'humanReview'))
    const result = await run(puzzle, { blocks })
    expect(result.status).toBe('awaitingHuman')
    expect(result.pendingReview).toBeDefined()
  })

  it('records an approval and finishes', async () => {
    const workflow = starter(puzzle)
    const blocks = [...workflow.blocks]
    const aiIndex = blocks.findIndex((block) => block.kind === 'ai')
    const review = palette(puzzle, 'humanReview')
    blocks.splice(aiIndex + 1, 0, review)
    const decisions: HumanDecision[] = [{ blockId: review.id, kind: 'approve', decidedAt: 1 }]
    const result = await run(puzzle, { blocks }, decisions)
    expect(result.status).toBe('completed')
    expect(await solvedBy(puzzle, { blocks }, decisions)).toBe(true)
  })

  it('stops safely when the reviewer rejects', async () => {
    const workflow = starter(puzzle)
    const blocks = [...workflow.blocks]
    const aiIndex = blocks.findIndex((block) => block.kind === 'ai')
    const review = palette(puzzle, 'humanReview')
    blocks.splice(aiIndex + 1, 0, review)
    const decisions: HumanDecision[] = [
      { blockId: review.id, kind: 'reject', comment: 'Wrong amount', decidedAt: 1 },
    ]
    const result = await run(puzzle, { blocks }, decisions)
    expect(result.status).toBe('safelyStopped')
    expect(result.trace.some((entry) => entry.error?.kind === 'humanRejection')).toBe(true)
    expect(await solvedBy(puzzle, { blocks }, decisions)).toBe(true)
  })

  it('keeps the edited payload when the reviewer edits', async () => {
    const workflow = starter(puzzle)
    const blocks = [...workflow.blocks]
    const aiIndex = blocks.findIndex((block) => block.kind === 'ai')
    const review = palette(puzzle, 'humanReview')
    blocks.splice(aiIndex + 1, 0, review)
    const edited = { subject: 'Refund on its way', body: 'x'.repeat(30), tone: 'plain' }
    const decisions: HumanDecision[] = [
      { blockId: review.id, kind: 'edit', editedOutput: edited, decidedAt: 1 },
    ]
    const result = await run(puzzle, { blocks }, decisions)
    const reviewEntry = result.trace.find((entry) => entry.blockKind === 'humanReview')
    expect(reviewEntry?.output).toEqual(edited)
  })
})

describe('puzzle 6, activate the fallback', () => {
  const puzzle = findPuzzle('activate-the-fallback')

  it('cannot be solved by retries alone', async () => {
    const workflow = insertBefore(starter(puzzle), 'output', palette(puzzle, 'retry'))
    expect(await solvedBy(puzzle, workflow)).toBe(false)
  })

  it('is solved by retry, validator, and repair fallback together', async () => {
    let workflow = insertBefore(starter(puzzle), 'output', palette(puzzle, 'retry'))
    workflow = insertBefore(workflow, 'output', palette(puzzle, 'validator'))
    workflow = insertBefore(workflow, 'output', palette(puzzle, 'fallback'))
    const result = await run(puzzle, workflow)
    expect(result.status).toBe('completed')
    expect(await solvedBy(puzzle, workflow)).toBe(true)
  })
})

describe('puzzle 7, malformed json', () => {
  const puzzle = findPuzzle('malformed-json')

  it('fails on the truncated reply when nothing retries', async () => {
    const result = await run(puzzle, starter(puzzle))
    expect(result.status).toBe('failed')
    expect(result.trace.some((entry) => entry.error?.kind === 'invalidJson')).toBe(true)
  })

  it('is solved by a single retry', async () => {
    const workflow = insertBefore(starter(puzzle), 'output', palette(puzzle, 'retry'))
    const result = await run(puzzle, workflow)
    expect(result.status).toBe('completed')
    expect(await solvedBy(puzzle, workflow)).toBe(true)
  })
})

describe('puzzle 8, resume the mission', () => {
  const puzzle = findPuzzle('resume-the-mission')

  it('fails at the second source and records a checkpoint', async () => {
    const result = await run(puzzle, starter(puzzle))
    expect(result.status).toBe('failed')
    expect(result.checkpointBlockId).toBeDefined()
  })

  it('completes when resumed from the last successful step', async () => {
    const workflow = starter(puzzle)
    const first = await run(puzzle, workflow)
    const checkpointIndex = workflow.blocks.findIndex((block) => block.id === first.checkpointBlockId)
    const nextBlock = workflow.blocks[checkpointIndex + 1]
    expect(nextBlock).toBeDefined()

    const resumed = await runWorkflow(workflow, {
      input: puzzle.sampleInput,
      activeFailures: [],
      humanDecisions: [],
      resumeFromBlockId: nextBlock.id,
      completedBeforeResume: first.trace.filter((entry) => entry.status !== 'failed'),
    })

    expect(resumed.status).toBe('completed')
    const met = evaluateCriteria(puzzle.completionCriteria, resumed, true)
    expect(puzzle.completionCriteria.every((criterion) => met[criterion.id])).toBe(true)
  })

  it('keeps the already completed steps in the resumed trace', async () => {
    const workflow = starter(puzzle)
    const first = await run(puzzle, workflow)
    const kept = first.trace.filter((entry) => entry.status !== 'failed')
    const checkpointIndex = workflow.blocks.findIndex((block) => block.id === first.checkpointBlockId)
    const resumed = await runWorkflow(workflow, {
      input: puzzle.sampleInput,
      activeFailures: [],
      humanDecisions: [],
      resumeFromBlockId: workflow.blocks[checkpointIndex + 1].id,
      completedBeforeResume: kept,
    })
    expect(resumed.trace.length).toBeGreaterThan(kept.length)
    expect(resumed.trace.slice(0, kept.length).map((entry) => entry.title)).toEqual(
      kept.map((entry) => entry.title),
    )
  })
})

describe('determinism', () => {
  it('two identical runs produce an identical trace', async () => {
    const puzzle = findPuzzle('ticket-router')
    let workflow = insertBefore(starter(puzzle), 'output', palette(puzzle, 'validator'))
    workflow = insertBefore(workflow, 'output', palette(puzzle, 'retry'))
    const first = await run(puzzle, workflow)
    const second = await run(puzzle, workflow)
    expect(JSON.stringify(second.trace)).toBe(JSON.stringify(first.trace))
    expect(second.reliability.score).toBe(first.reliability.score)
  })
})

describe('reliability scoring', () => {
  it('rewards a handled failure over an unhandled one', async () => {
    const puzzle = findPuzzle('ticket-router')
    const bare = await run(puzzle, starter(puzzle))
    let guarded = insertBefore(starter(puzzle), 'output', palette(puzzle, 'validator'))
    guarded = insertBefore(guarded, 'output', palette(puzzle, 'retry'))
    guarded = insertBefore(guarded, 'output', palette(puzzle, 'fallback'))
    const strong = await run(puzzle, guarded)
    expect(strong.reliability.score).toBeGreaterThan(bare.reliability.score)
    expect(strong.reliability.grade).toBe('resilient')
  })

  it('lists an unresolved item when a step fails with no recovery', async () => {
    const puzzle = findPuzzle('knowledge-assistant')
    const result = await run(puzzle, starter(puzzle))
    expect(result.reliability.unresolved.length).toBeGreaterThan(0)
  })

  it('never calls a run clean while a failure scenario is switched on', async () => {
    const puzzle = findPuzzle('meeting-summarizer')
    const result = await run(puzzle, starter(puzzle))
    const failure = result.reliability.signals.find((signal) => signal.id === 'failure')
    expect(result.status).toBe('completed')
    expect(failure?.label).not.toBe('No failure injected')
    expect(failure?.state).toBe('bad')
    expect(result.reliability.unresolved.length).toBeGreaterThan(0)
  })

  it('still reports a clean run when no failure scenario is active', async () => {
    const puzzle = findPuzzle('meeting-summarizer')
    const result = await runWorkflow(starter(puzzle), {
      input: puzzle.sampleInput,
      activeFailures: [],
      humanDecisions: [],
    })
    const failure = result.reliability.signals.find((signal) => signal.id === 'failure')
    expect(failure?.label).toBe('No failure injected')
  })
})
