# Verification, honestly separated

## Engine integration tests

`npm test` creates temporary Git repositories and runs actual subprocesses. Cases include:

- red regression followed by a green scoped fix;
- a newly created file outside the plan;
- code changed after verification or during a check;
- ignored build artifacts that should not invalidate a diff;
- interrupted-state inspection through a second store connection;
- stale revisions and transaction rollback;
- timeouts, missing executables and exhausted budgets;
- installer collisions and an MCP stdio session.

The cart demo runs the same engine and Git operations with scripted roles. It establishes that the machinery works; it does not measure model judgment, productivity or reviewer quality.

## Live-model evaluation protocol

For a useful comparison, run the same fixture tasks with plain client prompting and with Racer. Record the exact client and model versions, prompts, repository SHA, budgets, model usage when available, and commands/results. Repeat runs rather than selecting the best output.

Suggested tasks: an off-by-one page boundary, a lost-update bug, a refactor preserving a public API, a branch review with an injected defect, and a clean branch that should receive no invented findings.

Measure acceptance-test success, false-positive reviews, interventions, time until a verified diff, and cost only when supplied by the client. No speedup or quality multiplier is claimed without a published measurement.
