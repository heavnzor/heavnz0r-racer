import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Racer, Store, runCheck } from "../dist/index.js";

const pass = { reviewer: "independent-test-reviewer", verdict: "pass", summary: "The boundary behavior is covered by the regression and the scoped fix.", findings: [] };

function fixture(t, maxAttempts = 3) {
  const root = mkdtempSync(join(tmpdir(), "racer-test-"));
  const git = (...args) => execFileSync("git", args, { cwd: root, stdio: "pipe" }).toString().trim();
  git("init", "-b", "main");
  writeFileSync(join(root, "calc.mjs"), "export const twice = x => x;\n");
  writeFileSync(join(root, ".gitignore"), "ignored/\n");
  git("add", ".");
  git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "fixture");
  const racer = new Racer(root);
  t.after(() => { racer.close(); rmSync(root, { recursive: true, force: true }); });
  let mission = racer.start({ brief: "Make twice return double its input", maxAttempts });
  const plan = {
    summary: "Correct the multiplier and add a behavioral regression.",
    scope: ["calc.mjs", "calc.test.mjs"],
    criteria: [{ description: "The function doubles positive and zero inputs", checks: ["regression"] }],
    checks: [{ id: "regression", command: [process.execPath, "--test", "calc.test.mjs"], timeoutMs: 5000 }],
    evidence: [{ path: "calc.mjs", line: 1, note: "The function returns the input unchanged." }],
  };
  const begin = () => {
    mission = racer.plan(mission.id, mission.revision, plan);
    mission = racer.begin(mission.id, mission.revision);
    writeFileSync(join(mission.worktree, "calc.test.mjs"), 'import assert from "node:assert/strict";\nimport { twice } from "./calc.mjs";\nassert.equal(twice(3), 6);\nassert.equal(twice(0), 0);\n');
    return mission;
  };
  const fix = () => writeFileSync(join(mission.worktree, "calc.mjs"), "export const twice = x => x * 2;\n");
  return { root, racer, mission, plan, begin, fix, git };
}

test("real Git workflow records red → green → review → idempotent handoff", async (t) => {
  const f = fixture(t);
  let m = f.begin();
  m = await f.racer.verify(m.id, m.revision);
  assert.equal(m.stage, "build");
  assert.equal(m.verification.passed, false);
  assert.match(m.verification.results[0].output, /AssertionError/);
  f.fix();
  m = await f.racer.verify(m.id, m.revision);
  assert.equal(m.stage, "review");
  m = f.racer.review(m.id, m.revision, pass);
  m = f.racer.handoff(m.id, m.revision);
  assert.equal(m.stage, "done");
  const receipt = JSON.parse(readFileSync(join(m.bundle, "receipt.json"), "utf8"));
  assert.equal(receipt.fingerprint, m.verification.fingerprint);
  assert.deepEqual(receipt.files, ["calc.mjs", "calc.test.mjs"]);
  assert.match(readFileSync(join(m.bundle, "change.patch"), "utf8"), /new file mode/);
  assert.equal(f.racer.handoff(m.id, m.revision).revision, m.revision);
  assert.equal(readFileSync(join(f.root, "calc.mjs"), "utf8"), "export const twice = x => x;\n");
  assert.equal(f.git("status", "--porcelain"), "");
});

test("state and event journal survive a second process connection", (t) => {
  const f = fixture(t);
  const m = f.begin();
  const second = new Racer(f.root);
  try {
    assert.equal(second.resume(m.id).mission.stage, "build");
    assert.deepEqual(second.store.events(m.id).map(e => e.type), ["mission.started", "plan.proposed", "plan.accepted"]);
    assert.throws(() => second.begin(m.id, 0), /Revision conflict/);
    assert.equal(second.store.get(m.id).revision, m.revision);
  } finally { second.close(); }
});

test("check references, evidence and stage order are validated atomically", (t) => {
  const f = fixture(t);
  assert.throws(() => f.racer.begin(f.mission.id, 0), /expected plan/);
  assert.throws(() => f.racer.plan(f.mission.id, 0, { ...f.plan, criteria: [{ description: "Valid criterion", checks: ["invented"] }] }), /declared checks/);
  assert.throws(() => f.racer.plan(f.mission.id, 0, { ...f.plan, evidence: [{ path: "calc.mjs", line: 999, note: "Invented evidence line" }] }), /outside/);
  assert.equal(f.racer.store.get(f.mission.id).revision, 0);
  assert.equal(f.racer.store.events(f.mission.id).length, 1);
});

test("scope enforcement includes newly created untracked files", async (t) => {
  const f = fixture(t);
  const m = f.begin();
  f.fix();
  writeFileSync(join(m.worktree, "surprise.txt"), "unexpected");
  await assert.rejects(f.racer.verify(m.id, m.revision), /outside the accepted scope: surprise.txt/);
  assert.equal(f.racer.store.get(m.id).attempts, 0);
});

test("ignored build artifacts do not invalidate a verified diff", async (t) => {
  const f = fixture(t);
  let m = f.begin(); f.fix();
  m = await f.racer.verify(m.id, m.revision);
  mkdirSync(join(m.worktree, "ignored"));
  writeFileSync(join(m.worktree, "ignored", "build"), "artifact");
  assert.equal(f.racer.resume(m.id).fresh, true);
  assert.equal(f.racer.review(m.id, m.revision, pass).stage, "handoff");
});

test("edits after tests invalidate both review and handoff", async (t) => {
  const f = fixture(t);
  let m = f.begin(); f.fix();
  m = await f.racer.verify(m.id, m.revision);
  m = f.racer.review(m.id, m.revision, pass);
  writeFileSync(join(m.worktree, "calc.mjs"), "export const twice = x => x * 3;\n");
  assert.equal(f.racer.resume(m.id).fresh, false);
  assert.throws(() => f.racer.handoff(m.id, m.revision), /stale/);
});

test("a handed-off mission can be reverified after a local revision", async (t) => {
  const f = fixture(t);
  let m = f.begin(); f.fix();
  m = await f.racer.verify(m.id, m.revision);
  m = f.racer.review(m.id, m.revision, pass);
  m = f.racer.handoff(m.id, m.revision);
  writeFileSync(join(m.worktree, "calc.mjs"), "// equivalent implementation\nexport const twice = x => 2 * x;\n");
  assert.throws(() => f.racer.handoff(m.id, m.revision), /stale/);
  m = await f.racer.verify(m.id, m.revision);
  assert.equal(m.stage, "review");
  assert.equal(m.review, undefined);
});

test("checks that modify source cannot certify their resulting diff", async (t) => {
  const f = fixture(t);
  const plan = { ...f.plan, checks: [{ id: "regression", command: [process.execPath, "-e", "require('node:fs').appendFileSync('calc.mjs', '// modified by check\\n')"], timeoutMs: 5000 }] };
  let m = f.racer.plan(f.mission.id, 0, plan);
  m = f.racer.begin(m.id, m.revision);
  f.fix();
  m = await f.racer.verify(m.id, m.revision);
  assert.equal(m.verification.results[0].exitCode, 0);
  assert.equal(m.verification.passed, false);
  assert.equal(f.racer.store.events(m.id).at(-1).details.drift, true);
});

test("attempt exhaustion preserves a blocked mission and evidence", async (t) => {
  const f = fixture(t, 1);
  let m = f.begin();
  m = await f.racer.verify(m.id, m.revision);
  assert.equal(m.stage, "blocked");
  assert.match(f.racer.resume(m.id).next, /budget/);
  await assert.rejects(f.racer.verify(m.id, m.revision), /Cannot proceed/);
});

test("independent review findings route back to build and invalidate old review", async (t) => {
  const f = fixture(t);
  let m = f.begin(); f.fix();
  m = await f.racer.verify(m.id, m.revision);
  assert.throws(() => f.racer.review(m.id, m.revision, { ...pass, verdict: "changes_requested" }), /located findings/);
  m = f.racer.review(m.id, m.revision, {
    ...pass, verdict: "changes_requested", findings: [{ path: "calc.test.mjs", line: 3, note: "The requested negative-input boundary is not covered." }],
  });
  assert.equal(m.stage, "build");
  assert.throws(() => f.racer.handoff(m.id, m.revision), /Cannot proceed/);
});

test("symlink evidence cannot read outside the worktree", (t) => {
  const f = fixture(t);
  symlinkSync(join(f.root, "calc.mjs"), join(f.mission.worktree, "outside"));
  assert.throws(() => f.racer.plan(f.mission.id, 0, { ...f.plan, evidence: [{ path: "outside", line: 1, note: "Source outside this worktree" }] }), /inside the worktree/);
});

test("check runner reports missing executables and kills timeouts", async (t) => {
  const f = fixture(t);
  const missing = await runCheck({ id: "missing", command: ["racer-nonexistent-command"], timeoutMs: 1000 }, f.root);
  assert.notEqual(missing.exitCode, 0);
  assert.match(missing.output, /ENOENT/);
  const timeout = await runCheck({ id: "timeout", command: [process.execPath, "-e", "setInterval(() => {}, 1000)"], timeoutMs: 100 }, f.root);
  assert.equal(timeout.timedOut, true);
  assert.notEqual(timeout.exitCode, 0);
});

test("branch reviews require committed changes and never alter the original index", (t) => {
  const f = fixture(t);
  assert.throws(() => f.racer.start({ kind: "review", brief: "Review this branch" }), /base ref/);
  writeFileSync(join(f.root, "calc.mjs"), "export const twice = x => x * 2;\n");
  assert.throws(() => f.racer.start({ kind: "review", brief: "Review this branch", base: "main" }), /clean working tree/);
});

test("store transactions roll back a failed mutation and its event", (t) => {
  const f = fixture(t);
  const store = new Store(f.racer.store.directory);
  try {
    assert.throws(() => store.update(f.mission.id, 0, "bad", (m) => { m.stage = "done"; throw new Error("rollback"); }), /rollback/);
    assert.equal(store.get(f.mission.id).stage, "recon");
    assert.equal(store.events(f.mission.id).length, 1);
  } finally { store.close(); }
});
