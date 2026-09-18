#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { Racer } from "./engine.js";
import { demo } from "./demo.js";
import { installOpenCode } from "./install.js";
import { publish } from "./publish.js";
import { pitwall } from "./report.js";
import type { Mission } from "./types.js";

const help = `heavnz0r'Racer — evidence-driven development missions

  racer start "task" [--kind fix|refactor|review] [--base main]
  racer plan ID --file plan.json
  racer begin ID
  racer verify ID
  racer review ID --file review.json
  racer handoff ID
  racer resume ID                  resume with persisted evidence and next action
  racer status ID                  show the Pitwall
  racer list                      list local missions
  racer events ID                 show the event journal
  racer publish ID --confirm      commit, push, and open a draft GitHub PR
  racer install-opencode --repo /path/to/project
  racer demo [--output .racer-demo]

Options: --repo PATH, --json, --revision N, --budget N, --help
Model execution belongs to OpenCode or Claude Code; this CLI owns state and tools.
`;

try {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      repo: { type: "string", default: process.cwd() }, kind: { type: "string", default: "fix" },
      base: { type: "string" }, file: { type: "string" }, revision: { type: "string" },
      budget: { type: "string", default: "3" }, output: { type: "string", default: ".racer-demo" },
      json: { type: "boolean", default: false }, confirm: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  const [command, argument] = positionals;
  if (!command || values.help) console.log(help);
  else if (command === "demo") {
    const mission = await demo(values.output, values.json ? () => {} : console.log);
    if (values.json) console.log(JSON.stringify(mission, null, 2));
  } else if (command === "install-opencode") {
    console.log(JSON.stringify(installOpenCode(values.repo), null, 2));
  } else {
    const racer = new Racer(values.repo);
    try {
      const id = () => { if (!argument) throw new Error("A mission ID is required"); return argument; };
      const revision = () => values.revision === undefined ? racer.store.get(id()).revision : Number(values.revision);
      const document = () => {
        if (!values.file) throw new Error("Pass --file with a JSON document");
        return JSON.parse(readFileSync(values.file, "utf8")) as unknown;
      };
      let result: unknown;
      switch (command) {
        case "start": result = racer.start({ brief: positionals.slice(1).join(" "), kind: values.kind as Mission["kind"], base: values.base, maxAttempts: Number(values.budget) }); break;
        case "plan": result = racer.plan(id(), revision(), document()); break;
        case "begin": result = racer.begin(id(), revision()); break;
        case "verify": result = await racer.verify(id(), revision()); break;
        case "review": result = racer.review(id(), revision(), document()); break;
        case "handoff": result = racer.handoff(id(), revision()); break;
        case "publish": result = publish(racer, id(), values.confirm); break;
        case "list": result = racer.store.list(); break;
        case "events": result = racer.store.events(id()); break;
        case "resume": case "status": result = racer.resume(id()); break;
        default: throw new Error(`Unknown command: ${command}\n${help}`);
      }
      if (values.json || command === "events" || command === "list") console.log(JSON.stringify(result, null, 2));
      else if (command === "status" || command === "resume") {
        const status = result as ReturnType<Racer["resume"]>;
        console.log(pitwall(status.mission, status.fresh));
        console.log(status.next);
      } else console.log(pitwall(result as Mission));
      const mission = result as Partial<Mission>;
      if (command === "verify" && !mission.verification?.passed) process.exitCode = 1;
    } finally { racer.close(); }
  }
} catch (error) {
  console.error(`Racer: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
