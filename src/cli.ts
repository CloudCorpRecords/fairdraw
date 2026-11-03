#!/usr/bin/env node
/**
 * fairdraw CLI.
 *
 *   fairdraw pick_winner_now '<json>'
 *   fairdraw create_scheduled_draw '<json>'
 *   fairdraw verify_draw '<json>'
 *   fairdraw mcp
 *   fairdraw --version
 *
 * Each tool subcommand takes one JSON argument string with the
 * tool's arguments and prints the tool's result text. Exit
 * codes: 0 success, 1 runtime error, 2 usage error.
 */
import { createScheduledDraw, pickWinnerNow, verifyDraw, VERSION } from "./fair.js";

const TOOL_NAMES = ["pick_winner_now", "create_scheduled_draw", "verify_draw"] as const;

function usage(): never {
  console.error(`Usage:
  fairdraw <tool> '<json-args>'     one of: ${TOOL_NAMES.join(", ")}
  fairdraw mcp
  fairdraw --version`);
  process.exit(2);
}

async function runTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case "pick_winner_now":
      return pickWinnerNow(args as never);
    case "create_scheduled_draw":
      return createScheduledDraw(args as never);
    case "verify_draw":
      return verifyDraw(args as never);
    default:
      usage();
  }
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "--version" || cmd === "-v") {
    console.log(VERSION);
    return;
  }
  if (cmd === "mcp") {
    if (rest.length !== 0) usage();
    await import("./mcp.js");
    return;
  }
  if (!(TOOL_NAMES as readonly string[]).includes(cmd ?? "")) usage();
  if (rest.length > 1) usage();
  let args: Record<string, unknown> = {};
  if (rest.length === 1) {
    try {
      const parsed: unknown = JSON.parse(rest[0]);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) usage();
      args = parsed as Record<string, unknown>;
    } catch {
      console.error("error: argument must be a JSON object string");
      process.exit(2);
    }
  }
  try {
    const out = await runTool(cmd, args);
    console.log(out);
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

void main();
