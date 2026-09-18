import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import type { Check, CheckResult } from "./types.js";

export function git(repo: string, args: string[], env?: NodeJS.ProcessEnv): string {
  return execFileSync("git", args, {
    cwd: repo, encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"],
  }).trimEnd();
}

export function repository(path: string): { root: string; stateDir: string } {
  const root = git(resolve(path), ["rev-parse", "--show-toplevel"]);
  const common = git(root, ["rev-parse", "--git-common-dir"]);
  const stateDir = join(isAbsolute(common) ? common : resolve(root, common), "racer");
  mkdirSync(stateDir, { recursive: true });
  return { root, stateDir };
}

export function snapshot(worktree: string, baseSha: string, stateDir: string) {
  const index = join(stateDir, `index-${randomUUID()}`);
  const env = { GIT_INDEX_FILE: index };
  try {
    git(worktree, ["read-tree", "HEAD"], env);
    git(worktree, ["add", "--all", "--", "."], env);
    const patch = execFileSync("git", ["diff", "--cached", "--binary", "--no-ext-diff", baseSha, "--"], {
      cwd: worktree, env: { ...process.env, ...env }, maxBuffer: 32 * 1024 * 1024,
    }).toString("utf8");
    const files = git(worktree, ["diff", "--cached", "--name-only", "-z", baseSha, "--"], env)
      .split("\0").filter(Boolean);
    return { patch, files, fingerprint: createHash("sha256").update(patch).digest("hex") };
  } finally {
    rmSync(index, { force: true });
    rmSync(`${index}.lock`, { force: true });
  }
}

export async function runCheck(check: Check, cwd: string): Promise<CheckResult> {
  const started = performance.now();
  const [executable, ...args] = check.command;
  if (!executable) throw new Error("A check needs an executable");
  return new Promise((resolveResult) => {
    const env = { ...process.env };
    // A parent Node test runner marks its workers. Inheriting that marker can
    // make a nested `node --test` skip execution and incorrectly return success.
    delete env.NODE_TEST_CONTEXT;
    const child = spawn(executable, args, {
      cwd, env, shell: false, detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let timedOut = false;
    let truncated = false;
    let killTimer: NodeJS.Timeout | undefined;
    const append = (data: Buffer) => {
      output += data.toString();
      if (output.length > 128_000) { output = output.slice(-128_000); truncated = true; }
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.on("error", (error) => append(Buffer.from(error.message)));
    const kill = (signal: NodeJS.Signals) => {
      try {
        if (process.platform !== "win32" && child.pid) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch { /* Process may have already exited. */ }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill("SIGTERM");
      killTimer = setTimeout(() => kill("SIGKILL"), 250);
    }, check.timeoutMs);
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      resolveResult({
        id: check.id, command: check.command, exitCode, timedOut,
        output: `${truncated ? "[earlier output truncated]\n" : ""}${output}`,
        durationMs: Math.round(performance.now() - started),
      });
    });
  });
}
