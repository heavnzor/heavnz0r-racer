import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { z } from "zod";
import { git, repository, runCheck, snapshot } from "./git.js";
import { Store } from "./store.js";
import { planSchema, reviewSchema, type CheckResult, type Mission, type Plan, type Stage } from "./types.js";
import { markdownReport } from "./report.js";

const startSchema = z.object({
  kind: z.enum(["fix", "refactor", "review"]).default("fix"),
  brief: z.string().min(5).max(10_000),
  base: z.string().min(1).optional(),
  maxAttempts: z.number().int().min(1).max(10).default(3),
});

function stage(mission: Mission, allowed: Stage[]) {
  if (!allowed.includes(mission.stage)) throw new Error(`Cannot proceed from ${mission.stage}; expected ${allowed.join(" or ")}`);
}

export class Racer {
  readonly root: string;
  readonly store: Store;

  constructor(path = process.cwd()) {
    const repo = repository(path);
    this.root = repo.root;
    this.store = new Store(repo.stateDir);
  }

  close() { this.store.close(); }

  start(input: z.input<typeof startSchema>): Mission {
    const options = startSchema.parse(input);
    if (options.kind === "review" && !options.base) {
      throw new Error("Branch reviews need a base ref, for example --base main. Commit the branch changes before starting.");
    }
    if (options.kind === "review" && git(this.root, ["status", "--porcelain"])) {
      throw new Error("A branch review requires a clean working tree; commit or stash changes first.");
    }
    const baseSha = git(this.root, ["rev-parse", "--verify", `${options.base ?? "HEAD"}^{commit}`]);
    const id = `r-${randomUUID().slice(0, 8)}`;
    const branch = `racer/${id}`;
    const worktree = join(this.store.directory, "worktrees", id);
    mkdirSync(join(this.store.directory, "worktrees"), { recursive: true });
    git(this.root, ["worktree", "add", "-b", branch, worktree, options.kind === "review" ? "HEAD" : baseSha]);
    const now = new Date().toISOString();
    const mission: Mission = {
      schemaVersion: 1, id, revision: 0, kind: options.kind, brief: options.brief,
      repo: this.root, worktree, branch, baseSha, stage: "recon",
      createdAt: now, updatedAt: now, attempts: 0, maxAttempts: options.maxAttempts,
    };
    this.store.create(mission);
    return mission;
  }

  plan(id: string, revision: number, input: unknown): Mission {
    const plan = planSchema.parse(input);
    return this.store.update(id, revision, "plan.proposed", (mission) => {
      stage(mission, ["recon", "plan"]);
      this.validateEvidence(mission, plan.evidence);
      mission.plan = plan;
      mission.stage = "plan";
      return plan;
    });
  }

  begin(id: string, revision: number): Mission {
    return this.store.update(id, revision, "plan.accepted", (mission) => {
      stage(mission, ["plan"]);
      if (!mission.plan) throw new Error("Propose a plan first");
      mission.stage = "build";
      return { criteria: mission.plan.criteria.length };
    });
  }

  async verify(id: string, revision: number): Promise<Mission> {
    const started = this.store.update(id, revision, "verification.started", (mission) => {
      stage(mission, ["build", "verify", "review", "handoff", "done"]);
      if (mission.publishedUrl) throw new Error("This mission was published. Start a new mission for follow-up changes.");
      if (!mission.plan) throw new Error("Missing plan");
      if (mission.attempts >= mission.maxAttempts) throw new Error("Attempt budget exhausted. Preserve this run and start a new mission with a revised plan.");
      const current = snapshot(mission.worktree, mission.baseSha, this.store.directory);
      this.validateScope(mission.plan, current.files);
      if (!current.files.length) throw new Error("No changes to verify against the mission base");
      mission.stage = "verify";
      mission.attempts++;
      delete mission.verification;
      delete mission.review;
      delete mission.bundle;
      return { fingerprint: current.fingerprint, attempt: mission.attempts };
    });
    const before = snapshot(started.worktree, started.baseSha, this.store.directory);
    const results: CheckResult[] = [];
    for (const check of started.plan!.checks) results.push(await runCheck(check, started.worktree));
    const after = snapshot(started.worktree, started.baseSha, this.store.directory);
    return this.store.update(id, started.revision, "verification.finished", (mission) => {
      const passed = results.every((result) => result.exitCode === 0 && !result.timedOut) &&
        before.fingerprint === after.fingerprint;
      mission.verification = { fingerprint: before.fingerprint, results, passed };
      mission.stage = passed ? "review" : mission.attempts >= mission.maxAttempts ? "blocked" : "build";
      return { passed, drift: before.fingerprint !== after.fingerprint, results };
    });
  }

  review(id: string, revision: number, input: unknown): Mission {
    const review = reviewSchema.parse(input);
    return this.store.update(id, revision, "review.recorded", (mission) => {
      stage(mission, ["review"]);
      const current = this.requireFreshVerification(mission);
      this.validateEvidence(mission, review.findings);
      mission.review = { ...review, fingerprint: current.fingerprint };
      mission.stage = review.verdict === "pass" ? "handoff" :
        mission.attempts >= mission.maxAttempts ? "blocked" : "build";
      return review;
    });
  }

  handoff(id: string, revision: number): Mission {
    const current = this.store.get(id);
    if (current.stage === "done" && current.bundle) {
      if (current.revision !== revision) throw new Error("Revision conflict; resume before retrying");
      this.requireFreshVerification(current);
      return current;
    }
    return this.store.update(id, revision, "handoff.created", (mission) => {
      stage(mission, ["handoff"]);
      const snap = this.requireFreshVerification(mission);
      if (mission.review?.verdict !== "pass" || mission.review.fingerprint !== snap.fingerprint) {
        throw new Error("An independent passing review of this exact diff is required");
      }
      const bundle = join(this.store.directory, "bundles", id, String(mission.revision + 1));
      mkdirSync(bundle, { recursive: true });
      writeFileSync(join(bundle, "change.patch"), snap.patch);
      writeFileSync(join(bundle, "report.md"), markdownReport(mission, snap.files));
      writeFileSync(join(bundle, "receipt.json"), JSON.stringify({
        schema: "racer.receipt/v1", missionId: id, baseSha: mission.baseSha,
        fingerprint: snap.fingerprint, files: snap.files,
        criteria: mission.plan!.criteria, verification: mission.verification,
        review: mission.review,
      }, null, 2) + "\n");
      mission.stage = "done";
      mission.bundle = bundle;
      return { bundle, fingerprint: snap.fingerprint };
    });
  }

  resume(id: string) {
    const mission = this.store.get(id);
    const snap = snapshot(mission.worktree, mission.baseSha, this.store.directory);
    const fresh = !mission.verification || mission.verification.fingerprint === snap.fingerprint;
    const next = !fresh ? "The diff changed after verification. Run verification again before review or handoff." : {
      recon: "Explore the worktree; propose a located plan with check commands.",
      plan: "Present the plan, then begin the accepted mission.",
      build: "Implement the scoped change, then run verification.",
      verify: "A verification was interrupted or is running. Rerun after the existing process stops.",
      review: "Delegate an independent review of this verified diff.",
      handoff: "Export the reviewed diff and evidence receipt.",
      done: "The local handoff is ready. Publish explicitly when desired.",
      blocked: "The attempt budget is exhausted. Inspect evidence and revise the approach.",
    }[mission.stage];
    return { mission, fresh, files: snap.files, fingerprint: snap.fingerprint, next, events: this.store.events(id) };
  }

  requireFreshVerification(mission: Mission) {
    const current = snapshot(mission.worktree, mission.baseSha, this.store.directory);
    if (!mission.verification?.passed || mission.verification.fingerprint !== current.fingerprint) {
      throw new Error("Verification is missing, failed, or stale. Verify the current diff first.");
    }
    return current;
  }

  private validateScope(plan: Plan, files: string[]) {
    const outside = files.filter((file) => !plan.scope.some((scope) => {
      const prefix = scope.replace(/\/$/, "");
      return file === prefix || file.startsWith(`${prefix}/`);
    }));
    if (outside.length) throw new Error(`Changes outside the accepted scope: ${outside.join(", ")}`);
  }

  private validateEvidence(mission: Mission, evidence: Plan["evidence"]) {
    for (const item of evidence) {
      const file = realpathSync(join(mission.worktree, item.path));
      const rel = relative(realpathSync(mission.worktree), file);
      if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("Evidence must resolve inside the worktree");
      const lines = readFileSync(file, "utf8").split("\n").length;
      if (item.line > lines) throw new Error(`Evidence line ${item.line} is outside ${item.path}`);
    }
  }
}
