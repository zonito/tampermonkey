# Prompt for your local agent: IBKR Client Portal Enhancer (Tampermonkey)

Copy everything below the line to your local agent.

---

You are building a Tampermonkey userscript for me. Work in the repo
`zonito/tampermonkey` (clone it if you do not have it). Read `README.md` and the
existing scripts under `scripts/` first, to match the house style. Then do
Phase 0, report back, and only then build Phase 1.

## What I want, in one line

Make Interactive Brokers Client Portal fast to scan and safe to read for an
option-wheel trader: margin cushion, short options, expiries and open GTC
orders visible at a glance, without me hunting through the native tables.

## Hard rules, no exceptions

- Read-only v1. Never place, cancel, modify or transmit an order. Never click
  Cancel / Modify / Quote or any native action button. Never call IBKR backend
  APIs, and never send page data anywhere. No network calls at all in v1.
- Do not commit, push, screenshot or log my real account numbers, balances,
  positions or order IDs. I will give you two saved HTML files locally
  (Positions - Home, Orders & Trades - Order). Use them only as local fixtures.
  They are already covered by `.gitignore` patterns for `*.html` samples if you
  name them `fixture-*.html`; keep them out of git either way and confirm
  `git status` is clean of them before every push.
- No external `@require`, no CDN libraries, no analytics. Vanilla JS only.
  Allowed grants: `GM_addStyle`, `GM_setValue`, `GM_getValue` (settings only).
- If the live DOM differs materially from the saved HTML, stop and report the
  selector evidence. Do not guess, and do not improvise clicks.
- Push to `main` in small commits with clear messages. Show me a diff summary
  and screenshots with account data blurred before the final push.

## The pages, from the saved HTML I am giving you

Base: `https://www.interactivebrokers.co.uk/portal/` (Client Portal, a SPA
with hash routes). Also match the `.com` portal host.

1. Positions: `#/dashboard/positions`
   - Account summary panel at top with labelled values: Net Liquidation Value,
     Settled Cash, Unrealized P&L, Realized P&L, Maintenance Margin,
     Excess Liquidity, Buying Power, Dividends. Other family accounts are
     listed in the same panel; the script must act only on the account in view.
   - Positions table, `role="grid"`, saved id `cp-ptf-positions-table0`.
     Columns in the saved file, in order: Instrument, Position, Change %,
     Cost Basis, Market Value, Last, Avg Price, Daily P&L, Unrealized P&L,
     Delta, 52wk IV Rank, 52wk IV Pctl, P/E, Forward P/E, Beta, Market Cap,
     Social Sentiment Score, Social Sentiment Score Change.
     Users can add/remove/reorder columns, so map columns by header text,
     never by fixed index.
   - Row shapes: an equity row is a bare ticker plus company name. An option
     row reads like `ABC Nov20'26 35 Call` or `XYZ Nov06'26 950 Put`:
     underlying, expiry `MonDD'YY`, strike, Put/Call. Short positions have a
     negative Position quantity. Option Last may be prefixed `C` (closing
     price indicator). Missing values are an em dash. Money values carry a
     currency suffix such as `USD` and thousands commas. Market Cap uses `B`/`M`.

2. Orders & Trades, Orders tab: `#/orders`
   - Orders table, saved id `_tb179`. Columns: Orders (instrument text, same
     option format as above, repeated on a second line with order type, e.g.
     `Limit 4.65, GTC`), Action (Buy/Sell), Filled/Remain (e.g. `0/20`),
     Status (e.g. `Submitted` plus a date/time line), Price, Account,
     Order id (the numeric order id is also the row element `id`).
   - Every saved order is GTC. Protective buy-to-close orders for short puts
     and covered calls can sit open for weeks, so order age matters.

DOM warnings, verified from the saved files:

- There are no `data-testid` attributes and no stable semantic classes.
  Classes are obfuscated build artefacts (`_tb`, `_tbsr`, `_tbsid`, `fs8`,
  `fg70`, `_nan`, `_npos`, `_nneg` etc.) and will change on IBKR deploys.
- Build selectors in this order of preference: table `role`/header text,
  `aria-label="Sort by <Column>"`, visible label text in the account panel,
  table id as a hint only, obfuscated classes never.
- The SPA re-renders on hash change, refresh, sort and account switch.
  Everything you inject must be idempotent, survive re-renders, and re-run on
  `hashchange` plus a debounced `MutationObserver` on the main content node
  (`#cp-ib-app-main-content`). Never observe the whole document at full
  sensitivity; this page mutates constantly and a hot observer will jank it.
- Number parsing must handle: thousands commas, leading `+`/`-`, a leading `C`
  on Last, currency suffixes, `%`, `B`/`M` suffixes, and em dash = null.
  Write the parser as pure functions so it is testable outside the page.

## Phase 0: spike and report (do this first, build nothing yet)

1. Parse both saved fixtures offline (a small Node script or a test page,
   fixtures stay local and uncommitted). Prove you can extract:
   positions rows into `{instrument, underlying, type: equity|put|call,
   expiry, strike, qty, last, avgPrice, costBasis, marketValue, dailyPnl,
   unrealizedPnl, delta, ivRank}` and orders rows into `{instrument,
   underlying, expiry, strike, type, action, qty, filled, remain, status,
   statusDate, limitPrice, tif, account, orderId}`.
2. Report: the selector strategy per field, every field you could NOT extract
   reliably, fixture row counts vs the visible row counts, and any column or
   format you found that this brief did not mention.
3. Wait for my go-ahead on that report before writing the userscript.

## Phase 1: MVP (after my go-ahead)

One file: `scripts/ibkr-enhancer.user.js`
Header: name `IBKR Enhancer`, namespace `https://github.com/zonito/tampermonkey`,
`@match https://www.interactivebrokers.co.uk/portal/*` and
`@match https://www.interactivebrokers.com/portal/*`, `@run-at document-idle`.

Features, in this priority order:

1. **Sticky margin bar (both pages, if the account panel is present).**
   NLV, Excess Liquidity, Buying Power, Maintenance Margin, Unrealized P&L,
   plus a computed cushion % = Excess Liquidity / NLV. Colour the cushion:
   green above 20%, amber 10-20%, red below 10%. Small, fixed, dismissible,
   and it must not cover native controls.
2. **Positions: expiry and risk badges on option rows.**
   DTE badge from the expiry in the instrument name (days from today, Europe/
   London). Red at 7 DTE or less, amber at 21 or less. ITM badge when a short
   option is in the money against its underlying's Last (use the equity row
   for that underlying when present; if the underlying is not held, say
   "underlying price unavailable" in the tooltip and show no ITM badge rather
   than guessing). For short options, premium captured % =
   `1 - (Last / Avg Price)`; badge it at 60% or more, because that is my
   take-profit rule. Handle the `C` prefix and negative quantities correctly.
3. **Positions: group by underlying.**
   A toggle that groups each equity with its options, with a subtotal row per
   underlying: market value, unrealized P&L, daily P&L, and net delta
   exposure (qty x delta x 100 for options, qty for shares). Default off;
   remember the choice in `GM_setValue`.
4. **Positions + Orders: quick filter bar.**
   Text filter on instrument/underlying, plus toggles: Options only,
   Equities only, ITM only, Expiring <= 7d, Expiring <= 21d (positions);
   Buys only, Sells only, Stale > 14 days (orders). `/` focuses the filter;
   do not hijack Cmd+K or any native shortcut. Filtering hides rows visually
   only; it must never alter, sort or re-submit the native table, and a
   "Reset" must restore the exact native view.
5. **Orders: age and exposure.**
   Age badge from the Status date. Per-order remaining notional at limit for
   options: remain x strike x 100, shown in a tooltip or muted column.
   A summary line above the table: open orders count, total remaining option
   notional, count of orders older than 14 days. Flag, do not auto-act on,
   two open orders on the same underlying + expiry + strike.
6. **Copy out.**
   Buttons: "Copy positions as CSV" and "Copy orders as CSV" using the parsed
   model, with a generated-at timestamp. Clipboard only. This is how I will
   paste the state into chat, so keep the CSV clean and stable in column order.
7. **Readability pass.**
   Sticky table header within the native scroll area, zebra striping that
   respects the dark theme (`common.web.dark.css` is the default in the
   saved files), consistent red/green for P&L using the page's own
   `_npos`/`_nneg` semantics as the source of truth, and a density toggle
   (comfortable/compact) saved as a setting.

Settings: one small collapsible panel (gear icon, top-right of the injected
bar) with a toggle per feature. Every feature must be individually
disableable, and with all features off the page must look and behave exactly
native. Prefix all injected nodes with `data-ibkr-enhancer` and all CSS
classes with `ibx-`. Log with the prefix `[IBKR Enhancer]` and fail silent in
the UI: a parse error shows nothing, never an alert, never a broken table.

## Phase 2: candidates only, do NOT build these yet

List them in the PR description as proposals and wait for me to pick:
wing pairing (match a long protective option to a short option on the same
underlying/expiry and show the pair's net risk), a 60% take-profit check that
cross-reads open buy-to-close orders against short positions, DTE/expiry-week
digest, and per-underlying P&L history from repeated CSV copies.

## Tests and acceptance

- Parser unit tests (plain Node, no framework dependency beyond `node:test`)
  covering: equity row, short put, short call, long option, `C`-prefixed Last,
  em-dash nulls, comma/B/M numbers, an order row, and a reordered-columns
  positions table. Tests and fixtures with synthetic data only in the repo;
  my real fixtures never leave this machine.
- Manual verification checklist in the PR: script installs clean in
  Tampermonkey on Safari and Chrome, survives Refresh, sort, account switch
  and hash navigation Positions <-> Orders, no console errors, no layout
  overlap at 100% and 125% zoom, all-off state is pixel-identical to native.
- Deliverables: the `.user.js`, parser tests, a short `scripts/IBKR-ENHANCER.md`
  (what it does, selectors used and their fallbacks, known fragilities, how to
  disable), and a `CHANGELOG.md` entry. Update the repo `README.md` index.

If anything in this brief conflicts with what the fixtures or the live page
actually show, the page wins: flag the conflict in your Phase 0 report instead
of silently building around it.
