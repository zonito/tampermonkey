# Kubera GTC orders export: exploration and design
21 Oct 2026. Status: explored against the live Kubera API, design ready,
nothing built yet. Companion prompt for the local agent:
`ibkr-gtc-export-addendum-prompt.md`.

## The gap, verified live today

- Kubera API (228 paths, read from its live OpenAPI spec today) has **no
  orders surface at all**: no `/orders` path, and no schema with "order" in
  its name. It knows transactions (fills), positions derived from them, and
  closed-trade take-profit stats (`/api/v1/wheel/ledger/take-profit`).
- So Kubera cannot today answer: does this short have a GTC buy-to-close,
  at what limit, for how many contracts, since when, is it duplicated?
  That check currently lives in a browser-plugin prompt run by hand, and
  today's runs showed why that is fragile: unstable page capture, counts
  shifting between runs, and no memory between sessions.
- Fix: capture the orders where they are actually visible, the IBKR Client
  Portal Orders page, with the Tampermonkey script already being built, and
  push each capture into Kubera over its localhost API. Kubera becomes the
  tracked, diffed, queryable record for **both** IBKR accounts.

## Options checked

| Route | Verdict |
|---|---|
| A. Tampermonkey on the portal -> Kubera localhost API | **Recommended.** Uses the portal session he already has open, works for both accounts, near-real-time whenever the Orders page is opened or refreshed, no new IBKR login or 2FA to babysit. |
| B. IBKR Gateway / Client Portal API poller on the Mac | Later upgrade, not now. Gives orders programmatically (researched 13 Oct) but needs a second username per account holder and weekly-ish 2FA babysitting. The schema below keeps an `ingest_source` field so a poller can feed the same store later without a redesign. |
| C. Flex / activity statements | No. End-of-day and fills, not live open orders. |

## How it works

1. On the Orders page, the script parses every open order row (same parser
   as the enhancer brief), groups rows by the Account column, and POSTs one
   **snapshot per account** to Kubera on the same machine:
   `POST http://127.0.0.1:8000/api/v1/broker-orders/snapshot`
2. Transport must be `GM_xmlhttpRequest` with `@connect 127.0.0.1` and
   `@connect localhost`. A normal page `fetch` from an HTTPS page to an
   HTTP localhost URL is blocked as mixed content; the Tampermonkey
   privileged request is not. Kubera also answers on the Mac's tailnet
   address, but localhost is the right target: same machine, nothing leaves
   it.
3. Kubera validates, stores the snapshot, diffs it against the previous
   state for that account, and returns the diff. The script shows it in its
   injected bar: "Exported 13:42, 24 orders: 2 new, 1 limit changed,
   1 gone". If Kubera is down, the script queues the snapshot locally and
   retries on the next page load; it never blocks or alters the page.
4. Auto-update, not manual export: export fires automatically once the
   Orders table is fully rendered and stable, and again after a native
   Refresh, debounced. A manual "Export now" button is the fallback.
   Completeness is part of the payload: if the table is paginated or the
   row count is unstable, the script sends `complete: false`, and Kubera
   stores it as a partial sighting that **never** marks orders as gone.

## Snapshot payload (field names mirror Kubera's existing conventions)

```json
{
  "ingest_source": "tampermonkey-ibkr",
  "account_id": "<IBKR account id from the row's Account column>",
  "account_label": "<short label, e.g. Zonito / Nikhila>",
  "captured_at": "2026-10-21T13:42:00+01:00",
  "complete": true,
  "orders": [
    {
      "order_id": "123456789",
      "symbol": "ABC",
      "asset_type": "option",
      "expiry_date": "2026-11-20",
      "strike_price": 35,
      "option_type": "Call",
      "action": "Sell",
      "qty_total": 20,
      "qty_filled": 0,
      "qty_remain": 20,
      "limit_price": 4.65,
      "tif": "GTC",
      "status": "Submitted",
      "status_at": "2026-10-20T16:28:00+01:00",
      "currency": "USD",
      "legs": []
    }
  ]
}
```

- `order_id` is IBKR's own id (the Orders row element id). Primary key is
  `(account_id, order_id)`: stable across snapshots, unique per account.
- Combo/BAG orders, if the portal shows them, go in one record with a
  `legs[]` array (each leg: symbol, expiry, strike, option_type, action,
  ratio). Single-leg orders have `legs: []`.
- Equity orders are captured too (`asset_type: "equity"`, option fields
  null). The GTC coverage check only uses option orders, but a complete
  snapshot keeps the record honest and costs nothing.
- Raw page text for the instrument and price lines is kept in a `raw`
  field per order, so a parser fix can be re-run against stored snapshots
  instead of needing a fresh page capture.

## Kubera side: storage and endpoints (new, local agent to build)

Storage: orders are **not** transactions, so they do not go in the
Transactions CSVs or the manual-transaction API. New dedicated store
following Kubera's existing file/cache patterns (agent picks the exact
mechanism after reading the codebase, and says which in its report):
current state per account, plus an append-only events log
(`first_seen, limit_changed, qty_changed, status_changed, gone`) and
retained snapshots, so order age and limit history are auditable.

- `POST /api/v1/broker-orders/snapshot` — ingest above. Auth: a local
  ingest token in header `X-Kubera-Ingest-Token`, generated by Kubera,
  entered once into the script's settings (stored via `GM_setValue`,
  never committed). Reject snapshots with a stale `captured_at` older
  than the last accepted one for that account.
- `GET /api/v1/broker-orders?account=<id or label>` — current open orders
  for one account, or all accounts, each with `first_seen_at`,
  `last_seen_at`, `age_days`, and its event history summary.
- `GET /api/v1/broker-orders/changes?since=<iso>` — the diff feed: new,
  changed, gone, across both accounts. This is what a morning/wheel
  pipeline reads instead of asking a plugin.
- `GET /api/v1/broker-orders/coverage?account=<...>` — the auto GTC check,
  server-side, joining open orders to Kubera's open short positions and
  credit spreads (same reconstruction rules as the existing GTC-check
  prompt): for every short single, is there a Buy to Close, GTC, qty
  covers, limit <= 0.40 x average premium (rounded down)? For every credit
  spread, a BAG order covering all legs at net debit <= 0.40 x net
  credit? Plus flags: duplicates, single-leg orders on spread legs,
  non-GTC orders, orders with no matching position (stale/orphan),
  positions with no order. Hedge (long) contracts are listed separately
  with their Sell to Close state, no 60% math applied.
  Response carries `snapshot_captured_at` and `complete` per account, so
  a consumer can refuse to verdict on a partial or stale snapshot,
  exactly the guardrail the plugin prompt needed.
- Gone is not deleted: an order that disappears is marked `gone` with
  `last_seen_at`, and classified later as filled vs cancelled when the
  transactions sync next lands (a matching fill means filled). Until
  classified it reads `gone_unclassified`, never silently dropped.

UI, minimal v1: a panel on the Wheel Strategy page, per account: snapshot
freshness, open order count, coverage verdict counts, and the changes
since yesterday. No new page, no order actions, read-only like the rest
of this system.

## Decisions for Zonito (defaults taken, say the word to change)

1. **Positions snapshot too?** Default: not in v1. Kubera's positions come
   from statement sync and lag; coverage against stale positions was one
   of today's failure modes. The same channel can add
   `POST /api/v1/broker-orders/positions-snapshot` later with no schema
   change to orders. Faster to ship orders-only first.
2. **Ingest token vs open localhost.** Default: token. Kubera's API is
   otherwise unauthenticated on the machine; an orders write endpoint
   should not be open to any local process or web page that can reach
   localhost.
3. **Who builds what.** Default: one addendum prompt, the local agent
   builds the Kubera endpoints first (with tests on synthetic snapshots),
   then extends the Tampermonkey script. Molang proofreads both against
   live reads, same standard as App Hardening: pushed is not live.
