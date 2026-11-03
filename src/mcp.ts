/**
 * fairdraw MCP server. Tools: pick_winner_now,
 * create_scheduled_draw, verify_draw.
 *
 * Why the low-level Server instead of McpServer: the
 * high-level helper converts zod schemas to JSON Schema and
 * injects keys that are not in this tool set's documented
 * spec ("$schema" and "additionalProperties"), which breaks
 * exact tool-list/schema parity with the spec. This file
 * serves tools/list with the spec's exact input schemas as
 * explicit literals, and the core validates every tools/call
 * argument set itself.
 *
 * Every tool returns a single text item in the documented
 * format; validation and upstream failures come back as
 * isError results carrying the documented error strings.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { createScheduledDraw, pickWinnerNow, verifyDraw, VERSION } from "./fair.js";

const ENTRANTS_PROP = {
  type: "array",
  items: { type: "string" },
  description: "The entrant names. Duplicates are removed and the list is sorted before ranking.",
} as const;

const WINNERS_PROP = {
  type: "integer",
  description: "How many winners to pick. Defaults to 1; must be between 1 and the number of entrants.",
} as const;

const TOOLS = [
  {
    name: "pick_winner_now",
    description:
      "Instantly pick a provably-fair winner (or winners) from a list. Uses the latest drand round, so it's immediate and verifiable.",
    inputSchema: {
      type: "object" as const,
      properties: {
        entrants: ENTRANTS_PROP,
        winners: WINNERS_PROP,
      },
      required: ["entrants"],
    },
  },
  {
    name: "create_scheduled_draw",
    description:
      "Create a draw that reveals at a future time, with the randomness round committed the instant you create it.",
    inputSchema: {
      type: "object" as const,
      properties: {
        delay_sec: {
          type: "integer",
          description: "Seconds from now until the draw reveals. Must be a positive integer.",
        },
        entrants: ENTRANTS_PROP,
        title: {
          type: "string",
          description: "A non-empty title for the draw.",
        },
        winners: WINNERS_PROP,
      },
      required: ["title", "entrants", "delay_sec"],
    },
  },
  {
    name: "verify_draw",
    description: "Fetch the current state and verified result of a scheduled draw by id.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description: "The draw id returned by create_scheduled_draw.",
        },
      },
      required: ["id"],
    },
  },
];

function textResult(text: string) {
  return {
    content: [{ type: "text" as const, text }],
  };
}

function errorResult(err: unknown) {
  return {
    content: [
      { type: "text" as const, text: err instanceof Error ? err.message : String(err) },
    ],
    isError: true,
  };
}

const server = new Server(
  { name: "fairdraw", version: VERSION },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const a = (args ?? {}) as Record<string, unknown>;
  try {
    let out: string;
    switch (name) {
      case "pick_winner_now":
        out = await pickWinnerNow(a as never);
        break;
      case "create_scheduled_draw":
        out = await createScheduledDraw(a as never);
        break;
      case "verify_draw":
        out = await verifyDraw(a as never);
        break;
      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
    return textResult(out);
  } catch (err) {
    if (err instanceof McpError) throw err;
    return errorResult(err);
  }
});

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

void main();
