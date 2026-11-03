/**
 * fairdraw core: provably fair raffle draws from the public
 * drand randomness beacon.
 *
 * The fairness rule is a pure function of public values:
 * entrants are deduplicated and sorted (ascending, by the
 * default JavaScript string comparison), each entrant is
 * scored with sha256(randomness + "|" + entrant) as a hex
 * digest, and entrants are ranked by that score ascending —
 * the lowest `winners` scores win, in ranked order. Anyone
 * with the round's randomness can recompute the ranking.
 *
 * drand access (base https://api.drand.sh) goes through an
 * injectable fetch:
 *   GET /public/latest   -> {round, randomness, ...}
 *   GET /public/<round>  -> {round, randomness, ...}
 *   GET /info            -> {genesis_time, period, ...}
 * A non-2xx response is `drand error: HTTP <status>` and a
 * throwing fetch is `drand unreachable`. In verify_draw a
 * 404 for the committed round instead means the round has
 * not been published yet.
 *
 * Scheduled draws commit, at creation, to the first round
 * whose randomness becomes available at or after
 * now + delay_sec:
 *   round = floor((target - genesis_time) / period) + 1
 *   target = floor(now_unix) + delay_sec
 * The draw id is the first 12 hex chars of
 * sha256(title + "|" + round + "|" + entrants.join(","))
 * over the deduplicated, sorted entrants. Draws live only
 * in an in-process map.
 *
 * All argument validation happens before any request, with
 * the documented error strings.
 */
import { createHash } from "node:crypto";
import type {
  CreateScheduledDrawArgs,
  DrawRecord,
  FairDeps,
  FetchFn,
  PickWinnerNowArgs,
  VerifyDrawArgs,
} from "./types.js";

export const VERSION = "0.1.0";

export const DRAND_BASE_URL = "https://api.drand.sh";

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** Deduplicate and sort entrants, ascending by default string comparison. */
export function dedupeSortEntrants(entrants: string[]): string[] {
  return [...new Set(entrants)].sort();
}

/**
 * Rank entrants for one round's randomness: score each with
 * sha256(randomness + "|" + entrant) and order by score
 * ascending (lexicographic hex comparison).
 */
export function rankEntrants(randomness: string, entrants: string[]): string[] {
  return dedupeSortEntrants(entrants)
    .map((entrant) => ({ entrant, score: sha256Hex(`${randomness}|${entrant}`) }))
    .sort((a, b) => (a.score < b.score ? -1 : a.score > b.score ? 1 : 0))
    .map((r) => r.entrant);
}

/** The draw id for a sealed draw: first 12 hex of the documented hash. */
export function computeDrawId(title: string, round: number, entrants: string[]): string {
  const joined = dedupeSortEntrants(entrants).join(",");
  return sha256Hex(`${title}|${round}|${joined}`).slice(0, 12);
}

/** The committed round for a target time, from the chain info values. */
export function committedRound(genesisTime: number, period: number, target: number): number {
  return Math.floor((target - genesisTime) / period) + 1;
}

function validateEntrants(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.some((e) => typeof e !== "string" || e.length === 0)
  ) {
    throw new Error("entrants must be a non-empty array of strings");
  }
  return dedupeSortEntrants(value as string[]);
}

function validateWinners(value: unknown, entrantCount: number): number {
  const winners = value === undefined ? 1 : value;
  if (
    typeof winners !== "number" ||
    !Number.isInteger(winners) ||
    winners < 1 ||
    winners > entrantCount
  ) {
    throw new Error("winners must be between 1 and the number of entrants");
  }
  return winners;
}

function validateDelaySec(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error("delay_sec must be a positive integer");
  }
  return value;
}

function validateTitle(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("title must be a non-empty string");
  }
  return value;
}

const defaultFetch: FetchFn = async (url, init) => {
  const res = await fetch(url, init);
  return { ok: res.ok, status: res.status, text: () => res.text() };
};

/** The core's in-process draw store, used when deps carry none. */
export const defaultStore = new Map<string, DrawRecord>();

interface DrandReply {
  status: number;
  body: Record<string, unknown>;
}

async function fetchDrand(deps: FairDeps, path: string): Promise<DrandReply> {
  const fetchFn = deps.fetchFn ?? defaultFetch;
  const base = (deps.baseUrl ?? DRAND_BASE_URL).replace(/\/+$/, "");
  let res;
  try {
    res = await fetchFn(`${base}${path}`);
  } catch {
    throw new Error("drand unreachable");
  }
  let body: Record<string, unknown> = {};
  if (res.status >= 200 && res.status < 300) {
    try {
      const parsed: unknown = JSON.parse(await res.text());
      if (typeof parsed === "object" && parsed !== null) {
        body = parsed as Record<string, unknown>;
      }
    } catch {
      throw new Error("drand unreachable");
    }
  }
  return { status: res.status, body };
}

async function fetchDrandOk(deps: FairDeps, path: string): Promise<Record<string, unknown>> {
  const { status, body } = await fetchDrand(deps, path);
  if (status < 200 || status >= 300) {
    throw new Error(`drand error: HTTP ${status}`);
  }
  return body;
}

function formatWinners(names: string[], round: number, randomness: string, suffix = ""): string {
  const head = names.length === 1 ? `🏆 Winner: ${names[0]}` : `🏆 Winners: ${names.join(", ")}`;
  return `${head} (drand round ${round}, randomness ${randomness.slice(0, 6)}…)${suffix}`;
}

/** Instantly pick a provably-fair winner (or winners) from a list. */
export async function pickWinnerNow(
  args: PickWinnerNowArgs,
  deps: FairDeps = {},
): Promise<string> {
  const raw = (args ?? {}) as unknown as Record<string, unknown>;
  const entrants = validateEntrants(raw.entrants);
  const winners = validateWinners(raw.winners, entrants.length);
  const latest = await fetchDrandOk(deps, "/public/latest");
  const round = latest.round as number;
  const randomness = latest.randomness as string;
  const ranked = rankEntrants(randomness, entrants);
  return formatWinners(ranked.slice(0, winners), round, randomness);
}

/** Create a draw that reveals at a future time, its round committed now. */
export async function createScheduledDraw(
  args: CreateScheduledDrawArgs,
  deps: FairDeps = {},
): Promise<string> {
  const raw = (args ?? {}) as unknown as Record<string, unknown>;
  const entrants = validateEntrants(raw.entrants);
  const winners = validateWinners(raw.winners, entrants.length);
  const delaySec = validateDelaySec(raw.delay_sec);
  const title = validateTitle(raw.title);
  const info = await fetchDrandOk(deps, "/info");
  const genesisTime = info.genesis_time as number;
  const period = info.period as number;
  const nowUnix = Math.floor((deps.now ? deps.now() : new Date()).getTime() / 1000);
  const target = nowUnix + delaySec;
  const round = committedRound(genesisTime, period, target);
  const id = computeDrawId(title, round, entrants);
  const store = deps.store ?? defaultStore;
  const record: DrawRecord = { id, title, entrants, winners, round };
  store.set(id, record);
  return `✅ Sealed to drand round ${round}. Draw id: ${id}`;
}

/** Fetch the current state and verified result of a scheduled draw by id. */
export async function verifyDraw(args: VerifyDrawArgs, deps: FairDeps = {}): Promise<string> {
  const raw = (args ?? {}) as unknown as Record<string, unknown>;
  const id = raw.id;
  const store = deps.store ?? defaultStore;
  const draw = typeof id === "string" ? store.get(id) : undefined;
  if (!draw) {
    throw new Error(`unknown draw id: ${String(id)}`);
  }
  const { status, body } = await fetchDrand(deps, `/public/${draw.round}`);
  if (status === 404) {
    return `⏳ Draw ${draw.id} is sealed to drand round ${draw.round}; the round has not been published yet.`;
  }
  if (status < 200 || status >= 300) {
    throw new Error(`drand error: HTTP ${status}`);
  }
  const round = body.round as number;
  const randomness = body.randomness as string;
  const ranked = rankEntrants(randomness, draw.entrants);
  return formatWinners(ranked.slice(0, draw.winners), round, randomness, " — verified");
}
