# Addendum prompt for your local agent: GTC orders export into Kubera

Copy everything below the line to your local agent, after the main IBKR
Enhancer prompt. This addendum depends on Phase 0 passing on the real
fixtures first.

---

Addendum to the IBKR Enhancer brief: export open orders into Kubera.
Design reference: `docs/kubera-gtc-orders-export-design.md` in this repo.
Read it first; this prompt is the order of work, the design doc is the spec.

Context: Kubera's live API has no orders surface at all (verified from its
OpenAPI spec: 228 paths, no order schema). Kubera knows fills and positions,
never open orders, so the 60% GTC check cannot be automated inside Kubera
today. This addendum creates that surface. Two workstreams, in this order.

## Workstream 1: Kubera endpoints (build first)

In the Kubera repo, following its existing patterns for storage, routing
and response envelopes:

1. `POST /api/v1/broker-orders/snapshot` — accepts the snapshot payload in
   the design doc (field names mirror Kubera's own conventions: `symbol`,
   `option_type`, `strike_price`, `expiry_date`). Key is
   `(account_id, order_id)`. Auth: header `X-Kubera-Ingest-Token` compared
   against a locally configured token; reject missing/wrong tokens and
   snapshots whose `captured_at` is older than the last accepted snapshot
   for that account.
2. Storage: dedicated broker-orders store, NOT the Transactions CSVs and
   NOT the manual-transaction API. Current state per account, an
   append-only events log (`first_seen`, `limit_changed`, `qty_changed`,
   `status_changed`, `gone`), and retained raw snapshots (each order keeps
   its `raw` page text, so parser fixes can be re-run without a new
   capture). In your Phase 0-style report, say which existing Kubera
   storage pattern you followed and why.
3. Diff on ingest, returned in the POST response and stored as events:
   new / changed (name the field) / gone. An order absent from a
   `complete: true` snapshot becomes `gone` (never deleted), and is
   classified filled vs cancelled only when the transactions sync later
   shows a matching fill; until then it is `gone_unclassified`. An order
   absent from a `complete: false` snapshot changes nothing.
4. `GET /api/v1/broker-orders?account=<id or label>` — current open orders
   with `first_seen_at`, `last_seen_at`, `age_days`. Omit `account` for
   both IBKR accounts, grouped by account, never merged.
5. `GET /api/v1/broker-orders/changes?since=<iso>` — new/changed/gone feed.
6. `GET /api/v1/broker-orders/coverage?account=<id or label>` — the auto
   GTC check. Join open orders to Kubera's open short positions and
   reconstructed credit spreads (spread reconstruction rules are the ones
   in my existing GTC-check prompt: same account/underlying/expiry,
   equal qty, net credit; residuals handled as singles). For each single
   short: matching Buy to Close exists, TIF is GTC, qty covers, limit <=
   floor(0.40 x average premium). For each credit spread: a BAG order
   covering all legs, net debit <= floor(0.40 x net credit). Flags:
   duplicate closing orders, single-leg order on a spread leg, non-GTC
   order, qty short, orphan order (no matching position), uncovered
   position. Long (hedge) contracts are reported with their Sell to Close
   state only, no 60% math. Every response carries per-account
   `captured_at`, `complete`, and `stale` (snapshot older than 24h), so a
   consumer can refuse to verdict on partial or stale data.
7. Minimal UI: one panel on the existing Wheel Strategy page per account:
   snapshot freshness, open order count, coverage verdict counts, changes
   since yesterday. Read-only, no order actions, no new page.
8. Tests: synthetic snapshots only (two fake accounts), covering ingest,
   diff (new/limit-changed/gone), partial snapshot marking nothing gone,
   stale snapshot rejection, wrong-token rejection, and every coverage
   flag above. No real account data in tests, fixtures, commits or
   screenshots.

## Workstream 2: Tampermonkey export (after Workstream 1 is live)

Extend `scripts/ibkr-enhancer.user.js`; do not create a second script.

1. Grants: add `GM_xmlhttpRequest`, plus `@connect 127.0.0.1` and
   `@connect localhost`. Transport is `GM_xmlhttpRequest` only: a page
   `fetch` from the HTTPS portal to HTTP localhost is mixed-content
   blocked. Endpoint: `POST http://127.0.0.1:8000/api/v1/broker-orders/snapshot`.
   Ingest token comes from a script setting stored via `GM_setValue`,
   entered once by me, never hard-coded, never committed.
2. When: on the Orders page only, after the table is fully rendered and
   the row count is stable across two checks 500ms apart; again after a
   native Refresh; debounced; plus a manual "Export now" button in the
   injected bar. Group rows by the row's Account column and send one
   snapshot per account.
3. Completeness: if a pager/pagination control shows more rows than are
   rendered, or the count is unstable, send `complete: false` (check the
   fixture and the live page for whether the Orders table paginates, and
   report what you find; if it does paginate, scrape all pages or stay
   `complete: false`, never guess).
4. Payload: exactly the design-doc schema, including `raw` per order and
   combo legs as `legs[]` when the portal groups an order. `captured_at`
   is Europe/London local time with offset.
5. Feedback and failure: the injected bar shows "Exported HH:MM, N orders"
   plus Kubera's diff counts from the response. On failure (Kubera down,
   token rejected), show one muted line, queue the latest snapshot in
   `GM_setValue`, retry on next page load. Never alert, never retry in a
   loop, never block or alter the native page.
6. The export is a copy-out only. The read-only rule from the main brief
   is unchanged: no placing, cancelling, modifying, or clicking native
   order actions, and no other network calls.

## Acceptance

- Synthetic end-to-end first: fixture Orders parse -> POST to a local
  Kubera dev instance -> coverage response matches a hand-computed
  expected result for the synthetic book.
- Then one live export per IBKR account, verified by reading
  `GET /api/v1/broker-orders` back and matching counts against the portal
  pages by eye. Report both accounts separately.
- Molang will proofread independently against live Kubera reads: pushed
  is not live; the endpoints must be running and returning the diff and
  coverage described here.
- Push in small commits to `zonito/kubera` (Workstream 1) and
  `zonito/tampermonkey` (Workstream 2), diff summary to me before the
  final push of each.

## Standing clause: proofread, restart, live verification (every phase, no exceptions)

- The last step before any report is your own self-proofread of the complete
  change: gaps listed, gaps fixed, result committed and pushed. Your report
  must name the final commit, the test counts, what the self-proofread
  changed, and anything still not signed off, in plain words. A report sent
  before that closing step is invalid and will be sent back.
- Pushed is not live. A phase counts as done only when all three hold:
  (1) the commit is on the repo's default branch, verified against the
  remote head; (2) the running system has been restarted or reloaded onto
  it: the Kubera server restarted for backend work, and for the userscript
  the updated file installed in Tampermonkey with the portal page
  hard-reloaded; (3) live behaviour, re-measured after that restart/reload,
  matches the claim.
- UI work needs rendered evidence: a DOM extract or screenshot, account
  data blurred. Unit tests alone never close a phase. No claim of a visual
  or live check you did not actually run.
- Benchmarks and expected counts are re-derived from the current fixtures
  and source files at each gate, never carried from an earlier prompt or
  report. If a figure in a prompt and the current source disagree, the
  source wins and you flag the prompt figure as wrong.
- The next phase or workstream starts only on an explicit pass that names
  what was checked live, what was reconciled, and what remains open. Open
  gaps are carried into the next phase as named preflight items.
- Molang proofreads independently in code and live after your report.
  Your report alone never closes a phase.
