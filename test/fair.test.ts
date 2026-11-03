import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  committedRound,
  computeDrawId,
  createScheduledDraw,
  dedupeSortEntrants,
  pickWinnerNow,
  rankEntrants,
  verifyDraw,
} from "../src/fair.js";
import type { DrawRecord, FairDeps, FetchFn } from "../src/types.js";

/**
 * Every test runs against an injected fake fetch and a fixed
 * fake clock: no live network, no live call is made.
 */

const NOW = () => new Date(1_700_000_000_000); // unix 1700000000
const RANDOMNESS = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
const ROUND_RANDOMNESS = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
const GENESIS = 1_699_999_000;
const PERIOD = 30;

type Reply = { status?: number; body: unknown };
type Handler = (url: string) => Reply;

function makeFetch(handler: Handler, captured: string[] = []): FetchFn {
  return async (url) => {
    captured.push(url);
    const r = handler(url);
    const status = r.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (typeof r.body === "string" ? r.body : JSON.stringify(r.body)),
    };
  };
}

const throwingFetch: FetchFn = async () => {
  throw new Error("connection refused");
};

function deps(fetchFn: FetchFn, extra: Partial<FairDeps> = {}): FairDeps {
  return { fetchFn, now: NOW, store: new Map<string, DrawRecord>(), ...extra };
}

function latestFetch(captured: string[] = []): FetchFn {
  return makeFetch((url) => {
    if (url.endsWith("/public/latest")) return { body: { round: 4242, randomness: RANDOMNESS } };
    return { status: 404, body: "no fake route" };
  }, captured);
}

function infoFetch(extra?: Handler, captured: string[] = []): FetchFn {
  return makeFetch((url) => {
    if (url.endsWith("/info")) return { body: { genesis_time: GENESIS, period: PERIOD } };
    if (extra) return extra(url);
    return { status: 404, body: "no fake route" };
  }, captured);
}

/** Independent recomputation of the documented ranking. */
function expectedRanked(randomness: string, entrants: string[]): string[] {
  const sorted = [...new Set(entrants)].sort();
  return sorted
    .map((e) => ({
      e,
      score: createHash("sha256").update(`${randomness}|${e}`, "utf8").digest("hex"),
    }))
    .sort((a, b) => (a.score < b.score ? -1 : a.score > b.score ? 1 : 0))
    .map((r) => r.e);
}

async function expectError(promise: Promise<unknown>, message: string): Promise<void> {
  await assert.rejects(promise, (err: unknown) => {
    assert.equal(err instanceof Error ? err.message : String(err), message);
    return true;
  });
}

describe("ranking algorithm", () => {
  it("deduplicates and sorts entrants ascending", () => {
    assert.deepEqual(dedupeSortEntrants(["carol", "alice", "bob", "alice", "carol"]), [
      "alice",
      "bob",
      "carol",
    ]);
  });

  it("ranks by sha256(randomness + \"|\" + entrant) ascending", () => {
    const entrants = ["alice", "bob", "carol", "dave"];
    assert.deepEqual(rankEntrants(RANDOMNESS, entrants), expectedRanked(RANDOMNESS, entrants));
  });

  it("ranking is a permutation of the deduplicated entrants", () => {
    const ranked = rankEntrants(RANDOMNESS, ["bob", "alice", "bob", "carol"]);
    assert.deepEqual([...ranked].sort(), ["alice", "bob", "carol"]);
    assert.equal(ranked.length, 3);
  });

  it("a different randomness gives the ranking for that randomness", () => {
    const entrants = ["alice", "bob", "carol", "dave", "erin"];
    assert.deepEqual(
      rankEntrants(ROUND_RANDOMNESS, entrants),
      expectedRanked(ROUND_RANDOMNESS, entrants),
    );
  });

  it("committedRound follows floor((target - genesis) / period) + 1", () => {
    assert.equal(committedRound(1000, 10, 1000), 1);
    assert.equal(committedRound(1000, 10, 1009), 1);
    assert.equal(committedRound(1000, 10, 1010), 2);
    assert.equal(committedRound(GENESIS, PERIOD, 1_700_000_090), 37);
  });

  it("computeDrawId is the first 12 hex of the documented hash", () => {
    const expected = createHash("sha256")
      .update("Party|37|alice,bob,carol", "utf8")
      .digest("hex")
      .slice(0, 12);
    assert.equal(computeDrawId("Party", 37, ["carol", "alice", "bob", "alice"]), expected);
    assert.equal(expected.length, 12);
  });
});

describe("pick_winner_now", () => {
  it("picks one winner with the exact pinned format", async () => {
    const entrants = ["alice", "bob", "carol"];
    const winner = expectedRanked(RANDOMNESS, entrants)[0];
    const out = await pickWinnerNow({ entrants }, deps(latestFetch()));
    assert.equal(out, `🏆 Winner: ${winner} (drand round 4242, randomness abcdef…)`);
  });

  it("picks several winners in ranked order with the plural format", async () => {
    const entrants = ["alice", "bob", "carol", "dave"];
    const top = expectedRanked(RANDOMNESS, entrants).slice(0, 2);
    const out = await pickWinnerNow({ entrants, winners: 2 }, deps(latestFetch()));
    assert.equal(out, `🏆 Winners: ${top.join(", ")} (drand round 4242, randomness abcdef…)`);
  });

  it("fetches the latest round from the drand base", async () => {
    const captured: string[] = [];
    await pickWinnerNow({ entrants: ["alice"] }, deps(latestFetch(captured)));
    assert.deepEqual(captured, ["https://api.drand.sh/public/latest"]);
  });

  it("honours an injected drand base URL", async () => {
    const captured: string[] = [];
    await pickWinnerNow(
      { entrants: ["alice"] },
      deps(latestFetch(captured), { baseUrl: "https://example.test/drand/" }),
    );
    assert.deepEqual(captured, ["https://example.test/drand/public/latest"]);
  });

  it("maps a non-2xx drand reply to drand error: HTTP <status>", async () => {
    const fetchFn = makeFetch(() => ({ status: 503, body: "down" }));
    await expectError(pickWinnerNow({ entrants: ["alice"] }, deps(fetchFn)), "drand error: HTTP 503");
  });

  it("maps a throwing fetch to drand unreachable", async () => {
    await expectError(pickWinnerNow({ entrants: ["alice"] }, deps(throwingFetch)), "drand unreachable");
  });
});

describe("validation", () => {
  it("rejects an empty entrants array", async () => {
    await expectError(
      pickWinnerNow({ entrants: [] }, deps(latestFetch())),
      "entrants must be a non-empty array of strings",
    );
  });

  it("rejects entrants that are not an array", async () => {
    await expectError(
      pickWinnerNow({ entrants: "alice" } as never, deps(latestFetch())),
      "entrants must be a non-empty array of strings",
    );
  });

  it("rejects entrants containing an empty string", async () => {
    await expectError(
      pickWinnerNow({ entrants: ["alice", ""] }, deps(latestFetch())),
      "entrants must be a non-empty array of strings",
    );
  });

  it("rejects entrants containing a non-string", async () => {
    await expectError(
      pickWinnerNow({ entrants: ["alice", 7] } as never, deps(latestFetch())),
      "entrants must be a non-empty array of strings",
    );
  });

  it("rejects winners below 1", async () => {
    await expectError(
      pickWinnerNow({ entrants: ["alice", "bob"], winners: 0 }, deps(latestFetch())),
      "winners must be between 1 and the number of entrants",
    );
  });

  it("rejects winners above the entrant count", async () => {
    await expectError(
      pickWinnerNow({ entrants: ["alice", "bob"], winners: 3 }, deps(latestFetch())),
      "winners must be between 1 and the number of entrants",
    );
  });

  it("rejects winners counted against the deduplicated list", async () => {
    await expectError(
      pickWinnerNow({ entrants: ["alice", "alice", "bob"], winners: 3 }, deps(latestFetch())),
      "winners must be between 1 and the number of entrants",
    );
  });

  it("rejects a non-integer winners", async () => {
    await expectError(
      pickWinnerNow({ entrants: ["alice", "bob"], winners: 1.5 }, deps(latestFetch())),
      "winners must be between 1 and the number of entrants",
    );
  });

  it("validates before any request is made", async () => {
    const captured: string[] = [];
    await expectError(
      pickWinnerNow({ entrants: [] }, deps(latestFetch(captured))),
      "entrants must be a non-empty array of strings",
    );
    assert.deepEqual(captured, []);
  });

  it("rejects a non-positive delay_sec", async () => {
    const args = { title: "Party", entrants: ["alice"], delay_sec: 0 };
    await expectError(createScheduledDraw(args, deps(infoFetch())), "delay_sec must be a positive integer");
  });

  it("rejects a non-integer delay_sec", async () => {
    const args = { title: "Party", entrants: ["alice"], delay_sec: 2.5 };
    await expectError(createScheduledDraw(args, deps(infoFetch())), "delay_sec must be a positive integer");
  });

  it("rejects an empty title", async () => {
    const args = { title: "", entrants: ["alice"], delay_sec: 60 };
    await expectError(createScheduledDraw(args, deps(infoFetch())), "title must be a non-empty string");
  });

  it("rejects a missing title", async () => {
    const args = { entrants: ["alice"], delay_sec: 60 } as never;
    await expectError(createScheduledDraw(args, deps(infoFetch())), "title must be a non-empty string");
  });
});

describe("create_scheduled_draw and verify_draw", () => {
  const CREATE_ARGS = { title: "Party", entrants: ["carol", "alice", "bob", "alice"], delay_sec: 90 };

  it("seals to the committed round and returns the pinned text and id", async () => {
    const store = new Map<string, DrawRecord>();
    const out = await createScheduledDraw(CREATE_ARGS, deps(infoFetch(), { store }));
    const id = computeDrawId("Party", 37, ["alice", "bob", "carol"]);
    assert.equal(out, `✅ Sealed to drand round 37. Draw id: ${id}`);
    const saved = store.get(id);
    assert.ok(saved);
    assert.equal(saved.round, 37);
    assert.deepEqual(saved.entrants, ["alice", "bob", "carol"]);
    assert.equal(saved.winners, 1);
  });

  it("fetches chain info from /info", async () => {
    const captured: string[] = [];
    await createScheduledDraw(CREATE_ARGS, deps(infoFetch(undefined, captured)));
    assert.deepEqual(captured, ["https://api.drand.sh/info"]);
  });

  it("maps an /info failure to drand error: HTTP <status>", async () => {
    const fetchFn = makeFetch(() => ({ status: 500, body: "boom" }));
    await expectError(createScheduledDraw(CREATE_ARGS, deps(fetchFn)), "drand error: HTTP 500");
  });

  it("rejects an unknown draw id", async () => {
    await expectError(verifyDraw({ id: "deadbeef0000" }, deps(infoFetch())), "unknown draw id: deadbeef0000");
  });

  it("reports a sealed draw whose round is unpublished (404) as pending", async () => {
    const store = new Map<string, DrawRecord>();
    const d = deps(infoFetch(), { store });
    const created = await createScheduledDraw(CREATE_ARGS, d);
    const id = created.split("Draw id: ")[1];
    const out = await verifyDraw({ id }, d);
    assert.equal(
      out,
      `⏳ Draw ${id} is sealed to drand round 37; the round has not been published yet.`,
    );
  });

  it("verifies a published draw with the pinned verified format", async () => {
    const published = (url: string): Reply => {
      if (url.endsWith("/public/37")) return { body: { round: 37, randomness: ROUND_RANDOMNESS } };
      return { status: 404, body: "no fake route" };
    };
    const store = new Map<string, DrawRecord>();
    const d = deps(infoFetch(published), { store });
    const created = await createScheduledDraw(CREATE_ARGS, d);
    const id = created.split("Draw id: ")[1];
    const winner = expectedRanked(ROUND_RANDOMNESS, ["alice", "bob", "carol"])[0];
    const out = await verifyDraw({ id }, d);
    assert.equal(out, `🏆 Winner: ${winner} (drand round 37, randomness 001122…) — verified`);
  });

  it("verifies a multi-winner draw with the plural verified format", async () => {
    const published = (url: string): Reply => {
      if (url.endsWith("/public/37")) return { body: { round: 37, randomness: ROUND_RANDOMNESS } };
      return { status: 404, body: "no fake route" };
    };
    const store = new Map<string, DrawRecord>();
    const d = deps(infoFetch(published), { store });
    const created = await createScheduledDraw({ ...CREATE_ARGS, winners: 2 }, d);
    const id = created.split("Draw id: ")[1];
    const top = expectedRanked(ROUND_RANDOMNESS, ["alice", "bob", "carol"]).slice(0, 2);
    const out = await verifyDraw({ id }, d);
    assert.equal(
      out,
      `🏆 Winners: ${top.join(", ")} (drand round 37, randomness 001122…) — verified`,
    );
  });

  it("treats a non-404 round failure in verify as a drand error, not pending", async () => {
    const failing = (url: string): Reply => {
      if (url.endsWith("/public/37")) return { status: 500, body: "boom" };
      return { status: 404, body: "no fake route" };
    };
    const store = new Map<string, DrawRecord>();
    const d = deps(infoFetch(failing), { store });
    const created = await createScheduledDraw(CREATE_ARGS, d);
    const id = created.split("Draw id: ")[1];
    await expectError(verifyDraw({ id }, d), "drand error: HTTP 500");
  });

  it("maps a throwing fetch in verify to drand unreachable", async () => {
    const store = new Map<string, DrawRecord>();
    const d = deps(infoFetch(), { store });
    const created = await createScheduledDraw(CREATE_ARGS, d);
    const id = created.split("Draw id: ")[1];
    await expectError(verifyDraw({ id }, deps(throwingFetch, { store })), "drand unreachable");
  });
});
