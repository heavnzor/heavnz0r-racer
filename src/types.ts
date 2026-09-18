import { z } from "zod";

export const relativePath = z.string().min(1).max(500).refine(
  (value) => !value.startsWith("/") && !value.includes("\\") &&
    !value.split("/").some((part) => part === ".." || part === ".git") &&
    !/[\x00-\x1f]/.test(value),
  "Use a repository-relative path without traversal or .git components",
);

export const evidenceSchema = z.object({
  path: relativePath,
  line: z.number().int().positive(),
  note: z.string().min(5).max(2000),
});

export const checkSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
  command: z.array(z.string().min(1)).min(1).max(30),
  timeoutMs: z.number().int().min(100).max(300_000).default(30_000),
});

export const planSchema = z.object({
  summary: z.string().min(10).max(10_000),
  scope: z.array(relativePath).min(1).max(100),
  criteria: z.array(z.object({
    description: z.string().min(5),
    checks: z.array(z.string()).min(1),
  })).min(1).max(50),
  checks: z.array(checkSchema).min(1).max(20),
  evidence: z.array(evidenceSchema).min(1).max(50),
}).superRefine((plan, ctx) => {
  const ids = new Set(plan.checks.map((check) => check.id));
  if (ids.size !== plan.checks.length) {
    ctx.addIssue({ code: "custom", message: "Check IDs must be unique" });
  }
  for (const criterion of plan.criteria) {
    if (criterion.checks.some((id) => !ids.has(id))) {
      ctx.addIssue({ code: "custom", message: "Every criterion must reference declared checks" });
    }
  }
});

export const reviewSchema = z.object({
  reviewer: z.string().min(1).max(100),
  verdict: z.enum(["pass", "changes_requested"]),
  summary: z.string().min(10).max(10_000),
  findings: z.array(evidenceSchema).max(100),
}).superRefine((review, ctx) => {
  if (review.verdict === "pass" && review.findings.length) {
    ctx.addIssue({ code: "custom", message: "A passing review cannot contain unresolved findings" });
  }
  if (review.verdict === "changes_requested" && !review.findings.length) {
    ctx.addIssue({ code: "custom", message: "Requested changes require located findings" });
  }
});

export type Plan = z.infer<typeof planSchema>;
export type Review = z.infer<typeof reviewSchema> & { fingerprint: string };
export type Check = z.infer<typeof checkSchema>;
export type CheckResult = {
  id: string;
  command: string[];
  exitCode: number | null;
  timedOut: boolean;
  output: string;
  durationMs: number;
};
export type Stage = "recon" | "plan" | "build" | "verify" | "review" | "handoff" | "done" | "blocked";
export type Mission = {
  schemaVersion: 1;
  id: string;
  revision: number;
  kind: "fix" | "refactor" | "review";
  brief: string;
  repo: string;
  worktree: string;
  branch: string;
  baseSha: string;
  stage: Stage;
  createdAt: string;
  updatedAt: string;
  maxAttempts: number;
  attempts: number;
  plan?: Plan;
  verification?: { fingerprint: string; results: CheckResult[]; passed: boolean };
  review?: Review;
  bundle?: string;
  publishedUrl?: string;
};
export type Event = {
  sequence: number;
  at: string;
  type: string;
  details: unknown;
};
