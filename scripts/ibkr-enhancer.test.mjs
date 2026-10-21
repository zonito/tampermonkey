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
new Function('module', 'exports', parserSrc + '\nmodule.exports = { parseNumber, parseInstrument, normalizeHeader, parsePositionRow, parseOrderRow, parseOrderMeta, parseStatus, dte, ageDays, cushionPct, cushionBand, premiumCaptured, isITM, netDeltaExposure, remainingNotional, duplicateOrderKeys, orderKey, isTerminalStatus, isOpenOrder, summarizeOrders, defaultFilterState, filterIsActive, matchesRowFilters, buildOrdersSnapshot, gtcTargetLimit, gtcChipState, wingPairState, ccCoverageState, parseInstrumentSearch, buildPositionsSnapshot, findShortPosition, ticketFillPlan, positionsToCsv, ordersToCsv, formatLondonCapturedAt, currencyFromText, brokerOrderFromParsed, exportedOrdersComplete, buildBrokerSnapshots, buildAccountSnapshot, accountSyncFingerprint, accountSyncDecision, parseFeedAccounts, isFeedAccountAllowed };')(mod, mod.exports);
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

test('terminal statuses: cancelled twin gives no duplicate and contributes 0', () => {
  const base = { underlying: 'AXTI', expiryISO: '2026-11-20', strike: 75, type: 'call', remain: 8, statusDate: new Date('2026-10-01T14:48:00Z') };
  const submitted = { ...base, status: 'Submitted' };
  const cancelled = { ...base, status: 'Cancelled' };
  const dups = P.duplicateOrderKeys([submitted, cancelled]);
  assert.deepEqual(dups, {});
  const s = P.summarizeOrders([submitted, cancelled], new Date('2026-11-13T12:00:00Z'));
  assert.equal(s.openCount, 1);
  assert.equal(s.totalNotional, 8 * 75 * 100);
  assert.equal(s.staleCount, 1);
  for (const t of ['Cancelled', 'ApiCancelled', 'Filled', 'Inactive', 'Expired', 'Rejected']) assert.equal(P.isTerminalStatus(t), true, t);
  assert.equal(P.isOpenOrder(submitted), true); assert.equal(P.isOpenOrder(cancelled), false);
  // two genuinely open twins still flag
  const d2 = P.duplicateOrderKeys([submitted, { ...base, status: 'Submitted' }]);
  assert.equal(d2['AXTI|2026-11-20|75'], true);
});

test('segmented filter state: contradictory states impossible by construction', () => {
  const ps = P.defaultFilterState('positions');
  assert.deepEqual(Object.keys(ps).sort(), ['expirySeg', 'itmOnly', 'text', 'typeSeg']);
  assert.equal(ps.typeSeg, 'all'); assert.equal(ps.expirySeg, 'any');
  const eq = { instrument: 'ACME Acme', underlying: 'ACME', type: 'equity', expiry: null, _itm: null };
  const opt = { instrument: "ACME Nov20'26 35 Put", underlying: 'ACME', type: 'put', expiry: new Date(Date.UTC(2026, 10, 20)), _itm: false };
  const now = new Date('2026-11-13T12:00:00Z');
  ps.typeSeg = 'options';
  assert.equal(P.matchesRowFilters(opt, 'positions', ps, now), true);
  assert.equal(P.matchesRowFilters(eq, 'positions', ps, now), false);
  ps.typeSeg = 'equities'; // single scalar: selecting Equities replaces Options, never both
  assert.equal(P.matchesRowFilters(eq, 'positions', ps, now), true);
  assert.equal(P.matchesRowFilters(opt, 'positions', ps, now), false);
  ps.typeSeg = 'all'; ps.expirySeg = 'd7';
  assert.equal(P.matchesRowFilters(opt, 'positions', ps, now), true);
  ps.expirySeg = 'd21'; // one expiry value at a time; <=7 and <=21 cannot combine
  assert.equal(P.matchesRowFilters(opt, 'positions', ps, now), true);
  const os = P.defaultFilterState('orders');
  assert.deepEqual(Object.keys(os).sort(), ['sideSeg', 'stale', 'text']);
  const buy = { instrument: 'X 1', underlying: 'X', type: 'put', action: 'Buy', status: 'Submitted', statusDate: new Date('2026-11-01T00:00:00Z') };
  os.sideSeg = 'buys'; assert.equal(P.matchesRowFilters(buy, 'orders', os, now), true);
  os.sideSeg = 'sells'; assert.equal(P.matchesRowFilters(buy, 'orders', os, now), false);
  assert.equal(P.filterIsActive(os, 'orders'), true);
  assert.equal(P.filterIsActive(P.defaultFilterState('orders'), 'orders'), false);
});

test('GTC chips: green / amber / red + escalation + stale + snapshot keeps open only', () => {
  const short = { underlying: 'AXTI', expiryISO: '2026-11-20', strike: 75, type: 'call', qty: -2, last: 1.0, avgPrice: 2.0 };
  const mkSnap = (limit, savedAt) => ({ savedAt, orders: [{ underlying: 'AXTI', expiryISO: '2026-11-20', strike: 75, type: 'call', action: 'Buy', limitPrice: limit, remain: 2, status: 'Submitted' }] });
  const now = new Date('2026-11-13T12:00:00Z');
  assert.equal(P.gtcTargetLimit(2.0), 0.8);
  const green = P.gtcChipState(short, mkSnap(0.8, now.toISOString()), now);
  assert.equal(green.state, 'green'); assert.ok(Math.abs(green.pct - 0.6) < 1e-9);
  const amber = P.gtcChipState(short, mkSnap(1.5, now.toISOString()), now);
  assert.equal(amber.state, 'amber'); assert.ok(Math.abs(amber.pct - 0.25) < 1e-9);
  const red = P.gtcChipState({ ...short, last: 0.5 }, { savedAt: now.toISOString(), orders: [] }, now);
  assert.equal(red.state, 'red'); assert.equal(red.escalated, true); // captured 75% already
  const stale = P.gtcChipState(short, mkSnap(0.8, '2026-11-11T12:00:00Z'), now);
  assert.equal(stale.stale, true); assert.equal(stale.state, 'green');
  const snap = P.buildOrdersSnapshot([
    { ...short, action: 'Buy', status: 'Submitted', limitPrice: 0.8, remain: 2, orderId: '1' },
    { ...short, action: 'Buy', status: 'Cancelled', limitPrice: 0.8, remain: 2, orderId: '2' },
  ], now.toISOString());
  assert.equal(snap.orders.length, 1); assert.equal(snap.orders[0].orderId, '1');
});

test('wing pairing: paired, partial, orphan, orphan-exit, quantity consumption', () => {
  const put = (qty, strike, exp) => ({ underlying: 'AXTI', type: 'put', qty, strike, expiryISO: exp });
  // paired: long put 30 < short put 35, same expiry
  let w = P.wingPairState([put(2, 30, '2026-11-20'), put(-2, 35, '2026-11-20')], null);
  assert.equal(w.byIndex[0].state, 'paired'); assert.deepEqual(w.wingedShorts, [1]);
  // partial: wing qty 3, short only 2
  w = P.wingPairState([put(3, 30, '2026-11-20'), put(-2, 35, '2026-11-20')], null);
  assert.equal(w.byIndex[0].state, 'partial'); assert.equal(w.byIndex[0].coveredQty, 2);
  // orphan: long strike above short strike for puts does not pair
  w = P.wingPairState([put(1, 40, '2026-11-20'), put(-1, 35, '2026-11-20')], null);
  assert.equal(w.byIndex[0].state, 'orphan');
  // orphan with working Sell exit order in snapshot
  const snap = { savedAt: '2026-11-13T00:00:00Z', orders: [{ underlying: 'AXTI', expiryISO: '2026-11-20', strike: 40, type: 'put', action: 'Sell', limitPrice: 1, remain: 1, status: 'Submitted' }] };
  w = P.wingPairState([put(1, 40, '2026-11-20'), put(-1, 35, '2026-11-20')], snap);
  assert.equal(w.byIndex[0].state, 'orphan-exit');
  // quantity consumption: one short of 1 cannot validate two wings
  w = P.wingPairState([put(1, 30, '2026-11-20'), put(1, 28, '2026-11-20'), put(-1, 35, '2026-11-20')], null);
  assert.equal(w.byIndex[0].state, 'paired');
  assert.equal(w.byIndex[1].state, 'orphan');
  // calls mirror: long strike > short strike
  const call = (qty, strike, exp) => ({ underlying: 'AXTI', type: 'call', qty, strike, expiryISO: exp });
  w = P.wingPairState([call(1, 60, '2026-11-20'), call(-1, 50, '2026-11-20')], null);
  assert.equal(w.byIndex[0].state, 'paired');
  // nearest expiry preferred: long Dec, shorts Nov (invalid, earlier) and Dec
  w = P.wingPairState([put(1, 30, '2026-12-18'), put(-1, 35, '2026-11-20'), put(-1, 36, '2026-12-18')], null);
  assert.equal(w.byIndex[0].pairs[0].shortIndex, 2);
});

test('covered-call coverage: position-only green, order-only amber, mixed, neither', () => {
  const eq = { underlying: 'AXTI', type: 'equity', qty: 2000 }; // capacity 20
  const sc = (qty, strike) => ({ underlying: 'AXTI', type: 'call', qty, strike, expiryISO: '2026-11-20' });
  const snap = (remain) => ({ savedAt: '2026-11-13T00:00:00Z', orders: [{ underlying: 'AXTI', type: 'call', action: 'Sell', strike: 85, expiryISO: '2026-12-18', limitPrice: 3.5, remain, status: 'Submitted' }] });
  // position-only: full and partial earn their states from positions alone
  let s = P.ccCoverageState(eq, [eq, sc(-20, 80)], null);
  assert.equal(s.state, 'full'); assert.equal(s.posCovered, 20); assert.equal(s.orderRemain, 0);
  s = P.ccCoverageState(eq, [eq, sc(-10, 80)], null);
  assert.equal(s.state, 'partial'); assert.equal(s.posCovered, 10);
  // order-only: NEVER full/green, however large the remain
  s = P.ccCoverageState(eq, [eq], snap(20));
  assert.equal(s.state, 'order'); assert.equal(s.posCovered, 0); assert.equal(s.orderRemain, 20);
  // mixed: 10 position + order for the rest
  s = P.ccCoverageState(eq, [eq, sc(-10, 80)], snap(10));
  assert.equal(s.state, 'mixed'); assert.equal(s.posCovered, 10); assert.equal(s.orderRemain, 10);
  // neither: long call does not cover, no orders
  s = P.ccCoverageState(eq, [eq, sc(5, 80)], null);
  assert.equal(s.state, 'none'); assert.equal(s.posCovered, 0); assert.equal(s.orderRemain, 0);
  s = P.ccCoverageState({ underlying: 'AXTI', type: 'equity', qty: 99 }, [eq], snap(10));
  assert.equal(s.capacity, 0);
});

test('ticket fill target math + short position lookup', () => {
  assert.equal(P.gtcTargetLimit(2.0), 0.8);
  assert.equal(P.gtcTargetLimit(1.234), 0.49); // floor to cent of 0.4936
  assert.equal(P.gtcTargetLimit(0), null);
  const key = P.parseInstrumentSearch("Close AXTI Nov20'26 75 Call quantity");
  assert.equal(key.underlying, 'AXTI'); assert.equal(key.strike, 75); assert.equal(key.type, 'call');
  const positions = P.buildPositionsSnapshot([
    { underlying: 'AXTI', expiryISO: '2026-11-20', strike: 75, type: 'call', qty: -3, avgPrice: 2.0 },
    { underlying: 'AXTI', expiryISO: '2026-11-20', strike: 75, type: 'put', qty: -3, avgPrice: 2.0 },
  ], '2026-11-13T00:00:00Z').positions;
  const found = P.findShortPosition(positions, key);
  assert.equal(found.qty, -3); assert.equal(Math.abs(found.qty), 3);
  assert.equal(P.findShortPosition(positions, { ...key, strike: 80 }), null);
});

test('ticket fill plan blocks: stale, alias mismatch, bad target, no match', () => {
  const pos = { underlying: 'AXTI', expiryISO: '2026-11-20', strike: 75, type: 'call', qty: -3, avgPrice: 2.0, last: 1.0 };
  const ok = P.ticketFillPlan(pos, {});
  assert.equal(ok.blocked, null); assert.equal(ok.qty, 3); assert.equal(ok.limit, 0.8);
  assert.ok(Math.abs(ok.capturePct - 60) < 1e-9);
  assert.equal(P.ticketFillPlan(null, {}).blocked, 'NO_MATCH');
  assert.equal(P.ticketFillPlan(pos, { staleSnapshot: true }).blocked, 'STALE_SNAPSHOT');
  assert.equal(P.ticketFillPlan(pos, { aliasMismatch: true }).blocked, 'ALIAS_MISMATCH');
  assert.equal(P.ticketFillPlan({ ...pos, avgPrice: 0.01 }, {}).blocked, 'BAD_TARGET');
  assert.equal(P.ticketFillPlan({ ...pos, avgPrice: 0 }, {}).blocked, 'BAD_TARGET');
  assert.equal(P.ticketFillPlan({ ...pos, avgPrice: null }, {}).blocked, 'BAD_TARGET');
});

test('Kubera payload builder: grouping, terminal exclusion, complete flag', () => {
  const OH = ['', 'Orders', 'Action', 'Filled/Remain', 'Status', 'Price', 'Account', 'Order id', '', ''];
  const mkRow = (account, id, status) => P.parseOrderRow(OH, ['', "ACME Nov20'26 35 Put\nACME Nov20'26 35 Put Limit 0.60, GTC", 'Buy', '0/2', status + ' 10/12/2026, 9:30 AM', '—', account, id, '', ''], id);
  const rows = [mkRow('FAKE-A1', '1001', 'Submitted'), mkRow('FAKE-A1', '1002', 'Cancelled'), mkRow('FAKE-B2', '2001', 'Submitted')];
  rows[0]._raw = "ACME Nov20'26 35 Put Limit 0.60, GTC USD";
  const snaps = P.buildBrokerSnapshots(rows, { capturedAt: '2026-10-21T10:00:00+01:00', complete: true, ingestSource: 'test', accountLabels: { 'FAKE-A1': 'FakeOne' } });
  assert.equal(snaps.length, 2); // grouped per account, never merged
  assert.equal(snaps[0].account_id, 'FAKE-A1'); assert.equal(snaps[0].account_label, 'FakeOne');
  assert.equal(snaps[0].orders.length, 1); // Cancelled terminal excluded
  assert.equal(snaps[1].orders.length, 1);
  const o = snaps[0].orders[0];
  assert.equal(o.order_id, '1001'); assert.equal(o.symbol, 'ACME'); assert.equal(o.asset_type, 'option');
  assert.equal(o.expiry_date, '2026-11-20'); assert.equal(o.strike_price, 35); assert.equal(o.option_type, 'Put');
  assert.equal(o.qty_total, 2); assert.equal(o.qty_remain, 2); assert.equal(o.limit_price, 0.6);
  assert.equal(o.tif, 'GTC'); assert.equal(o.status, 'Submitted'); assert.ok(o.status_at);
  assert.equal(o.currency, 'USD'); assert.deepEqual(o.legs, []);
  assert.equal(P.exportedOrdersComplete(23, null), true);
  assert.equal(P.exportedOrdersComplete(23, 23), true);
  assert.equal(P.exportedOrdersComplete(10, 23), false); // pager shows more than rendered
  const equity = P.brokerOrderFromParsed({ underlying: 'ACME', type: 'equity', expiryISO: null, strike: null, action: 'Buy', qty: 10, filled: 0, remain: 10, limitPrice: 55, tif: 'GTC', status: 'Submitted', statusDate: null, orderId: '3001' }, 'ACME Buy Limit 55.00, GTC');
  assert.equal(equity.asset_type, 'equity'); assert.equal(equity.expiry_date, null); assert.equal(equity.option_type, null);
});

test('London captured_at carries the Europe/London offset', () => {
  assert.ok(P.formatLondonCapturedAt(new Date('2026-01-15T12:00:00Z')).endsWith('+00:00'));
  assert.ok(P.formatLondonCapturedAt(new Date('2026-07-15T12:00:00Z')).endsWith('+01:00'));
  assert.ok(P.formatLondonCapturedAt(new Date('2026-07-15T12:00:00Z')).startsWith('2026-07-15T13:00:00'));
});


test('account snapshot builder: complete and fallback dash-to-null', () => {
  const ctx = {
    headline: 100000, alias: 'FakeOne', accountId: 'FAKE-A1', currency: 'USD',
    fields: { 'Excess Liquidity': 25000, 'Buying Power': 50000, 'Maintenance Margin': 60000, 'Unrealized P&L': -1000, 'Realized P&L': 0, 'Settled Cash': 5000 },
  };
  const snap = P.buildAccountSnapshot(ctx, '2026-10-21T18:30:00+01:00');
  assert.equal(snap.ingest_source, 'tampermonkey-ibkr');
  assert.equal(snap.account_id, 'FAKE-A1'); assert.equal(snap.account_label, 'FakeOne');
  assert.equal(snap.complete, true);
  assert.equal(snap.values.net_liquidation, 100000);
  assert.equal(snap.values.realized_pnl, 0); // a real zero stays zero
  const fallback = P.buildAccountSnapshot(
    { headline: null, alias: 'FakeOne', accountId: 'FAKE-A1', currency: null, fields: { 'Excess Liquidity': 25000, 'Buying Power': null } },
    '2026-10-21T18:30:00+01:00',
  );
  assert.equal(fallback.complete, false);
  assert.equal(fallback.values.net_liquidation, null); // dash -> null, never 0
  assert.equal(fallback.values.buying_power, null);
  assert.equal(fallback.values.settled_cash, null); // absent field -> null, not omitted
  assert.equal(fallback.currency, 'USD');
});

test('account sync throttle: 60s gate, heartbeat, account change', () => {
  const snap = (bp) => P.buildAccountSnapshot({
    headline: 100000, alias: 'FakeOne', accountId: 'FAKE-A1', currency: 'USD',
    fields: { 'Excess Liquidity': 25000, 'Buying Power': bp },
  }, '2026-10-21T18:30:00+01:00');
  const t0 = 1000000;
  const state = { lastAttemptAt: 0, lastSentAt: 0, lastSentFingerprint: '', lastSentAccount: null };
  assert.equal(P.accountSyncDecision(state, snap(50000), t0).reason, 'first');
  state.lastAttemptAt = t0; state.lastSentAt = t0;
  state.lastSentFingerprint = P.accountSyncFingerprint(snap(50000)); state.lastSentAccount = 'FAKE-A1';
  assert.equal(P.accountSyncDecision(state, snap(51000), t0 + 30000).reason, 'throttled'); // no second send inside 60s
  assert.equal(P.accountSyncDecision(state, snap(51000), t0 + 61000).reason, 'changed');
  assert.equal(P.accountSyncDecision(state, snap(50000), t0 + 120000).reason, 'unchanged'); // inside heartbeat window
  assert.equal(P.accountSyncDecision(state, snap(50000), t0 + 301000).reason, 'heartbeat'); // unchanged still pulses at 5 min
  const other = { ...snap(50000), account_id: 'FAKE-B2' };
  assert.equal(P.accountSyncDecision(state, other, t0 + 10000).reason, 'account_change'); // immediate on switch
});


test('feed account allowlist gates sync decision and orders builder', () => {
  assert.deepEqual(P.parseFeedAccounts(' FAKE-A1, FAKE-B2 ,'), ['FAKE-A1', 'FAKE-B2']);
  assert.equal(P.isFeedAccountAllowed('FAKE-A1', 'FAKE-A1,FAKE-B2'), true);
  assert.equal(P.isFeedAccountAllowed('FAKE-C3', 'FAKE-A1,FAKE-B2'), false);
  const snap = (id) => ({ account_id: id, values: { net_liquidation: 1 } });
  const state = { lastAttemptAt: 0, lastSentAt: 0, lastSentFingerprint: '', lastSentAccount: null };
  assert.deepEqual(P.accountSyncDecision(state, snap('FAKE-C3'), 1000, 'FAKE-A1,FAKE-B2'), { send: false, reason: 'not_in_scope' });
  assert.equal(P.accountSyncDecision(state, snap('FAKE-A1'), 1000, 'FAKE-A1,FAKE-B2').send, true);
  const OH = ['', 'Orders', 'Action', 'Filled/Remain', 'Status', 'Price', 'Account', 'Order id', '', ''];
  const mkRow = (account, id) => P.parseOrderRow(OH, ['', "ACME Nov20'26 35 Put\nACME Nov20'26 35 Put Limit 0.60, GTC", 'Buy', '0/2', 'Submitted 10/12/2026, 9:30 AM', '—', account, id, '', ''], id);
  const rows = [mkRow('FAKE-A1', '1001'), mkRow('FAKE-C3', '3001')];
  const filtered = P.buildBrokerSnapshots(rows, { capturedAt: '2026-10-21T10:00:00+01:00', complete: true, feedAccounts: 'FAKE-A1,FAKE-B2' });
  assert.deepEqual(filtered.map((s) => s.account_id), ['FAKE-A1']); // non-allowlisted group dropped
  const unfiltered = P.buildBrokerSnapshots(rows, { capturedAt: '2026-10-21T10:00:00+01:00', complete: true });
  assert.equal(unfiltered.length, 2); // no allowlist configured -> unchanged
});

test('duplicate strike detection + CSV shape', () => {
  const mk = (id) => ({ underlying: 'ACME', expiryISO: '2026-11-20', strike: 35, type: 'put', orderId: id });
  const dups = P.duplicateOrderKeys([mk('1'), mk('2'), { underlying: 'XYZ', expiryISO: '2026-11-20', strike: 35, type: 'put' }]);
  assert.equal(dups['ACME|2026-11-20|35'], true);
  const csv = P.ordersToCsv([{ instrument: "ACME Nov20'26 35 Put", underlying: 'ACME', expiryISO: '2026-11-20', strike: 35, type: 'put', action: 'Buy', qty: 20, filled: 0, remain: 20, status: 'Submitted', statusDate: new Date('2026-10-12T09:30:00Z'), limitPrice: 4.65, tif: 'GTC', account: 'U00000000', orderId: '1' }], '2026-11-13T00:00:00.000Z');
  assert.ok(csv.startsWith('# generated-at: 2026-11-13'));
  assert.ok(csv.split('\n')[1].startsWith('instrument,underlying,expiry'));
});
