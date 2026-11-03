/**
 * fairdraw types.
 *
 * Three tools for provably fair raffle draws over the public
 * drand randomness beacon. Every tool answers with a single
 * human-readable text string in the documented format; draws
 * created by `create_scheduled_draw` are held in an in-process
 * map keyed by their draw id.
 */

export interface PickWinnerNowArgs {
  entrants: string[];
  winners?: number;
}

export interface CreateScheduledDrawArgs {
  title: string;
  entrants: string[];
  winners?: number;
  delay_sec: number;
}

export interface VerifyDrawArgs {
  id: string;
}

/** A scheduled draw, sealed to one committed drand round. */
export interface DrawRecord {
  id: string;
  title: string;
  /** Deduplicated, sorted entrant list the draw was sealed with. */
  entrants: string[];
  winners: number;
  round: number;
}

/** The minimal slice of a fetch Response this client relies on. */
export interface FetchResponseLike {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

/** Injectable fetch, so tests never touch the live network. */
export type FetchFn = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<FetchResponseLike>;

/** Runtime dependencies for the core, all injectable in tests. */
export interface FairDeps {
  /** Fetch implementation. Defaults to the global fetch. */
  fetchFn?: FetchFn;
  /** Clock used to resolve the scheduled-draw target time. */
  now?: () => Date;
  /** drand base URL. Defaults to https://api.drand.sh. */
  baseUrl?: string;
  /** Draw store. Defaults to the core's in-process map. */
  store?: Map<string, DrawRecord>;
}
