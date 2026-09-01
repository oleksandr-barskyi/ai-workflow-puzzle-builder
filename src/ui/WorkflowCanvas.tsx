import { useState } from 'react'
import type { BlockKind, Puzzle, Workflow, WorkflowBlock } from '../domain/types'
import { SCHEMA_LABELS } from '../validation/schemas'

const KIND_COLOR: Record<BlockKind, string> = {
  input: '#7fb2ff',
  ai: '#8b7dfb',
  tool: '#5fe3c0',
  retrieval: '#4fc9dd',
  condition: '#c7a6ff',
  transform: '#9fb4d8',
  validator: '#f5c264',
  retry: '#f0a05a',
  fallback: '#ff9f7b',
  humanReview: '#ff7bd0',
  safeStop: '#ff7b7b',
  output: '#7fb2ff',
}

const SCHEMA_OPTIONS = Object.keys(SCHEMA_LABELS) as Array<keyof typeof SCHEMA_LABELS>

interface Props {
  puzzle: Puzzle
  workflow: Workflow
  onAdd: (block: WorkflowBlock, atIndex?: number) => void
  onRemove: (blockId: string) => void
  onMove: (from: number, to: number) => void
  onConfig: (blockId: string, patch: Partial<WorkflowBlock['config']>) => void
  onRun: () => void
  onReset: () => void
  canRun: boolean
}

export function WorkflowCanvas({
  puzzle,
  workflow,
  onAdd,
  onRemove,
  onMove,
  onConfig,
  onRun,
  onReset,
  canRun,
}: Props) {
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)

  const handleDrop = (target: number) => {
    if (draggingIndex !== null && draggingIndex !== target) onMove(draggingIndex, target)
    setDraggingIndex(null)
    setDropIndex(null)
  }

  return (
    <section className="panel canvas">
      <div className="canvas-head">
        <div>
          <h2>Workflow builder</h2>
          <p className="panel-note">
            Drag to reorder. Reliability blocks act on the step directly above them.
          </p>
        </div>
        <div className="toolbar">
          <button type="button" className="btn ghost" onClick={onReset}>
            Reset to starter
          </button>
          <button type="button" className="btn primary" onClick={onRun} disabled={!canRun}>
            Run workflow
          </button>
        </div>
      </div>

      <ul className="blocks">
        {workflow.blocks.map((block, index) => (
          <li
            key={block.id}
            className={`block${draggingIndex === index ? ' dragging' : ''}${dropIndex === index ? ' drop-target' : ''}`}
            style={{ ['--kindColor' as string]: KIND_COLOR[block.kind] }}
            draggable
            onDragStart={() => setDraggingIndex(index)}
            onDragOver={(event) => {
              event.preventDefault()
              setDropIndex(index)
            }}
            onDragLeave={() => setDropIndex((current) => (current === index ? null : current))}
            onDrop={() => handleDrop(index)}
            onDragEnd={() => {
              setDraggingIndex(null)
              setDropIndex(null)
            }}
          >
            <div className="block-head">
              <span className="block-kind">{block.kind}</span>
              <span className="block-title">{block.title}</span>
              <div className="block-actions">
                <button
                  type="button"
                  className="icon-btn"
                  title="Move up"
                  disabled={index === 0}
                  onClick={() => onMove(index, index - 1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  title="Move down"
                  disabled={index === workflow.blocks.length - 1}
                  onClick={() => onMove(index, index + 1)}
                >
                  ↓
                </button>
                {block.removable && (
                  <button
                    type="button"
                    className="icon-btn"
                    title="Remove block"
                    onClick={() => onRemove(block.id)}
                  >
                    ×
                  </button>
                )}
              </div>
            </div>
            <p className="block-hint">{block.hint}</p>
            <BlockConfig block={block} onConfig={onConfig} />
          </li>
        ))}
      </ul>

      <div>
        <h2>Available blocks</h2>
        <p className="panel-note">Click to add before the output step, then drag it into place.</p>
        <div className="palette">
          {puzzle.availableBlocks.map((block) => (
            <button
              type="button"
              className="palette-item"
              key={block.id}
              style={{ borderColor: KIND_COLOR[block.kind] }}
              onClick={() => onAdd(block)}
              title={block.hint}
            >
              + {block.title}
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}

function BlockConfig({
  block,
  onConfig,
}: {
  block: WorkflowBlock
  onConfig: (blockId: string, patch: Partial<WorkflowBlock['config']>) => void
}) {
  if (block.kind === 'retry') {
    return (
      <div className="block-config">
        <label>
          Max attempts
          <input
            type="number"
            min={1}
            max={5}
            value={block.config.maxAttempts ?? 2}
            onChange={(event) => onConfig(block.id, { maxAttempts: Number(event.target.value) })}
          />
        </label>
      </div>
    )
  }

  if (block.kind === 'validator') {
    return (
      <div className="block-config">
        <label>
          Schema
          <select
            value={block.config.schemaId ?? SCHEMA_OPTIONS[0]}
            onChange={(event) => onConfig(block.id, { schemaId: event.target.value as WorkflowBlock['config']['schemaId'] })}
          >
            {SCHEMA_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {SCHEMA_LABELS[option]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Min confidence
          <input
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={block.config.confidenceThreshold ?? 0}
            onChange={(event) =>
              onConfig(block.id, { confidenceThreshold: Number(event.target.value) || undefined })
            }
          />
        </label>
      </div>
    )
  }

  if (block.kind === 'fallback') {
    return (
      <div className="block-config">
        <label>
          Strategy
          <select
            value={block.config.onFailure ?? 'repairOutput'}
            onChange={(event) =>
              onConfig(block.id, { onFailure: event.target.value as WorkflowBlock['config']['onFailure'] })
            }
          >
            <option value="repairOutput">Repair the output</option>
            <option value="fallbackModel">Backup model</option>
            <option value="fallbackTool">Backup tool</option>
            <option value="safeDefault">Safe default</option>
          </select>
        </label>
      </div>
    )
  }

  if (block.kind === 'ai' && block.config.prompt) {
    return (
      <div className="block-config">
        <span>Prompt: {block.config.prompt}</span>
      </div>
    )
  }

  if (block.kind === 'tool' && block.config.toolName) {
    return (
      <div className="block-config">
        <span>Tool: {block.config.toolName}</span>
      </div>
    )
  }

  return null
}
