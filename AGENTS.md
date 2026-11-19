# Agent guidance

These practices apply to all work in this repository.

Before performing any write action on GitHub or Linear, show me the exact proposed action and content and wait for my explicit approval. This includes creating or editing PRs, issues, reviews, comments, labels, assignments, statuses, and responding to messages. Read-only inspection is allowed without approval. A general request to investigate or prepare work is not approval to publish it.

## Before changing code

- Read the relevant implementation, tests, and nearby documentation first.
- Check `git status` and preserve unrelated, in-progress changes.
- Make the smallest change that fully addresses the request. Do not broaden
  scope without confirming it with the user.
- Treat existing behavior and public data formats as compatibility contracts
  unless the task explicitly changes them.

## Implementation

- Prefer clear module boundaries: keep domain logic independent of UI,
  transport, and global state; keep side effects at application boundaries.
- Favor small, focused functions and modules with explicit inputs and outputs.
- Avoid duplication, hidden coupling, and unnecessary abstractions.
- Handle errors at the boundary where useful context is available. Do not
  silently swallow failures.
- Consider concurrency, cancellation, repeated user actions, and cleanup for
  asynchronous work.
- Preserve performance characteristics for expected workloads; measure before
  making or claiming significant performance improvements.
- Do not hand-edit generated files. Use the repository's generation workflow.

## Testing and verification

- Add or update focused tests for behavior changes and regressions.
- Run the narrowest relevant checks while iterating, then the repository's
  documented verification commands before handoff when practical.
- Report what was actually run and distinguish code failures from environment
  limitations.

## Documentation and handoff

- Update documentation when user-visible behavior, architecture, setup, or
  operational expectations change.
- Follow [docs/ai-documentation-guidelines.md](docs/ai-documentation-guidelines.md)
  when writing or revising project documentation.
- Keep docs accurate to the checked-out branch; avoid documenting plans as
  implemented features.
- In the final response, state the outcome, affected areas, and verification
  results concisely. Mention follow-up work only when it is genuinely needed.
