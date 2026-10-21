# Changelog

## 2026-10-21

- Add IBKR Enhancer (`scripts/ibkr-enhancer.user.js`) v0.1.0: read-only Client
  Portal aids (margin bar with fail-safe cushion, option DTE/ITM/premium
  badges, grouping, filters, order age/notional, CSV copy, readability).
  Parser tests in `scripts/ibkr-enhancer.test.mjs`; notes in
  `scripts/IBKR-ENHANCER.md`. Validated offline against local fixtures:
  34 positions (13 equity, 21 options), 23 orders (21 Buy, 2 Sell, all GTC).
