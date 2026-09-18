import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Racer } from "./engine.js";
import { pitwall } from "./report.js";

export async function demo(output: string, log: (text: string) => void = console.log) {
  const root = resolve(output);
  if (existsSync(root)) throw new Error(`Demo output already exists: ${root}. Choose a fresh --output directory.`);
  mkdirSync(root, { recursive: true });
  const git = (args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  git(["init", "-b", "main"]);
  writeFileSync(join(root, "cart.mjs"), "export function subtotal(lines) {\n  return lines.reduce((sum, line) => sum + line.unitCents, 0);\n}\n");
  git(["add", "cart.mjs"]);
  git(["-c", "user.name=Racer Demo", "-c", "user.email=demo@example.invalid", "commit", "-m", "Add cart fixture"]);
  const racer = new Racer(root);
  try {
    log("OFFLINE FIXTURE DEMO · real Git + real tests · no model calls");
    let mission = racer.start({ brief: "Fix cart totals for line-item quantities", kind: "fix" });
    mission = racer.plan(mission.id, mission.revision, {
      summary: "Multiply unit prices by quantities and protect empty carts with regression tests.",
      scope: ["cart.mjs", "cart.test.mjs"],
      criteria: [{ description: "Totals account for quantities and empty carts", checks: ["cart-tests"] }],
      checks: [{ id: "cart-tests", command: [process.execPath, "--test", "cart.test.mjs"] }],
      evidence: [{ path: "cart.mjs", line: 2, note: "The reducer ignores line.quantity." }],
    });
    mission = racer.begin(mission.id, mission.revision);
    writeFileSync(join(mission.worktree, "cart.test.mjs"), [
      'import test from "node:test";', 'import assert from "node:assert/strict";',
      'import { subtotal } from "./cart.mjs";',
      'test("quantities", () => assert.equal(subtotal([{ unitCents: 1200, quantity: 2 }]), 2400));',
      'test("empty cart", () => assert.equal(subtotal([]), 0));', "",
    ].join("\n"));
    mission = await racer.verify(mission.id, mission.revision);
    if (mission.verification?.passed) throw new Error("The regression test should fail before the fix");
    log("01 / RED       quantity regression reproduced (1200 ≠ 2400)");
    writeFileSync(join(mission.worktree, "cart.mjs"), "export function subtotal(lines) {\n  return lines.reduce((sum, line) => sum + line.unitCents * line.quantity, 0);\n}\n");
    mission = await racer.verify(mission.id, mission.revision);
    log("02 / GREEN     regression + empty-cart checks passed");
    mission = racer.review(mission.id, mission.revision, {
      reviewer: "offline-demo-fixture", verdict: "pass", findings: [],
      summary: "Fixture review: the scoped reducer multiplies quantity once; regression and empty-cart behavior are covered. This scripted review is not an LLM evaluation.",
    });
    mission = racer.handoff(mission.id, mission.revision);
    log("03 / RECEIPT   patch + check results + review bound to a SHA-256 diff");
    log(pitwall(mission));
    return mission;
  } finally { racer.close(); }
}
