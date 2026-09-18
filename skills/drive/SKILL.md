---
name: drive
description: Runs Racer development missions for a requested bug fix, targeted refactor, or branch review. Use when the user invokes Racer or asks for an evidence-driven development workflow.
disable-model-invocation: true
---

# Racer / mission control

User task: $ARGUMENTS

Use the Racer MCP tools (discover their plugin-prefixed names). The host model performs the work; the MCP server persists state and enforces transitions.

1. Identify the user's Git repository, read its instructions, and classify the task as `fix`, `refactor`, or `review`. Ask only about consequential ambiguity. For a review, obtain the base branch and require committed changes.
2. Call `racer_list` to find a relevant unfinished mission. Resume it with `racer_resume` when appropriate; never silently create a replacement for interrupted work. Otherwise call `racer_start`.
3. All exploration, tests and edits use the returned **worktree**, not the original checkout. Delegate focused exploration to `racer:scout`. Supply the absolute worktree path and brief. Ask for file/line evidence and available check commands.
4. Propose a small plan through `racer_plan`: allowed file/directory paths (no glob syntax), acceptance criteria, named checks as argv arrays, and real file/line evidence. Account for dependency installation; the fresh worktree has no ignored dependencies. Present the plan and proceed when the user has accepted its scope.
5. Call `racer_begin`. For bug fixes, delegate regression tests to `racer:test-writer` and reproduce the failure with the relevant command. The full `racer_verify` can record a red run, but each invocation spends an attempt. Delegate implementation to `racer:builder`. For branch reviews, inspect the existing diff rather than modify it.
6. Run `racer_verify`. Read actual failures. Infrastructure errors are not proof of a code defect. Long suites can be run with the CLI if the client's MCP timeout is too short. Avoid concurrent verification calls; after a transport timeout resume before retrying.
7. Once verification passes, delegate `racer:reviewer` with the brief, criteria, worktree, base SHA, and receipt fingerprint. The reviewer must be a fresh subagent, not the implementation agent. It returns a verdict and located findings. Call `racer_review` with that result. Repair requested changes within the remaining budget, then verify again.
8. Call `racer_handoff` only when directed by state. Report the worktree, files, checks, caveats, and bundle path. Publishing is a separate explicit user action: `racer publish ID --repo REPO --confirm`.

Always use the revision returned by the last tool. A revision conflict means resume and inspect; it is not permission to overwrite another operation. A blocked mission needs a revised approach, not an invisible budget reset. Never claim a passing check that was not run, or treat a scripted fixture review as a real model review.
