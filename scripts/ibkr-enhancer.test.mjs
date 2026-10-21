// Parser unit tests for scripts/ibkr-enhancer.user.js — synthetic data only.
// Run: node --test scripts/ibkr-enhancer.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, 'ibkr-enhancer.user.js'), 'utf8');
const start = src.indexOf('// ================= PARSER START =================');
const end = src.indexOf('// ================= PARSER END =================');
assert.ok(start >= 0 && end > start, 'parser markers present');
const parserSrc = src.slice(start, end);
const mod = { exports: {} };
// The parser block references `module` only via the guard below it; evaluate block + export line.
new Function('module', 'exports', parserSrc + '\nmodule.exports = { parseNumber, parseInstrument, normalizeHeader, parsePositionRow, parseOrderRow, parseOrderMeta, parseStatus, dte, ageDays, cushionPct, cushionBand, premiumCaptured, isITM, netDeltaExposure, remainingNotional, duplicateOrderKeys, orderKey, positionsToCsv, ordersToCsv };')(mod, mod.exports);
const P = mod.exports;

const H = ['Instrument', 'Position', 'Change %', 'Cost Basis', 'Market Value', 'Last', 'Avg Price', 'Daily P&L', 'Unrealized P&L', 'Delta', '52wk IV Rank', '52wk IV Pctl', 'P/E', 'Forward P/E', 'Beta', 'Market Cap', 'Social Sentiment Score', 'Social Sentiment Score Change'];

test('equity row', () => {
  const r = P.parsePositionRow(H, ['ACME Acme Corp', '100', '+1.20%', '5,000 USD', '5,500 USD', '55.00', '50.00', '+50 USD', '+500 USD', '\u2014', '\u2014', '\u2014', '15', '14', '1.1', '2.5B', '\u2014', '\u2014']);
  assert.equal(r.type, 'equity'); assert.equal(r.underlying, 'ACME');
  assert.equal(r.qty, 100); assert.equal(r.marketValue, 5500); assert.equal(r.ivRank, null);
});

test('short put with C-prefixed Last', () => {
  const r = P.parsePositionRow(H, ["ACME Nov20'26 35 Put Acme Corp", '-2', '\u2014', '-300 USD', '-200 USD', 'C1.00', '1.50', '+10 USD', '+100 USD', '-0.30', '\u2014', '\u2014', '\u2014', '\u2014', '\u2014', '\u2014', '\u2014', '\u2014']);
  assert.equal(r.type, 'put'); assert.equal(r.strike, 35); assert.equal(r.qty, -2);
  assert.equal(r.last, 1.0); assert.equal(r.avgPrice, 1.5); assert.equal(r.expiryISO, '2026-11-20');
});

test('short call and long option', () => {
  const s = P.parsePositionRow(H, ["XYZ Nov06'26 950 Call Xyz Inc", '-1', '\u2014', '-400 USD', '-500 USD', '5.00', '4.00', '-20 USD', '-100 USD', '0.40', '\u2014', '\u2014', '\u2014', '\u2014', '\u2014', '\u2014', '\u2014', '\u2014']);
  assert.equal(s.type, 'call'); assert.equal(s.qty, -1);
  const l = P.parsePositionRow(H, ["XYZ Nov06'26 950 Put Xyz Inc", '3', '\u2014', '600 USD', '750 USD', '2.50', '2.00', '+5 USD', '+150 USD', '-0.25', '\u2014', '\u2014', '\u2014', '\u2014', '\u2014', '\u2014', '\u2014', '\u2014']);
  assert.equal(l.type, 'put'); assert.equal(l.qty, 3); assert.equal(l.last, 2.5);
});

test('C-prefixed Last, em-dash nulls, comma/B/M numbers', () => {
  assert.equal(P.parseNumber('C12.34'), 12.34);
  assert.equal(P.parseNumber('\u2014'), null);
  assert.equal(P.parseNumber('1,234,567 USD'), 1234567);
  assert.equal(P.parseNumber('2.5B'), 2.5e9);
  assert.equal(P.parseNumber('300M'), 3e8);
  assert.equal(P.parseNumber('+1.20%'), 1.2);
  assert.equal(P.parseNumber('-0.30'), -0.3);
});

test('reordered-columns positions table maps by header text', () => {
  const H2 = ['Last Price', 'Instrument', 'Position', 'Market Value', 'Avg Price', 'Cost Basis', 'Daily P&L', 'Unrealized P&L', 'Delta', '52 Week IV Rank'];
  const r = P.parsePositionRow(H2, ['C2.00', "ACME Nov20'26 35 Put", '-2', '-400 USD', '1.50', '-300 USD', '+10 USD', '+100 USD', '-0.30', '45']);
  assert.equal(r.type, 'put'); assert.equal(r.last, 2.0); assert.equal(r.qty, -2);
  assert.equal(r.marketValue, -400); assert.equal(r.ivRank, 45);
});

test('header normalisation: visible vs aria-label variants', () => {
  assert.equal(P.normalizeHeader('Last'), 'last');
  assert.equal(P.normalizeHeader('Last Price'), 'last');
  assert.equal(P.normalizeHeader('52wk IV Rank'), 'ivRank');
  assert.equal(P.normalizeHeader('52 Week IV Rank'), 'ivRank');
  assert.equal(P.normalizeHeader('52 IV Perc.'), 'ivPctl');
  assert.equal(P.normalizeHeader('Market capitalization'), 'marketCap');
  assert.equal(P.normalizeHeader('P/E excluding extraordinary items'), 'pe');
});

test('order row: limit/TIF from Orders line 2, Price column ignored, data-id corroboration', () => {
  const OH = ['', 'Orders', 'Action', 'Filled/Remain', 'Status', 'Price', 'Account', 'Order id', '', ''];
  const cells = ['', "ACME Nov20'26 35 Put\nACME Nov20'26 35 Put Limit 4.65, GTC", 'Buy', '0/20', 'Submitted 10/12/2026, 9:30 AM', '\u2014', 'U00000000', '998877665', '', ''];
  const r = P.parseOrderRow(OH, cells, '998877665');
  assert.equal(r.type, 'put'); assert.equal(r.underlying, 'ACME'); assert.equal(r.strike, 35);
  assert.equal(r.action, 'Buy'); assert.equal(r.filled, 0); assert.equal(r.remain, 20); assert.equal(r.qty, 20);
  assert.equal(r.limitPrice, 4.65); assert.equal(r.tif, 'GTC'); assert.equal(r.orderId, '998877665');
  assert.equal(r.orderIdCorroborated, true); assert.equal(r.status, 'Submitted');
  const mismatch = P.parseOrderRow(OH, cells, '111');
  assert.equal(mismatch.orderIdCorroborated, false);
});

test('invalid month falls back to equity, never throws', () => {
  const r = P.parseInstrument("ACME Foo20'26 35 Put");
  assert.equal(r.type, 'equity'); assert.equal(r.expiry, null); assert.equal(r.expiryISO, null);
  assert.equal(P.parseInstrument("ACME Nov20'26 35 Put").type, 'put');
});

test('DTE, age, cushion, premium, ITM, notional', () => {
  const now = new Date('2026-11-13T12:00:00Z');
  assert.equal(P.dte(new Date(Date.UTC(2026, 10, 20)), now), 7);
  assert.equal(P.cushionPct(25000, 100000), 25); assert.equal(P.cushionBand(25), 'green');
  assert.equal(P.cushionBand(15), 'amber'); assert.equal(P.cushionBand(5), 'red');
  assert.equal(P.cushionPct(100, null), null);
  assert.ok(Math.abs(P.premiumCaptured(0.6, 1.5) - 0.6) < 1e-9);
  assert.equal(P.isITM({ type: 'put', strike: 35 }, 30), true);
  assert.equal(P.isITM({ type: 'call', strike: 950 }, 900), false);
  assert.equal(P.isITM({ type: 'put', strike: 35 }, null), null);
  assert.equal(P.remainingNotional({ type: 'put', strike: 35, remain: 20 }), 70000);
  assert.equal(P.netDeltaExposure({ type: 'put', qty: -2, delta: -0.3 }), 60);
  assert.equal(P.netDeltaExposure({ type: 'equity', qty: 100, delta: null }), 100);
});

test('duplicate strike detection + CSV shape', () => {
  const mk = (id) => ({ underlying: 'ACME', expiryISO: '2026-11-20', strike: 35, type: 'put', orderId: id });
  const dups = P.duplicateOrderKeys([mk('1'), mk('2'), { underlying: 'XYZ', expiryISO: '2026-11-20', strike: 35, type: 'put' }]);
  assert.equal(dups['ACME|2026-11-20|35'], true);
  const csv = P.ordersToCsv([{ instrument: "ACME Nov20'26 35 Put", underlying: 'ACME', expiryISO: '2026-11-20', strike: 35, type: 'put', action: 'Buy', qty: 20, filled: 0, remain: 20, status: 'Submitted', statusDate: new Date('2026-10-12T09:30:00Z'), limitPrice: 4.65, tif: 'GTC', account: 'U00000000', orderId: '1' }], '2026-11-13T00:00:00.000Z');
  assert.ok(csv.startsWith('# generated-at: 2026-11-13'));
  assert.ok(csv.split('\n')[1].startsWith('instrument,underlying,expiry'));
});
