# Changelog

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
