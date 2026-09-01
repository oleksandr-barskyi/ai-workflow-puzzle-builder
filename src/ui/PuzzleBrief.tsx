import type { Puzzle } from '../domain/types'

interface Props {
  puzzle: Puzzle
}

export function PuzzleBrief({ puzzle }: Props) {
  return (
    <section className="panel">
      <h2>{puzzle.title}</h2>
      <p className="panel-note">
        <span className={`difficulty ${puzzle.difficulty}`}>{puzzle.difficulty}</span> {puzzle.tagline}
      </p>
      <div className="brief">
        <p className="objective">{puzzle.objective}</p>
        <p className="story">{puzzle.story}</p>

        <div className="kv">
          <div className="row">
            <span className="k">Expected</span>
            <span>{puzzle.expectedOutput}</span>
          </div>
        </div>

        <details className="hint-box">
          <summary>Sample input</summary>
          <pre className="code" style={{ marginTop: '0.4rem' }}>
            {JSON.stringify(puzzle.sampleInput, null, 2)}
          </pre>
        </details>

        <details className="hint-box">
          <summary>Stuck? Open the hint</summary>
          <p style={{ margin: '0.4rem 0 0' }}>{puzzle.solutionHint}</p>
        </details>
      </div>
    </section>
  )
}
