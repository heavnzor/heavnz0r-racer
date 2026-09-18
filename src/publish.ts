import { execFileSync } from "node:child_process";
import { join } from "node:path";
import type { Racer } from "./engine.js";
import { git } from "./git.js";

export function publish(racer: Racer, id: string, confirmed: boolean) {
  if (!confirmed) throw new Error("Publishing writes to GitHub. Pass --confirm after inspecting the handoff.");
  const mission = racer.store.get(id);
  if (mission.publishedUrl) return mission;
  if (mission.stage !== "done" || !mission.bundle) throw new Error("Create a reviewed handoff before publishing");
  if (mission.kind === "review") throw new Error("Review missions export findings; they do not publish implementation branches");
  const snap = racer.requireFreshVerification(mission);
  if (mission.review?.fingerprint !== snap.fingerprint) throw new Error("Review is stale");
  if (git(mission.worktree, ["branch", "--show-current"]) !== mission.branch) throw new Error("Mission branch changed");
  const gh = (args: string[]) => execFileSync("gh", args, {
    cwd: mission.worktree, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000,
  }).trim();
  // Resolve and authenticate before making a commit. gh uses this worktree's origin.
  const remote = gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]);
  git(mission.worktree, ["add", "--all", "--", "."]);
  if (git(mission.worktree, ["diff", "--cached", "--name-only"])) {
    git(mission.worktree, ["commit", "-m", `${mission.kind}: ${mission.brief.replace(/\s+/g, " ").slice(0, 100)}`]);
  }
  // Commit hooks can change files. Never push a diff that differs from the receipt.
  racer.requireFreshVerification(mission);
  git(mission.worktree, ["push", "--set-upstream", "origin", mission.branch]);
  const existing = JSON.parse(gh([
    "pr", "list", "--repo", remote, "--head", mission.branch, "--state", "open", "--json", "url", "--limit", "1",
  ])) as { url: string }[];
  const url = existing[0]?.url ?? gh([
    "pr", "create", "--repo", remote, "--draft", "--head", mission.branch,
    "--title", mission.brief.slice(0, 200), "--body-file", join(mission.bundle, "report.md"),
  ]);
  return racer.store.update(id, mission.revision, "publication.completed", (state) => {
    state.publishedUrl = url;
    return { url, remote };
  });
}
