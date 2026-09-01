import { useStudio } from './state/useStudio'
import { PuzzleList } from './ui/PuzzleList'
import { PuzzleBrief } from './ui/PuzzleBrief'
import { FailurePanel } from './ui/FailurePanel'
import { WorkflowCanvas } from './ui/WorkflowCanvas'
import { TracePanel } from './ui/TracePanel'
import { ReliabilityPanel } from './ui/ReliabilityPanel'
import { HumanReviewDialog } from './ui/HumanReviewDialog'

export default function App() {
  const studio = useStudio()

  const canResume =
    studio.result?.status === 'failed' && studio.result.checkpointBlockId !== undefined && !studio.resumedFromCheckpoint

  return (
    <div className="app">
      <header className="masthead">
        <div>
          <h1>AI Workflow Puzzle Builder</h1>
          <p className="sub">
            Assemble a workflow, break it on purpose, then make it survive. Nothing here calls a paid service.
          </p>
        </div>
        <span className="mode-pill">
          <span className="dot" />
          Mock AI mode, deterministic
        </span>
      </header>

      <div className="layout">
        <div className="column">
          <PuzzleList
            puzzles={studio.puzzles}
            selectedId={studio.puzzle.id}
            solvedIds={studio.solvedIds}
            onSelect={studio.selectPuzzle}
          />
          <PuzzleBrief puzzle={studio.puzzle} />
        </div>

        <div className="column">
          <WorkflowCanvas
            puzzle={studio.puzzle}
            workflow={studio.workflow}
            onAdd={studio.addBlock}
            onRemove={studio.removeBlock}
            onMove={studio.moveBlock}
            onConfig={studio.updateBlockConfig}
            onRun={studio.run}
            onReset={studio.resetWorkflow}
            canRun={studio.workflow.blocks.length > 0}
          />
          <FailurePanel
            puzzle={studio.puzzle}
            activeFailures={studio.activeFailures}
            onToggle={studio.toggleFailure}
          />
          <TracePanel result={studio.result} onResume={studio.resumeFromCheckpoint} canResume={canResume} />
        </div>

        <div className="column sticky-column">
          <ReliabilityPanel
            result={studio.result}
            criteria={studio.puzzle.completionCriteria}
            met={studio.criteria}
            solved={studio.solved}
          />
        </div>
      </div>

      {studio.result?.pendingReview && (
        <HumanReviewDialog review={studio.result.pendingReview} onDecide={studio.decide} />
      )}
    </div>
  )
}
