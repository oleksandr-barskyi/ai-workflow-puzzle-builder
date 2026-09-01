import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  CriterionId,
  FailureKind,
  HumanDecision,
  HumanDecisionKind,
  RunResult,
  Workflow,
  WorkflowBlock,
} from '../domain/types'
import { PUZZLES, cloneBlock, findPuzzle } from '../puzzles/puzzles'
import { runWorkflow } from '../engine/executor'
import { evaluateCriteria } from '../engine/reliability'

interface StudioState {
  puzzleId: string
  workflow: Workflow
  activeFailures: FailureKind[]
  humanDecisions: HumanDecision[]
  result?: RunResult
  resumedFromCheckpoint: boolean
  runCount: number
  solvedIds: string[]
}

function isSolved(puzzleId: string, result: RunResult, resumed: boolean): boolean {
  const criteria = findPuzzle(puzzleId).completionCriteria
  const met = evaluateCriteria(criteria, result, resumed)
  return criteria.every((criterion) => met[criterion.id])
}

function withSolved(previous: string[], puzzleId: string, result: RunResult, resumed: boolean): string[] {
  if (!isSolved(puzzleId, result, resumed)) return previous
  return previous.includes(puzzleId) ? previous : [...previous, puzzleId]
}

function starterFor(puzzleId: string): Workflow {
  const puzzle = findPuzzle(puzzleId)
  return { blocks: puzzle.starterWorkflow.blocks.map((item) => ({ ...item, config: { ...item.config } })) }
}

function defaultFailuresFor(puzzleId: string): FailureKind[] {
  return findPuzzle(puzzleId).failureScenarios.map((scenario) => scenario.kind)
}

export function useStudio() {
  const [state, setState] = useState<StudioState>(() => ({
    puzzleId: PUZZLES[0].id,
    workflow: starterFor(PUZZLES[0].id),
    activeFailures: defaultFailuresFor(PUZZLES[0].id),
    humanDecisions: [],
    resumedFromCheckpoint: false,
    runCount: 0,
    solvedIds: [],
  }))

  const stateRef = useRef(state)

  useEffect(() => {
    stateRef.current = state
  }, [state])

  const puzzle = useMemo(() => findPuzzle(state.puzzleId), [state.puzzleId])

  const selectPuzzle = useCallback((puzzleId: string) => {
    setState((prev) => ({
      puzzleId,
      workflow: starterFor(puzzleId),
      activeFailures: defaultFailuresFor(puzzleId),
      humanDecisions: [],
      result: undefined,
      resumedFromCheckpoint: false,
      runCount: 0,
      solvedIds: prev.solvedIds,
    }))
  }, [])

  const resetWorkflow = useCallback(() => {
    setState((prev) => ({
      ...prev,
      workflow: starterFor(prev.puzzleId),
      humanDecisions: [],
      result: undefined,
      resumedFromCheckpoint: false,
    }))
  }, [])

  const addBlock = useCallback((source: WorkflowBlock, atIndex?: number) => {
    setState((prev) => {
      const copy = cloneBlock(source)
      const blocks = [...prev.workflow.blocks]
      const outputIndex = blocks.findIndex((item) => item.kind === 'output')
      const target = atIndex ?? (outputIndex >= 0 ? outputIndex : blocks.length)
      blocks.splice(target, 0, copy)
      return { ...prev, workflow: { blocks }, result: undefined, humanDecisions: [] }
    })
  }, [])

  const removeBlock = useCallback((blockId: string) => {
    setState((prev) => ({
      ...prev,
      workflow: { blocks: prev.workflow.blocks.filter((item) => item.id !== blockId) },
      result: undefined,
      humanDecisions: [],
    }))
  }, [])

  const moveBlock = useCallback((from: number, to: number) => {
    setState((prev) => {
      const blocks = [...prev.workflow.blocks]
      if (from < 0 || from >= blocks.length || to < 0 || to >= blocks.length) return prev
      const [moved] = blocks.splice(from, 1)
      blocks.splice(to, 0, moved)
      return { ...prev, workflow: { blocks }, result: undefined, humanDecisions: [] }
    })
  }, [])

  const updateBlockConfig = useCallback((blockId: string, patch: Partial<WorkflowBlock['config']>) => {
    setState((prev) => ({
      ...prev,
      workflow: {
        blocks: prev.workflow.blocks.map((item) =>
          item.id === blockId ? { ...item, config: { ...item.config, ...patch } } : item,
        ),
      },
      result: undefined,
    }))
  }, [])

  const toggleFailure = useCallback((kind: FailureKind) => {
    setState((prev) => ({
      ...prev,
      activeFailures: prev.activeFailures.includes(kind)
        ? prev.activeFailures.filter((item) => item !== kind)
        : [...prev.activeFailures, kind],
      result: undefined,
      humanDecisions: [],
    }))
  }, [])

  const run = useCallback(async () => {
    const snapshot = stateRef.current
    const result = await runWorkflow(snapshot.workflow, {
      input: findPuzzle(snapshot.puzzleId).sampleInput,
      activeFailures: snapshot.activeFailures,
      humanDecisions: snapshot.humanDecisions,
    })
    setState((prev) => ({
      ...prev,
      result,
      resumedFromCheckpoint: false,
      runCount: prev.runCount + 1,
      solvedIds: withSolved(prev.solvedIds, prev.puzzleId, result, false),
    }))
  }, [])

  const decide = useCallback(
    async (blockId: string, kind: HumanDecisionKind, editedOutput?: unknown, comment?: string) => {
      const snapshot = stateRef.current
      const decisions: HumanDecision[] = [
        ...snapshot.humanDecisions.filter((item) => item.blockId !== blockId),
        { blockId, kind, editedOutput, comment, decidedAt: Date.now() },
      ]
      const result = await runWorkflow(snapshot.workflow, {
        input: findPuzzle(snapshot.puzzleId).sampleInput,
        activeFailures: snapshot.activeFailures,
        humanDecisions: decisions,
      })
      setState((prev) => ({
        ...prev,
        humanDecisions: decisions,
        result,
        runCount: prev.runCount + 1,
        solvedIds: withSolved(prev.solvedIds, prev.puzzleId, result, prev.resumedFromCheckpoint),
      }))
    },
    [],
  )

  const resumeFromCheckpoint = useCallback(async () => {
    const snapshot = stateRef.current
    if (!snapshot.result?.checkpointBlockId) return
    const blocks = snapshot.workflow.blocks
    const checkpointIndex = blocks.findIndex((item) => item.id === snapshot.result?.checkpointBlockId)
    const nextBlock = blocks[checkpointIndex + 1]
    if (!nextBlock) return
    const completed = snapshot.result.trace.filter((entry) => entry.status !== 'failed')
    const result = await runWorkflow(snapshot.workflow, {
      input: findPuzzle(snapshot.puzzleId).sampleInput,
      activeFailures: snapshot.activeFailures.filter(
        (failure) => failure !== 'modelTimeout' && failure !== 'toolTimeout' && failure !== 'toolFailure',
      ),
      humanDecisions: snapshot.humanDecisions,
      resumeFromBlockId: nextBlock.id,
      completedBeforeResume: completed,
    })
    setState((prev) => ({
      ...prev,
      result,
      resumedFromCheckpoint: true,
      runCount: prev.runCount + 1,
      solvedIds: withSolved(prev.solvedIds, prev.puzzleId, result, true),
    }))
  }, [])

  const criteria = useMemo<Record<CriterionId, boolean> | undefined>(() => {
    if (!state.result) return undefined
    return evaluateCriteria(puzzle.completionCriteria, state.result, state.resumedFromCheckpoint)
  }, [puzzle.completionCriteria, state.result, state.resumedFromCheckpoint])

  const solved = useMemo(() => {
    if (!criteria) return false
    return puzzle.completionCriteria.every((criterion) => criteria[criterion.id])
  }, [criteria, puzzle.completionCriteria])

  return {
    puzzles: PUZZLES,
    puzzle,
    workflow: state.workflow,
    activeFailures: state.activeFailures,
    humanDecisions: state.humanDecisions,
    result: state.result,
    resumedFromCheckpoint: state.resumedFromCheckpoint,
    runCount: state.runCount,
    solvedIds: state.solvedIds,
    criteria,
    solved,
    selectPuzzle,
    resetWorkflow,
    addBlock,
    removeBlock,
    moveBlock,
    updateBlockConfig,
    toggleFailure,
    run,
    decide,
    resumeFromCheckpoint,
  }
}
