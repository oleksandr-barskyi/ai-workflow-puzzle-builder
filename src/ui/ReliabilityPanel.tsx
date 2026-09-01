import type { CompletionCriterion, CriterionId, RunResult } from '../domain/types'

interface Props {
  result?: RunResult
  criteria: CompletionCriterion[]
  met?: Record<CriterionId, boolean>
  solved: boolean
}

export function ReliabilityPanel({ result, criteria, met, solved }: Props) {
  return (
    <section className="panel">
      <h2>Reliability feedback</h2>
      <p className="panel-note">What the run proves about this design, and what it does not.</p>

      {!result && <p className="empty">No run yet.</p>}

      {result && (
        <>
          <div className="reliability-score">
            <span className="value">{result.reliability.score}</span>
            <span className={`grade ${result.reliability.grade}`}>{result.reliability.grade}</span>
          </div>
          <p style={{ margin: '0.3rem 0 0', fontSize: '0.86rem' }}>{result.reliability.headline}</p>

          <ul className="signals">
            {result.reliability.signals.map((signal) => (
              <li className={`signal ${signal.state}`} key={signal.id}>
                <span className="bullet" />
                <span>
                  <strong>{signal.label}</strong>
                  <div className="detail">{signal.detail}</div>
                </span>
              </li>
            ))}
          </ul>

          {result.reliability.unresolved.length > 0 && (
            <div className="unresolved">
              <strong>Still unresolved</strong>
              <ul>
                {result.reliability.unresolved.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      <div style={{ marginTop: '0.9rem' }}>
        <h2>Completion criteria</h2>
        <ul className="criteria">
          {criteria.map((criterion) => {
            const isMet = met?.[criterion.id] ?? false
            return (
              <li className={`criterion ${isMet ? 'met' : 'unmet'}`} key={criterion.id}>
                <span className="mark">{isMet ? '✓' : '○'}</span>
                <span>
                  <strong>{criterion.label}</strong>
                  <div className="detail">{criterion.detail}</div>
                </span>
              </li>
            )
          })}
        </ul>
        {solved && <div className="solved-banner">Puzzle solved. The workflow handles what you threw at it.</div>}
      </div>
    </section>
  )
}
