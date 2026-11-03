# fairdraw — Build Report (Batch 21)

Rebuild of the `provably-fair-mcp` MCP server (npm
`provably-fair-mcp`, registry
`app.promptcoin/giveaway-raffle-winner-picker`) from the
firsthand spec in `specs-batch21/fairdraw.md`. Built
2026-10-27.

## Identity

- npm: `@reneturcios/fairdraw` @ 0.1.0, bin `fairdraw` →
  `dist/cli.js`
- MCP Registry name: `io.github.CloudCorpRecords/fairdraw`
  (matches `package.json` `mcpName`, `server.json` `name`,
  and the Dockerfile `io.modelcontextprotocol.server.name`
  label)
- server.json description (94 chars, verified):
  "Provably fair raffle draws: winners picked from public
  drand randomness, verifiable by anyone."
- server.json: npm package entry carries `"version":
  "0.1.0"`; the OCI entry
  (`ghcr.io/cloudcorprecords/fairdraw:0.1.0`) carries **no**
  `version` field (verified).

## Files (19-file factory set, per TEMPLATE.md §2)

package.json, server.json, Dockerfile, tsconfig.json
(byte-identical to builds/swissreg/tsconfig.json, verified
with `cmp`), .gitignore, package-lock.json, README.md
(fresh prose), LICENSE (MIT, © 2026 Rene Turcios),
CHANGELOG.md (single 0.1.0 entry dated 2026-10-27),
src/index.ts, src/cli.ts, src/mcp.ts, src/types.ts,
src/fair.ts (core), test/fair.test.ts, and the four
workflows under .github/workflows/ (publish-container
adapted: IMAGE ghcr.io/cloudcorprecords/fairdraw, smoke
assertion on server name `fairdraw`). Plus this
BUILD-REPORT.md and the parity-out/ artifacts.

## Implementation

- `src/mcp.ts`: low-level `Server` API
  (`sdk/server/index.js` + `StdioServerTransport`,
  handlers for `ListToolsRequestSchema` /
  `CallToolRequestSchema` from `sdk/types.js`), explicit
  JSON-schema literals for all 3 tools (pick_winner_now,
  create_scheduled_draw, verify_draw); no McpServer/zod
  registration. Tool descriptions and per-property
  descriptions, types and `required` lists are the
  fixture's, exactly.
- `src/fair.ts`: the pinned fairness algorithm —
  entrants deduplicated and sorted (ascending, JS default
  string comparison), scored with
  `sha256(randomness + "|" + entrant)` (UTF-8, hex), ranked
  by score ascending, lowest `winners` scores win in ranked
  order. drand access goes through an injectable fetch
  (base `https://api.drand.sh`, injectable): `/public/latest`,
  `/public/<round>`, `/info`. Non-2xx → `drand error:
  HTTP <status>`; a throwing fetch → `drand unreachable`;
  in verify_draw a 404 for the committed round yields the
  pinned ⏳ pending text instead. All validation runs
  before any request, with the pinned error strings
  (`entrants must be a non-empty array of strings`,
  `winners must be between 1 and the number of entrants`
  — checked against the deduplicated count,
  `delay_sec must be a positive integer`, `title must be
  a non-empty string`, `unknown draw id: <id>`).
  Scheduled draws commit to
  `round = floor((target - genesis_time) / period) + 1`
  with `target = floor(now_unix) + delay_sec`, are stored
  in an in-process map under an id equal to the first 12
  hex chars of
  `sha256(title + "|" + round + "|" + dedupedSortedEntrants.join(","))`,
  and all result texts use the pinned 🏆 / ✅ / ⏳
  formats verbatim (including the ` — verified` suffix in
  verify_draw). An injectable clock drives the
  scheduled-draw target in tests.
- CLI: one subcommand per tool taking a JSON argument
  string, `mcp`, `--version`; unknown subcommand → usage
  on stderr, exit 2; isError results exit 1.

## Verification (all real, run 2026-10-27)

- `npm run build` (tsc): exit 0. `npx tsc --noEmit`:
  exit 0.
- `npm test`: **34 tests, 34 pass, 0 fail** — fake fetch +
  fake clock only, no live network. Covers the ranking
  algorithm (dedupe+sort, sha256 ranking recomputed
  independently, permutation property, committed-round
  formula edges, draw-id hash), pick_winner_now single /
  plural exact formats, latest-round URL and injectable
  base URL, drand HTTP-error and unreachable mapping,
  every validation error (entrants empty / non-array /
  empty-string / non-string, winners below 1 / above the
  deduplicated count / non-integer, validation before any
  request, delay_sec non-positive / non-integer, title
  empty / missing), the create flow (sealed text + id,
  stored record, /info fetch, /info failure), and
  verify_draw (unknown id, 404 pending text, published
  single- and multi-winner verified texts, non-404 round
  failure as a drand error, throwing fetch).
- `node dist/cli.js --version`: `0.1.0`; unknown command:
  usage on stderr, exit 2; a validation failure via the
  CLI exits 1 with the pinned error text.
- Parity: `python3 harness/parity.py --original
  harness/fixtures/provably-fair-mcp-tools-original.json
  --rebuild "stdio:node builds/fairdraw/dist/cli.js mcp"
  --out builds/fairdraw/parity-out` →
  **verdict=PASS parity_pct=100.0, 3/3 tools identical,
  no schema diffs**.
- Lockfile: Route 3 only — clean temp dir with
  package.json alone, `npm install --package-lock-only
  --ignore-scripts --offline`; parses, name
  `@reneturcios/fairdraw`, **128 package entries**.
  Dependencies installed in the build dir with
  `npm install --offline --ignore-scripts` (exit 0, no
  proxy fallback needed).

## Gap notes / deviations (from the spec, verbatim)

- Scheduled draws are stored in process memory only (the original
  persists them server-side and serves a public proof page at
  promptcoin.app); the rebuild returns a local draw id and cannot
  verify draws created elsewhere.
- The committed-round formula is the documented reconstruction of
  drand round timing from the chain `info` values.
- No live drand call was made; behaviour is proven against fake
  fetch only.
- The upstream returns a hosted proof-page URL; the rebuild cannot
  mint pages on the upstream's domain, so it returns its own draw id.
- No push, no publish.
