import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Racer } from "../dist/index.js";
import { demo } from "../dist/demo.js";
import { publish } from "../dist/publish.js";

test("explicit publication pushes the verified branch and retries without duplicate PR creation", async (t) => {
  const parent = mkdtempSync(join(tmpdir(), "racer-publish-"));
  const original = { ...process.env };
  let racer;
  t.after(() => {
    racer?.close();
    for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
    Object.assign(process.env, original);
    rmSync(parent, { recursive: true, force: true });
  });
  Object.assign(process.env, {
    GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid",
    GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid",
    GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1",
  });
  const repo = join(parent, "repo");
  const mission = await demo(repo, () => {});
  const remote = join(parent, "remote.git");
  execFileSync("git", ["init", "--bare", remote], { stdio: "pipe" });
  execFileSync("git", ["remote", "add", "origin", remote], { cwd: repo, stdio: "pipe" });
  const bin = join(parent, "bin");
  mkdirSync(bin);
  const count = join(parent, "created.txt");
  const executable = join(bin, "gh");
  writeFileSync(executable, `#!/usr/bin/env node
import { appendFileSync, existsSync } from 'node:fs';
const args = process.argv.slice(2);
if (args[0] === 'repo') console.log('fixture/project');
else if (args[1] === 'list') console.log(existsSync(${JSON.stringify(count)}) ? '[{"url":"https://github.com/fixture/project/pull/1"}]' : '[]');
else if (args[1] === 'create') { appendFileSync(${JSON.stringify(count)}, 'created\\n'); console.log('https://github.com/fixture/project/pull/1'); }
else process.exit(2);
`);
  chmodSync(executable, 0o755);
  process.env.PATH = `${bin}:${original.PATH}`;
  racer = new Racer(repo);
  assert.throws(() => publish(racer, mission.id, false), /--confirm/);
  const result = publish(racer, mission.id, true);
  assert.equal(result.publishedUrl, "https://github.com/fixture/project/pull/1");
  const pushed = execFileSync("git", ["--git-dir", remote, "show", `${mission.branch}:cart.mjs`], { encoding: "utf8" });
  assert.match(pushed, /line.unitCents \* line.quantity/);
  assert.equal(publish(racer, mission.id, true).revision, result.revision);
  assert.equal(readFileSync(count, "utf8"), "created\n");
});

test("publication rejects a changed diff before any remote operation", async (t) => {
  const parent = mkdtempSync(join(tmpdir(), "racer-stale-publish-"));
  const repo = join(parent, "repo");
  const mission = await demo(repo, () => {});
  const racer = new Racer(repo);
  t.after(() => { racer.close(); rmSync(parent, { recursive: true, force: true }); });
  writeFileSync(join(mission.worktree, "cart.mjs"), "export const subtotal = () => 0;\n");
  assert.throws(() => publish(racer, mission.id, true), /stale/);
  assert.equal(racer.store.get(mission.id).publishedUrl, undefined);
});
