import { useState } from 'react'
import type { HumanDecisionKind, PendingReview } from '../domain/types'

interface Props {
  review: PendingReview
  onDecide: (blockId: string, kind: HumanDecisionKind, editedOutput?: unknown, comment?: string) => void
}

export function HumanReviewDialog({ review, onDecide }: Props) {
  const [draft, setDraft] = useState(() => safeFormat(review.payload))
  const [comment, setComment] = useState('')
  const [parseError, setParseError] = useState<string | undefined>()

  const submitEdit = () => {
    try {
      const parsed = JSON.parse(draft)
      setParseError(undefined)
      onDecide(review.blockId, 'edit', parsed, comment || 'Edited before approval')
    } catch (error) {
      setParseError(error instanceof Error ? error.message : 'The draft is not valid JSON')
    }
  }

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-label={review.title}>
      <div className="dialog">
        <h3>{review.title}</h3>
        <p className="question">{review.question}</p>

        <div>
          <div className="label" style={{ color: 'var(--muted)', fontSize: '0.72rem', letterSpacing: '0.06em' }}>
            RESULT WAITING FOR YOU
          </div>
          <textarea value={draft} onChange={(event) => setDraft(event.target.value)} spellCheck={false} />
          {parseError && <p style={{ color: 'var(--bad)', fontSize: '0.78rem', margin: '0.3rem 0 0' }}>{parseError}</p>}
        </div>

        <input
          type="text"
          placeholder="Reason for the decision, optional"
          value={comment}
          onChange={(event) => setComment(event.target.value)}
        />

        <div className="dialog-actions">
          <button
            type="button"
            className="btn danger"
            onClick={() => onDecide(review.blockId, 'reject', undefined, comment || 'Rejected by reviewer')}
          >
            Reject and stop
          </button>
          <button type="button" className="btn" onClick={submitEdit}>
            Save edit and continue
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => onDecide(review.blockId, 'approve', undefined, comment || undefined)}
          >
            Approve
          </button>
        </div>
      </div>
    </div>
  )
}

function safeFormat(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}
