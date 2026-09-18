import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { installOpenCode } from "../dist/install.js";
import { demo } from "../dist/demo.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("OpenCode installer merges unrelated configuration and is idempotent", (t) => {
  const target = mkdtempSync(join(tmpdir(), "racer-install-"));
  t.after(() => rmSync(target, { recursive: true, force: true }));
  mkdirSync(join(target, ".opencode"));
  writeFileSync(join(target, ".opencode", "opencode.json"), JSON.stringify({ model: "test/model", permission: { bash: "ask" }, mcp: { other: { enabled: false } } }));
  installOpenCode(target);
  const first = readFileSync(join(target, ".opencode", "opencode.json"), "utf8");
  installOpenCode(target);
  assert.equal(readFileSync(join(target, ".opencode", "opencode.json"), "utf8"), first);
  const config = JSON.parse(first);
  assert.equal(config.model, "test/model");
  assert.equal(config.permission.bash, "ask");
  assert.equal(config.mcp.racer.type, "local");
  assert.equal(config.mcp.other.enabled, false);
  assert.ok(existsSync(join(target, ".opencode", "skills", "racer", "SKILL.md")));
});

test("installer refuses a custom component before writing other files", (t) => {
  const target = mkdtempSync(join(tmpdir(), "racer-conflict-"));
  t.after(() => rmSync(target, { recursive: true, force: true }));
  mkdirSync(join(target, ".opencode", "agents"), { recursive: true });
  writeFileSync(join(target, ".opencode", "agents", "racer-reviewer.md"), "user work");
  assert.throws(() => installOpenCode(target), /would be overwritten/);
  assert.equal(existsSync(join(target, ".opencode", "opencode.json")), false);
  assert.equal(existsSync(join(target, ".opencode", "commands", "racer.md")), false);
});

test("offline demo produces a real regression receipt and rejects overwrites", async (t) => {
  const parent = mkdtempSync(join(tmpdir(), "racer-demo-test-"));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const target = join(parent, "demo");
  const mission = await demo(target, () => {});
  assert.equal(mission.stage, "done");
  assert.equal(mission.attempts, 2);
  const receipt = JSON.parse(readFileSync(join(mission.bundle, "receipt.json"), "utf8"));
  assert.equal(receipt.verification.passed, true);
  assert.equal(receipt.review.reviewer, "offline-demo-fixture");
  await assert.rejects(demo(target, () => {}), /already exists/);
});

test("MCP stdio handshake, tool schemas and errors are protocol-compatible", async () => {
  const transport = new StdioClientTransport({ command: process.execPath, args: [join(root, "dist", "mcp.js")], stderr: "pipe" });
  const client = new Client({ name: "racer-contract-test", version: "1.0.0" });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.equal(tools.length, 8);
    const plan = tools.find(tool => tool.name === "racer_plan");
    assert.ok(plan.inputSchema.required.includes("revision"));
    const result = await client.callTool({ name: "racer_list", arguments: { repo: "/racer-path-that-does-not-exist" } });
    assert.equal(result.isError, true);
  } finally { await client.close(); }
});
