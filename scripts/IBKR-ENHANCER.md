# IBKR Enhancer

Read-only scan aids for Interactive Brokers Client Portal, built for an
option-wheel workflow. One file: `ibkr-enhancer.user.js`. Vanilla JS, no
`@require`, no network calls. Grants: `GM_addStyle`, `GM_setValue`,
`GM_getValue` (settings only).

**It never places, cancels, modifies or transmits an order, never clicks a
native action button, and never sends page data anywhere.** Copy buttons write
CSV to the clipboard only.

## What it does

- **Sticky margin bar** (both pages, when the account panel is present): NLV
  (account-header headline value), Excess Liquidity, Buying Power, Maintenance
  Margin, Unrealized P&L, plus cushion % = Excess Liquidity / NLV (green
  > 20%, amber 10–20%, red < 10%). Displays the account alias it read.
  Fail-safe: the headline is anchored on the sidebar account item (the
  largest label ancestor, up to 25 levels, still containing exactly one
  account-ID token; 2+ IDs is the multi-account column and is rejected).
  The header is the item text before the first summary label (cut set
  includes Settled Cash and Realized P&L); headline is the first money value
  after the currency in that header, with the last ID-shaped token as the
  account ID (inline elements glue alias/ID/currency/value without
  whitespace). Any candidate equal to a labelled field value is rejected,
  and on any mismatch the bar shows labelled fields only and no cushion. If
  the alias cannot be read, the bar shows the masked account ID. The bar
  sits bottom-right, clear of the top-right nav icons. Verified pre-live by
  running the full script in jsdom against both saved fixtures.
- **Positions badges**: DTE from the instrument expiry (Europe/London; red
  <= 7d, amber <= 21d), ITM vs the held underlying's Last (no badge and an
  "underlying price unavailable" tooltip when the underlying is not held),
  premium captured % = 1 - Last/Avg Price badged at >= 60% for shorts.
- **Group by underlying** (default off, remembered): equity with its options
  plus a subtotal row (market value, unrealized/daily P&L, net delta exposure
  = qty x delta x 100 for options, qty for shares).
- **Filter bars** (Positions + Orders): text filter plus toggles (Options /
  Equities / ITM / expiring <= 7d / <= 21d; Buys / Sells / stale > 14d).
  `/` focuses the text box. Hiding is visual only; Reset restores the native
  view.
- **Orders**: terminal statuses (Cancelled, ApiCancelled, Filled, Inactive,
  Expired, Rejected) are not open: excluded from duplicate detection, the
  summary line and all badges, and from the Buy/Sell/Stale filtered sets.
  Open orders get an age badge from the Status date, remaining notional
  (remain x strike x 100) in the badge tooltip, summary line (open count,
  total remaining option notional, count > 14 days), and a duplicate flag for
  two open orders on the same underlying + expiry + strike (flag only).
- **Copy positions/orders as CSV** with a `# generated-at:` first line.
- **Readability**: sticky header, zebra rows, compact/comfortable density
  (remembered). P&L colours follow the page's `_npos`/`_nneg` classes.

Settings: gear in the bar. Every feature individually disableable; with all
features off the enhancer removes its nodes/classes and the page is native.
All injected nodes carry `data-ibkr-enhancer`, all CSS classes are `ibx-`,
logs are prefixed `[IBKR Enhancer]`, parse errors fail silent.

## Selectors used and fallbacks

No `data-testid` exists; obfuscated classes are never selectors.

- Tables: `role="grid"` tables under `#cp-ib-app-main-content`, identified by
  header signature (Positions: Instrument + Position; Orders: Orders +
  Filled/Remain). Saved ids (`cp-ptf-positions-table0`, `_tb179`) are hints
  only. The Cash Holdings table (`_tb392`, Currency/Amount) never matches and
  is never parsed as positions.
- Columns: mapped by visible header text, never index (reorder-safe).
  Normalised fallbacks cover the `aria-label="Sort by ..."` variants
  (`Last Price`, `52 Week IV Rank`, `52 IV Perc.`, `Market capitalization`,
  `P/E excluding extraordinary items`).
- Instrument (Positions): row `aria-label` first (clean descriptor, no
  company name), cell text as fallback. Regex is unanchored at the tail
  because cell text appends the company name after Put/Call.
- Instrument (Orders): cell line 1; limit price and TIF come from line 2
  (`Limit 4.65, GTC`). The Price column is always an em dash in the fixture
  and is never a source.
- Order id: `data-id` attribute, corroborated against the Order id column
  (`orderIdCorroborated`). Positions `data-id` is a row index only.
- Account panel: visible label text; NLV from the account-header headline
  pattern above. IV Rank/Pctl are equity-row fields in the fixture; option
  rows carry em dashes there.

Re-runs on `hashchange` plus a debounced `MutationObserver` scoped to
`#cp-ib-app-main-content`. Injection is idempotent.

## Known fragilities

- IBKR deploys can rename headers, ids and the main-content node; the
  enhancer then silently does nothing rather than guessing.
- Grouping reorders native rows while enabled; Reset/untoggle restores the
  stored original order, and IBKR re-renders replace it anyway.
- The trailing unnamed Orders column is a row-action affordance: noted,
  never clicked.

## Tests

`node --test scripts/ibkr-enhancer.test.mjs` — synthetic data only. Covers
equity/short put/short call/long rows, `C`-prefixed Last, em-dash nulls,
comma/B/M numbers, header variants, reordered columns, order rows, DTE /
cushion / premium / ITM / notional maths, duplicates and CSV shape. The pure
parser lives between the `PARSER START/END` markers in the userscript.

## How to disable

Toggle features off in the gear panel, or disable/remove the script in
Tampermonkey. No page data is stored; only feature settings persist.

## Phase 2 candidates (not built)

Wing pairing, a 60% take-profit cross-check of buy-to-close orders against
short positions, DTE/expiry-week digest, per-underlying P&L history from
repeated CSV copies.
