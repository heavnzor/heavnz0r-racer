#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Racer } from "./engine.js";
import { planSchema, reviewSchema } from "./types.js";

const server = new McpServer({ name: "heavnz0r-racer", version: "0.1.0" });
const repo = z.string().describe("Absolute path to the user's Git repository or mission worktree");
const missionId = z.string().regex(/^r-[a-f0-9]{8}$/);
const revision = z.number().int().nonnegative().describe("Latest mission revision; stale writes are rejected");

async function use(path: string, work: (racer: Racer) => unknown | Promise<unknown>) {
  let racer: Racer | undefined;
  try {
    racer = new Racer(path);
    const result = await work(racer);
    const text = JSON.stringify(result, (key, value: unknown) =>
      key === "output" && typeof value === "string" && value.length > 8000 ? `[truncated; full output in local receipt]\n${value.slice(-8000)}` : value, 2);
    return { content: [{ type: "text" as const, text }] };
  } catch (error) {
    return { isError: true, content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }] };
  } finally { racer?.close(); }
}

server.registerTool("racer_start", {
  description: "Start an isolated development mission. Returns a worktree path; all mission edits belong there.",
  inputSchema: { repo, brief: z.string().min(5), kind: z.enum(["fix", "refactor", "review"]).default("fix"), base: z.string().optional(), maxAttempts: z.number().int().min(1).max(10).default(3) },
}, ({ repo, ...options }) => use(repo, (racer) => racer.start(options)));

server.registerTool("racer_resume", {
  description: "Read a mission, freshness of its evidence, recent events, and the next action. Start here after interruption.",
  inputSchema: { repo, missionId }, annotations: { readOnlyHint: true },
}, ({ repo, missionId }) => use(repo, (racer) => { const status = racer.resume(missionId); return { ...status, events: status.events.slice(-8) }; }));

server.registerTool("racer_plan", {
  description: "Propose an executable plan, allowed paths, acceptance criteria, check commands and located code evidence.",
  inputSchema: { repo, missionId, revision, plan: planSchema },
}, ({ repo, missionId, revision, plan }) => use(repo, (racer) => racer.plan(missionId, revision, plan)));

server.registerTool("racer_begin", {
  description: "Begin an accepted plan. Present the plan to the user first; this tool records acceptance, not authenticated human identity.",
  inputSchema: { repo, missionId, revision },
}, ({ repo, missionId, revision }) => use(repo, (racer) => racer.begin(missionId, revision)));

server.registerTool("racer_verify", {
  description: "Run the accepted check commands in the worktree; detect out-of-scope edits and diff drift. This executes project code.",
  inputSchema: { repo, missionId, revision },
}, ({ repo, missionId, revision }) => use(repo, (racer) => racer.verify(missionId, revision)));

server.registerTool("racer_review", {
  description: "Record an independent review of the exact verified diff. Changes requested require file/line evidence.",
  inputSchema: { repo, missionId, revision, review: reviewSchema },
}, ({ repo, missionId, revision, review }) => use(repo, (racer) => racer.review(missionId, revision, review)));

server.registerTool("racer_handoff", {
  description: "Export a patch, Markdown report, and JSON receipt after a fresh passing verification and review. Does not publish.",
  inputSchema: { repo, missionId, revision },
}, ({ repo, missionId, revision }) => use(repo, (racer) => racer.handoff(missionId, revision)));

server.registerTool("racer_list", {
  description: "List persisted missions for this repository.", inputSchema: { repo }, annotations: { readOnlyHint: true },
}, ({ repo }) => use(repo, (racer) => racer.store.list().map(({ id, kind, brief, stage, revision, updatedAt }) => ({ id, kind, brief, stage, revision, updatedAt }))));

await server.connect(new StdioServerTransport());
