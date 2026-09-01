import type { FailureKind, Puzzle } from '../domain/types'

interface Props {
  puzzle: Puzzle
  activeFailures: FailureKind[]
  onToggle: (kind: FailureKind) => void
}

export function FailurePanel({ puzzle, activeFailures, onToggle }: Props) {
  return (
    <section className="panel">
      <h2>Failure scenarios</h2>
      <p className="panel-note">
        Deterministic and repeatable: the same switches always produce the same trace.
      </p>
      <div className="failures">
        {puzzle.failureScenarios.map((scenario) => (
          <label className="failure" key={scenario.kind}>
            <input
              type="checkbox"
              checked={activeFailures.includes(scenario.kind)}
              onChange={() => onToggle(scenario.kind)}
            />
            <span>
              <span className="label">{scenario.label}</span>
              <p className="desc">{scenario.description}</p>
              <p className="hint">{scenario.hint}</p>
            </span>
          </label>
        ))}
      </div>
    </section>
  )
}
