# Architecture

This document covers the deliverable "Architecture Diagram" and explains how the pieces fit,
what depends on what, and why the boundaries are where they are.

---

## 1. System overview

```mermaid
flowchart TD
  subgraph Presentation["Presentation, src/ui"]
    LIST[PuzzleList]
    BRIEF[PuzzleBrief]
    CANVAS[WorkflowCanvas<br/>the visual builder]
    FAIL[FailurePanel<br/>failure switches]
    TRACE[TracePanel<br/>execution trace]
    RELI[ReliabilityPanel<br/>score and criteria]
    DIALOG[HumanReviewDialog<br/>approve, edit, reject]
  end

  subgraph State["Single source of truth, src/state"]
    STUDIO[useStudio<br/>puzzle id, workflow,<br/>active failures, decisions,<br/>last result, solved ids]
  end

  subgraph Content["Seed content, src/puzzles"]
    DEFS[puzzles.ts<br/>8 puzzles: objective, sample input,<br/>starter workflow, block palette,<br/>failure scenarios, completion criteria]
  end

  subgraph Engine["Execution engine, src/engine"]
    EXEC[executor.ts<br/>runWorkflow]
    POLICY[collectPolicies<br/>binds reliability blocks<br/>to the step above them]
    RECOVER[recoverStep<br/>retry, fallback, repair,<br/>route to human, safe stop]
    SCORE[reliability.ts<br/>facts, signals, score, criteria]
  end

  subgraph Providers["Simulated world, src/providers"]
    MODEL[mockModel.ts<br/>deterministic model<br/>and repair logic]
    TOOLS[tools.ts<br/>tools and retrieval]
  end

  subgraph Validation["Validation, src/validation"]
    ZOD[schemas.ts<br/>Zod schemas,<br/>confidence checks]
  end

  LIST --> STUDIO
  BRIEF --> STUDIO
  CANVAS --> STUDIO
  FAIL --> STUDIO
  DIALOG --> STUDIO

  STUDIO --> DEFS
  STUDIO --> EXEC

  EXEC --> POLICY
  EXEC --> MODEL
  EXEC --> TOOLS
  EXEC --> ZOD
  EXEC --> RECOVER
  RECOVER --> MODEL
  RECOVER --> TOOLS
  RECOVER --> ZOD

  EXEC --> RESULT[RunResult<br/>status, trace, final output,<br/>pending review, checkpoint]
  RESULT --> SCORE
  SCORE --> RESULT
  RESULT --> STUDIO

  STUDIO --> TRACE
  STUDIO --> RELI
  STUDIO --> DIALOG

  LIVE[LiveModelProvider<br/>optional, injected] -.-> EXEC
```

The arrows that matter: **the engine never points back at the UI.** `runWorkflow` takes a workflow
and a run context and returns a result. The UI reads that result. Nothing in `src/engine`,
`src/providers`, `src/validation`, or `src/puzzles` imports React.

---

## 2. What one step actually does

Every executable step runs through the same path. This is the core of the failure handling.

```mermaid
flowchart TD
  START([Step begins]) --> ATTEMPT[Attempt n of maxAttempts]
  ATTEMPT --> CALL{Call model,<br/>tool, or retrieval}

  CALL -->|throws| ERR[Record error:<br/>timeout, tool failure,<br/>invalid JSON, empty retrieval]
  CALL -->|returns| VAL{Validator<br/>configured?}

  VAL -->|no| OK([Step completed])
  VAL -->|yes| CHECK{Schema and<br/>confidence pass?}
  CHECK -->|yes| OK
  CHECK -->|no| ERR

  ERR --> MORE{Attempts<br/>remaining?}
  MORE -->|yes| RETRY[Record 'retrying'] --> ATTEMPT
  MORE -->|no| RECOVERY[Recovery chain]

  RECOVERY --> FB{Fallback block?}
  FB -->|repair| REPAIR[Merge with known-good shape,<br/>revalidate]
  FB -->|model or tool| BACKUP[Run the backup path,<br/>revalidate]
  FB -->|none| HUMAN

  REPAIR -->|valid| RECOVERED([Step recovered])
  REPAIR -->|still invalid| HUMAN
  BACKUP -->|valid| RECOVERED
  BACKUP -->|still invalid| HUMAN

  HUMAN{Human review<br/>block next?} -->|yes, no decision yet| PAUSE([Paused, awaiting human])
  HUMAN -->|no| DEFAULT{Safe default<br/>configured?}
  DEFAULT -->|yes| SAFEVAL([Step recovered<br/>with safe default])
  DEFAULT -->|no| STOP{Safe stop<br/>block?}
  STOP -->|yes| STOPPED([Workflow stopped safely])
  STOP -->|no| FAILED([Step failed unhandled])
```

Each box that ends the flow writes one trace entry, which is what the Execution trace panel renders
and what the reliability scoring reads afterwards. There is no separate log: **the trace is the
only record, and both the UI and the scoring read the same one.**

---

## 3. How blocks bind to each other

A workflow is a flat list, but reliability blocks are not steps in their own right. They configure
the executable step above them.

```mermaid
flowchart LR
  subgraph Written["What the user assembles"]
    direction TB
    A1[AI: classify ticket] --- A2[Validator: ticketRouting] --- A3[Retry: 3 attempts] --- A4[Fallback: repair] --- A5[Output]
  end

  subgraph Executed["What the engine runs"]
    direction TB
    B1["Step: classify ticket<br/>maxAttempts 3<br/>validator ticketRouting<br/>fallback repairOutput"] --> B2[Step: output]
  end

  Written ==> Executed
```

`collectPolicies` walks forward from an executable block, absorbing every `retry`, `validator`,
`fallback`, and `safeStop` it meets, and stops at the next executable block. A `humanReview` block
is noted as a recovery route but is **not** absorbed: it stays in the sequence so it also pauses the
workflow on a successful path. That is the difference between "ask a human when something breaks"
and "always ask a human before sending", and puzzle 5 depends on the second one.

---

## 4. Human review without a suspended process

The engine is a pure function, so there is no coroutine to park. Pausing works like this:

```mermaid
sequenceDiagram
  participant U as User
  participant S as useStudio
  participant E as runWorkflow
  participant D as HumanReviewDialog

  U->>S: Run workflow
  S->>E: runWorkflow(workflow, {decisions: []})
  E-->>S: status awaitingHuman, pendingReview, trace so far
  S->>D: render the pending payload
  U->>D: Approve / Edit / Reject
  D->>S: decide(blockId, kind, editedOutput)
  S->>E: runWorkflow(workflow, {decisions: [decision]})
  Note over E: Replays the earlier steps identically,<br/>because every simulator is deterministic,<br/>then continues past the pause
  E-->>S: final status, full trace including the decision
  S->>U: trace and reliability feedback
```

The replay is only sound because the model, the tools, and the retrieval are deterministic
functions of `(task, attempt, active failures)`. That property is worth more than it looks: it is
also what makes a reviewer able to reproduce any screenshot, and what makes the trace comparison in
the test suite possible.

Resuming from a checkpoint uses the same mechanism, with the earlier trace passed back in as
`completedBeforeResume` plus a synthetic entry recording the resume itself, so the interrupted run
stays visible in the history instead of being quietly erased.

---

## 5. Data that crosses each boundary

| Boundary | What crosses it | Direction |
| --- | --- | --- |
| UI to state | user intent: select puzzle, add/move/remove block, edit config, toggle failure, run, decide | one way |
| State to engine | `Workflow` plus `RunContext` (input, active failures, human decisions, optional live provider, resume point) | one way |
| Engine to providers | `ModelRequest` and tool calls carrying task, attempt, and active failures | one way |
| Providers to engine | parsed payload, confidence, provider name, or a typed error | one way |
| Engine to validation | the step output and the validator config | one way |
| Engine to state | `RunResult`: status, trace, final output, pending review, checkpoint, reliability report | one way |
| State to UI | derived view data only, no setters into the engine | one way |

There is no shared mutable object between the UI and the engine, and no path where the UI reaches
into an intermediate engine state. Everything the UI knows about a run arrives in the `RunResult`.

---

## 6. Why these boundaries

**The engine is testable without a browser.** All 23 tests are synchronous calls into
`runWorkflow` and `evaluateCriteria`. They assert on real behaviour: that each puzzle is unsolved
at the start, that each is solvable with its own palette, that two identical runs produce byte
identical traces, and that a handled failure scores above an unhandled one.

**The seed content is data, not code paths.** Adding a ninth puzzle means adding an object to
`puzzles.ts`. No engine change, no UI change, no new component.

**The simulated world is swappable.** `LiveModelProvider` is the only seam a real provider needs.
The engine awaits it exactly where it would await a mock, so retries, validation, fallbacks, and the
trace behave identically whether the answer came from a simulator or a network call.

**Scoring reads the trace, not the workflow.** Completion criteria are evaluated from what actually
happened during execution. That is why most puzzles have more than one valid solution, and why a
solution that only looks right on the canvas does not pass.
