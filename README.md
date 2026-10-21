# tampermonkey

Zonito's Tampermonkey userscripts, kept here so Zonito and Molang can both
read, review and add to them.

## Scripts (`scripts/`)

Install any of these by opening the `.user.js` file in Tampermonkey.

| Script | Site | What it does |
|---|---|---|
| Smart Screener | screener.in | Transforms Screener.in into an advanced stock analysis platform (v0.2.1, bundled build). See the redaction note below. |
| ChatGPT Sidebar Enhanced with Search and Auto Scroll | chat.openai.com | Adds a search bar to the ChatGPT sidebar and filters conversations |
| Disable Cookie Popups | all sites | Removes known cookie-consent popups by id/class |
| Remove Ads Placeholders | marketbeat.com, finance.yahoo.com, nasdaq.com | Removes ad placeholders and sponsored blocks |
| Remove YouTube Shorts | youtube.com | Removes Shorts sections |
| Dracula Youtube Music CSS | music.youtube.com | Dracula theme for YouTube Music via `GM_addStyle` |

## In progress

- **IBKR Enhancer** (Interactive Brokers Client Portal): brief for the local
  agent is in [`prompts/ibkr-enhancer-prompt.md`](prompts/ibkr-enhancer-prompt.md).
  The script itself lands at `scripts/ibkr-enhancer.user.js` when built.
  Read-only by design: it must never place, cancel or modify an order.

## Archive

`archive/backup-safari-2025-08-16/` is the raw Tampermonkey Safari export from
16 Aug 2025, kept for fidelity: each script's `.options.json` and
`.storage.json`, Smart Screener's bundled `@require` libraries, and
`Tampermonkey.global.json`. The installable copies live in `scripts/`.

## Redaction note, 21 Oct 2026

Smart Screener's bundled build contained a hard-coded OpenAI API key
(`OPENAI_API_KEY`, `sk-proj-...`). That key has been replaced in this repo,
in both `scripts/` and `archive/`, with
`REDACTED-OPENAI-API-KEY-removed-2026-10-21`. **Rotate that key**: treat the
old one as compromised, and re-enter a fresh key locally only. Never commit a
real key here; this repo is public. The script's AI features will not work
from the repo copy until a key is set locally.

## Rules for new scripts

- No secrets, API keys, account numbers, balances or real position/order data
  in any file, screenshot or fixture. Synthetic test data only.
- Saved page HTML from broker or bank sites is a local fixture only, never
  committed (see `.gitignore`).
- Vanilla JS preferred; no external `@require` unless the README entry for
  that script explains why.
- One script per file under `scripts/`, named `<Name>.user.js`, with a
  standard Tampermonkey header (`@name`, `@namespace`, `@version`,
  `@description`, `@match`, `@grant`).
