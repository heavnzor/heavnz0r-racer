import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installOpenCode, packageRoot } from "../dist/install.js";

const target = mkdtempSync(join(tmpdir(), "racer-clients-"));
try {
  execFileSync("claude", ["plugin", "validate", packageRoot], { encoding: "utf8", stdio: "pipe", timeout: 30_000 });
  console.log("PASS Claude Code: plugin manifest validation");
  installOpenCode(target);
  const raw = execFileSync("opencode", ["debug", "config"], {
    cwd: target, encoding: "utf8", timeout: 60_000, maxBuffer: 16 * 1024 * 1024,
    env: {
      ...process.env, OPENCODE_PURE: "1", OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
      XDG_DATA_HOME: join(target, "xdg-data"), XDG_CONFIG_HOME: join(target, "xdg-config"),
      XDG_CACHE_HOME: join(target, "xdg-cache"), XDG_STATE_HOME: join(target, "xdg-state"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const config = JSON.parse(raw);
  if (config.mcp?.racer?.type !== "local" || !config.command?.racer || !config.agent?.["racer-reviewer"]) {
    throw new Error("OpenCode did not load the expected Racer MCP, command, and reviewer");
  }
  console.log("PASS OpenCode: native config parser loaded MCP, command and reviewer");
  console.log("These checks validate client loading, not model decision quality.");
} finally { rmSync(target, { recursive: true, force: true }); }
