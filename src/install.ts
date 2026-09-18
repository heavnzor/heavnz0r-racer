import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function installOpenCode(target: string) {
  const root = resolve(target);
  const configPath = join(root, ".opencode", "opencode.json");
  if (existsSync(join(root, ".opencode", "opencode.jsonc"))) {
    throw new Error("An .opencode/opencode.jsonc exists. Merge the documented MCP entry manually to preserve its comments.");
  }
  const config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf8")) : {};
  if (typeof config !== "object" || config === null || Array.isArray(config)) throw new Error("OpenCode config must be an object");
  const entry = { type: "local", command: [process.execPath, join(packageRoot, "dist", "mcp.js")], enabled: true };
  if (config.mcp?.racer && JSON.stringify(config.mcp.racer) !== JSON.stringify(entry)) {
    throw new Error("An MCP entry named racer already exists; merge it manually");
  }
  const files = [
    ["integrations/opencode/commands/racer.md", ".opencode/commands/racer.md"],
    ["integrations/opencode/skills/racer/SKILL.md", ".opencode/skills/racer/SKILL.md"],
    ...["scout", "test-writer", "builder", "reviewer"].map((role) =>
      [`integrations/opencode/agents/racer-${role}.md`, `.opencode/agents/racer-${role}.md`]),
  ];
  const pending = files.map(([source, destination]) => {
    const content = readFileSync(join(packageRoot, source!), "utf8");
    const path = join(root, destination!);
    if (existsSync(path) && readFileSync(path, "utf8") !== content) {
      throw new Error(`Existing custom file would be overwritten: ${path}`);
    }
    return { path, content };
  });
  // Preflight every conflict before writing any component.
  for (const file of pending) {
    mkdirSync(dirname(file.path), { recursive: true });
    writeFileSync(file.path, file.content);
  }
  config.$schema ??= "https://opencode.ai/config.json";
  config.mcp = { ...config.mcp, racer: entry };
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  return { configPath, files: pending.map((file) => file.path), next: "Quit and restart OpenCode, then run /racer <your task>." };
}
