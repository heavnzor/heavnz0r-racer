import type { Mission } from "./types.js";

export function markdownReport(mission: Mission, files: string[]): string {
  return [
    `# Racer · ${mission.id}`, "", mission.brief, "",
    `Base: \`${mission.baseSha}\``,
    `Diff SHA-256: \`${mission.verification?.fingerprint ?? "unverified"}\``, "",
    "## Accepted plan", "", mission.plan?.summary ?? "", "",
    ...(mission.plan?.criteria.map((criterion) => `- ${criterion.description} — checks: ${criterion.checks.join(", ")}`) ?? []),
    "", "## Changed files", "", ...files.map((file) => `- \`${file}\``), "",
    "## Verification", "",
    ...(mission.verification?.results.map((result) =>
      `- **${result.id}**: exit ${result.exitCode ?? "unknown"}; ${result.durationMs} ms${result.timedOut ? "; TIMED OUT" : ""}\n  - Command: \`${JSON.stringify(result.command)}\``) ?? []),
    "", "## Review", "",
    `Reviewer (client-reported): ${mission.review?.reviewer ?? "none"}`,
    `Verdict: ${mission.review?.verdict ?? "none"}`, "", mission.review?.summary ?? "", "",
    "This receipt binds recorded checks and review to a diff. It is not a proof of complete correctness or an authenticated reviewer identity.", "",
  ].join("\n");
}

export function pitwall(mission: Mission, fresh = true): string {
  const stages = ["recon", "plan", "build", "verify", "review", "handoff", "done"];
  const cells = stages.map((name) => name === mission.stage ? `[ ${name.toUpperCase()} ]` : name).join(" → ");
  const results = mission.verification?.results.map((result) =>
    `  ${result.exitCode === 0 && !result.timedOut ? "PASS" : "FAIL"}  ${result.id.padEnd(20)} ${result.durationMs} ms`).join("\n");
  return [
    "", "  HEAVNZ0R'RACER  /  PITWALL", "  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    `  ${mission.id}  ·  ${mission.kind}  ·  revision ${mission.revision}`,
    `  ${mission.brief}`, "", `  ${cells}`, "",
    `  Attempts   ${mission.attempts}/${mission.maxAttempts}`,
    `  Evidence   ${fresh ? mission.verification?.passed ? "verified" : "pending" : "STALE — diff changed"}`,
    `  Worktree   ${mission.worktree}`, results ?? "",
    mission.bundle ? `  Handoff    ${mission.bundle}` : "", "",
  ].filter((line) => line !== undefined).join("\n");
}
