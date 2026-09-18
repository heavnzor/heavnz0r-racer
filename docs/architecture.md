# Architecture / evidence before handoff

## Two planes

The **client plane** is OpenCode or Claude Code: model selection, context, subagent dispatch and tool permissions. Racer does not call a model API itself.

The **control plane** is a TypeScript library exposed through a CLI and eight MCP tools. It owns mission transitions, Git worktrees, command execution, persisted evidence and export. Both clients use the same engine and data format.

```
OpenCode skill + agents ─┐
                        ├── MCP stdio ── Racer engine ── Git + checks
Claude Code plugin ─────┘                    │
CLI ────────────────────────────────────────┤
                                            └── SQLite + evidence bundles
```

## State and recovery

`recon → plan → build → verify → review → handoff → done`

Failed checks and requested changes return to `build` while the attempt budget remains; otherwise the mission is `blocked`. A local completed handoff can be reverified when code changes, creating a new evidence bundle. Published missions are closed to further verification.

Each mutation updates the mission JSON and appends an event in a single SQLite transaction. A required revision prevents a delayed tool response from overwriting newer state. Database WAL and a busy timeout support separate CLI/MCP readers. Checks run outside a database transaction; concurrent mutations cause their result write to conflict, rather than silently winning.

An interrupted check may have performed effects before interruption. Resume inspects the persisted state; it does not automatically retry commands. Stop a still-running verification before rerunning it. There is no exactly-once guarantee for arbitrary external programs.

## Fingerprints

A temporary Git index starts at the worktree's HEAD, stages its visible files, and produces a binary-capable diff against the mission base SHA. The real index is untouched. The patch's SHA-256 binds the following:

- the content and paths of changed tracked files;
- newly added, non-ignored files;
- deletions, executable bits and Git symlink representations.

Ignored files, submodule working-tree internals, external environment state and dependency behavior are outside this fingerprint. This is diff freshness, not reproducible-build attestation.

The fingerprint must be unchanged before and after all checks. Review and handoff recheck it. Publishing rechecks after commit hooks and before push.

## Role boundaries

Scout and reviewer templates disable direct edit tools where the host supports it. The engine validates paths in findings and scope before verification, but it does not sandbox an agent, shell or compiler. The configured client's permission model remains authoritative. A passing review records a client-reported identity; a separate reviewer is a procedure enforced by the skill, not a cryptographic fact.

## Files

```
src/engine.ts       transitions and evidence gates
src/store.ts        SQLite transactions and event journal
src/git.ts          snapshots and bounded subprocess execution
src/mcp.ts          shared tool contract
src/cli.ts          terminal entry point
src/publish.ts      explicit draft-PR handoff
src/install.ts      conservative OpenCode installation
agents/ + skills/  Claude Code integration
integrations/      OpenCode integration templates
```

Bundles use `racer.receipt/v1`. They contain actual check outputs and a diff fingerprint. Future schema changes will require an explicit format version.
