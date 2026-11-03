# Changelog

## 0.1.0 (2026-10-27)

- Initial release: three MCP tools and matching CLI subcommands
  for provably fair raffle draws — `pick_winner_now` (winners
  from the latest drand round), `create_scheduled_draw` (a draw
  sealed to a future drand round committed at creation time),
  and `verify_draw` (the pending or verified result of a
  scheduled draw by id).
- Winners are ranked by `sha256(randomness + "|" + entrant)`
  over the deduplicated, sorted entrant list, so anyone can
  recompute a result from the public beacon values.
