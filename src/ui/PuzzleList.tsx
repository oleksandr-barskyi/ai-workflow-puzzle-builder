import type { Puzzle } from '../domain/types'

interface Props {
  puzzles: Puzzle[]
  selectedId: string
  solvedIds: string[]
  onSelect: (id: string) => void
}

export function PuzzleList({ puzzles, selectedId, solvedIds, onSelect }: Props) {
  return (
    <section className="panel">
      <h2>Puzzles</h2>
      <p className="panel-note">Every puzzle ships with its input, its failure, and the way out.</p>
      <ul className="puzzle-list">
        {puzzles.map((puzzle) => (
          <li key={puzzle.id}>
            <button
              type="button"
              className="puzzle-card"
              aria-current={puzzle.id === selectedId}
              onClick={() => onSelect(puzzle.id)}
            >
              <span className="title">{puzzle.title}</span>
              <span className="meta">
                <span className={`difficulty ${puzzle.difficulty}`}>{puzzle.difficulty}</span>
                <span>{puzzle.tagline}</span>
                {solvedIds.includes(puzzle.id) && <span className="solved-badge">solved</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
