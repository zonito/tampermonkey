# Changelog

## 2026-10-21 (v0.7.0)

- IBKR Enhancer ticket fill protection: confirmation summary in words
  before any write, hard blocks (no match, stale snapshot, alias mismatch,
  bad target) as reason text, post-fill receipt re-read with mismatch
  warning, and Undo restoring pre-fill values. Positions snapshot now
  records account alias, timestamp and Last.

## 2026-10-21 (v0.6.0)

- IBKR Enhancer order-ticket GTC fill: button on the Close tab for known
  short options fills quantity, 60% limit and GTC TIF only (native setter
  + events, listbox driven); never clicks Preview or Submit. Positions
  snapshot saved from Positions runs as fallback. Toggle in settings.

## 2026-10-21 (v0.5.2)

- IBKR Enhancer margin bar: × is now a collapse control folding the bar to
  a docked cushion chip (dot + "Margin" when unresolved); clicking the
  chip re-expands. Collapsed state persists in GM storage. The settings
  Margin bar toggle remains the only full off.

## 2026-10-21 (v0.5.1)

- IBKR Enhancer CC chip fix: covered-call coverage sources split. Only
  open short call positions render green; working Sell orders render a
  separate amber "CC order n/N working" (or combined) state, never green.

## 2026-10-21 (v0.5.0)

- IBKR Enhancer: anchor accepts ID + currency + non-clashing money without
  the signed gate (signed is confidence only), with a fallback scan of the
  account item's full text after the ID skipping clashing candidates.
- Margin bar redesigned: compact alias / NLV / cushion pill, Details
  overlay with masked ID, large cushion and the full field table.

## 2026-10-21 (v0.4.1)

- IBKR Enhancer fix: filter state hoisted to module level per table kind
  and re-applied to the current row set at the end of every run, so active
  filters hold across native Refresh and price-tick re-renders; rebuilt
  bars render from the persisted state. jsdom refresh regression gate on
  both fixtures.

## 2026-10-21 (v0.4.0) — Phase 2C

- IBKR Enhancer covered-call chips on equity rows: capacity floor(shares/100)
  vs short-call contracts plus Sell-call snapshot remain; green/amber/muted
  states with covering strikes in the tooltip.

## 2026-10-21 (v0.3.1)

- IBKR Enhancer anchor fix for live glued text: everything the anchor reads
  (ID counting, header slice, labelled values) now uses spaced-text
  extraction (TreeWalker joining text nodes with a separator), because live
  textContent concatenates leaf texts with no whitespace. Glued minified
  jsdom variant reproduced NO_ITEM_1ID before the fix, passes after it; the
  saved-fixture gate stays green.

## 2026-10-21 (v0.3.0) — Phase 2B

- IBKR Enhancer wing pairing: greedy quantity-consuming match of long
  options to shorts (nearest expiry, then strike), PAIRED / PARTIAL /
  ORPHAN chips (amber orphan-exit variant), WINGED markers on covered
  shorts. Unit tests + jsdom gate (independent orphan recomputation).

## 2026-10-21 (v0.2.0) — Phase 2A

- IBKR Enhancer cross-reference: open orders snapshot saved from the Orders
  page (GM storage, timestamped); short options on Positions get GTC chips
  (green >= 60% locked capture, amber below, red NO GTC with escalation at
  >= 60% captured, grey after 24h). Unit tests + synthetic jsdom gate for
  all three states.

## 2026-10-21 (v0.1.6)

- IBKR Enhancer cosmetics: filter search input styled to the pill system
  (dark surface, fully rounded, accent focus border); copy buttons become
  pills with a clipboard icon, hover lift and a 1.5s "Copied" label flip.

## 2026-10-21 (v0.1.5)

- IBKR Enhancer diagnostics: "Copy anchor debug" button in the settings
  panel copies one shapes-only line (label counts, ancestor depth, ID-token
  count, header length, currency/signed/money booleans, money digit-shape,
  clash flag, enumerated rejection reason). No anchor behaviour change.

## 2026-10-21 (v0.1.4)

- IBKR Enhancer filter bars redesigned: segmented controls for Type, Expiry
  and Side (single-scalar state, contradictory toggles impossible), pill
  toggles with filled/check/`aria-pressed` ON state, conditional "Clear all".

## 2026-10-21 (v0.1.3)

- IBKR Enhancer: terminal order statuses (Cancelled, ApiCancelled, Filled,
  Inactive, Expired, Rejected) are excluded from duplicate detection, the
  open-orders summary (count, notional, stale) and all order badges; the
  Buy/Sell/Stale filters use the same open set. Synthetic pair test added.

## 2026-10-21 (v0.1.2)

- IBKR Enhancer anchor correction (jsdom gate against both fixtures):
  headline walk up to 25 levels taking the largest ancestor with exactly one
  account-ID token, extended cut-label set, last-ID-token account segment,
  block-aware cell text fallback. Removed the remaining placeholder literal
  from the bar fallback chain. Positions bar in jsdom: alias, NLV, labelled
  fields and 19.7% cushion all render.

## 2026-10-21 (v0.1.1)

- IBKR Enhancer fix round after live proofread: re-anchor headline value on
  the sidebar account item (ID + currency + signed change, candidate rejected
  if equal to a labelled field); masked account ID instead of "unknown";
  margin bar moved to bottom-right, clear of the top-right nav icons.

## 2026-10-21

- Add IBKR Enhancer (`scripts/ibkr-enhancer.user.js`) v0.1.0: read-only Client
  Portal aids (margin bar with fail-safe cushion, option DTE/ITM/premium
  badges, grouping, filters, order age/notional, CSV copy, readability).
  Parser tests in `scripts/ibkr-enhancer.test.mjs`; notes in
  `scripts/IBKR-ENHANCER.md`. Validated offline against local fixtures:
  34 positions (13 equity, 21 options), 23 orders (21 Buy, 2 Sell, all GTC).
