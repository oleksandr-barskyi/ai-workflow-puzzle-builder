import type { RunResult, TraceEntry } from '../domain/types'

interface Props {
  result?: RunResult
  onResume: () => void
  canResume: boolean
}

const STATUS_LABEL: Record<TraceEntry['status'], string> = {
  pending: 'pending',
  running: 'running',
  completed: 'completed',
  failed: 'failed',
  paused: 'paused',
  retrying: 'retrying',
  recovered: 'recovered',
  safelyStopped: 'safe stop',
  skipped: 'skipped',
}

export function TracePanel({ result, onResume, canResume }: Props) {
  return (
    <section className="panel">
      <div className="canvas-head">
        <div>
          <h2>Execution trace</h2>
          <p className="panel-note">Every attempt, validation, and recovery, in order.</p>
        </div>
        {canResume && (
          <button type="button" className="btn ghost" onClick={onResume}>
            Resume from last good step
          </button>
        )}
      </div>

      {!result && <p className="empty">Run the workflow to see what happens inside it.</p>}

      {result && (
        <ul className="trace">
          {result.trace.map((entry, index) => (
            <li key={entry.id}>
              <details className="trace-entry" open={entry.status === 'failed' || entry.status === 'paused'}>
                <summary>
                  <span className={`status-chip status-${entry.status}`}>{STATUS_LABEL[entry.status]}</span>
                  <span>
                    {index + 1}. {entry.title}
                  </span>
                  {entry.attemptsUsed > 1 && <span style={{ color: 'var(--muted)' }}>attempt {entry.attempt}</span>}
                  {entry.usedMock && <span style={{ marginLeft: 'auto', color: 'var(--muted)', fontSize: '0.7rem' }}>mock</span>}
                </summary>
                <div className="trace-body">
                  {entry.note && <div>{entry.note}</div>}

                  {entry.error && (
                    <div className="error-line">
                      <div className="label">Error</div>
                      {entry.error.kind}: {entry.error.message}
                      {entry.error.detail && <div style={{ opacity: 0.8 }}>{entry.error.detail}</div>}
                    </div>
                  )}

                  {entry.recovery && (
                    <div className="recovery-line">
                      <div className="label">Recovery</div>
                      {entry.recovery.description} ({entry.recovery.succeeded ? 'worked' : 'did not clear it'})
                    </div>
                  )}

                  {entry.validation && (
                    <div>
                      <div className="label">Validation</div>
                      {entry.validation.valid ? (
                        <span style={{ color: 'var(--good)' }}>
                          passed, checked {entry.validation.checkedFields.join(', ')}
                        </span>
                      ) : (
                        <ul style={{ margin: 0, paddingLeft: '1rem' }}>
                          {entry.validation.issues.map((issue) => (
                            <li key={`${issue.path}-${issue.message}`} className="error-line">
                              {issue.path}: {issue.message}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}

                  <div>
                    <div className="label">Input</div>
                    <pre className="code">{format(entry.input)}</pre>
                  </div>

                  {entry.output !== undefined && (
                    <div>
                      <div className="label">Output</div>
                      <pre className="code">{format(entry.output)}</pre>
                    </div>
                  )}
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}

      {result?.finalOutput !== undefined && (
        <div style={{ marginTop: '0.6rem' }}>
          <div className="label" style={{ color: 'var(--muted)', fontSize: '0.72rem', letterSpacing: '0.06em' }}>
            FINAL RESULT
          </div>
          <pre className="code">{format(result.finalOutput)}</pre>
        </div>
      )}
    </section>
  )
}

function format(value: unknown): string {
  if (value === undefined) return 'undefined'
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}
