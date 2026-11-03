# fairdraw

A raffle nobody has to take your word for. fairdraw picks
winners from the public drand randomness beacon: the winning
names are a pure function of a drand round's published
randomness and the entrant list, so after a draw anyone can
recompute the ranking by hand and check that the announced
winners are the ones the beacon actually produced.

How a result is decided:

1. The entrant list is deduplicated and sorted.
2. Each entrant is scored with
   `sha256(randomness + "|" + entrant)` (hex digest).
3. Entrants are ranked by score, lowest first — the lowest
   scores win, in ranked order.

The three tools:

- `pick_winner_now` — draw immediately against the latest
  drand round and get the winner (or winners) right away,
  with the round number and the start of the randomness in
  the result so the draw can be rechecked.
- `create_scheduled_draw` — seal a draw to a future reveal.
  The drand round is committed the instant the draw is
  created, from the chain's timing: the first round whose
  randomness becomes available at or after
  `now + delay_sec`. The reply carries a draw id.
- `verify_draw` — look a scheduled draw up by id. While its
  round is still unpublished you get a pending note naming
  the committed round; once the round is out, you get the
  winners recomputed from that round's randomness, marked
  as verified.

Scheduled draws are kept in the server process's memory:
they live as long as the process does, and a draw id is only
meaningful to the process that created it.

## CLI

Each tool is a subcommand taking one JSON argument string:

```bash
npx @reneturcios/fairdraw pick_winner_now '{"entrants":["alice","bob","carol"],"winners":2}'
npx @reneturcios/fairdraw create_scheduled_draw '{"title":"Spring raffle","entrants":["alice","bob"],"delay_sec":3600}'
npx @reneturcios/fairdraw verify_draw '{"id":"<draw id>"}'
npx @reneturcios/fairdraw --version
```

Output is the tool's result text. Exit codes: `0` on
success, `1` on a runtime error (including a validation or
drand failure), `2` on a usage error.

## MCP server

```bash
npx -y @reneturcios/fairdraw mcp
```

MCP client config:

```json
{
  "mcpServers": {
    "fairdraw": {
      "command": "npx",
      "args": ["-y", "@reneturcios/fairdraw", "mcp"]
    }
  }
}
```

## Docker

```bash
docker run -i ghcr.io/cloudcorprecords/fairdraw
docker run --rm ghcr.io/cloudcorprecords/fairdraw pick_winner_now '{"entrants":["alice","bob"]}'
```

## Development

```bash
npm install
npm run build   # tsc -> dist/
npm test        # tsx --test test/*.test.ts (fake fetch + fake clock, no network)
npm run dev     # run the CLI from source
```

## License

MIT — Copyright (c) 2026 Rene Turcios
