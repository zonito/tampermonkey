// ==UserScript==
// @name         IBKR Enhancer
// @namespace    https://github.com/zonito/tampermonkey
// @version      0.8.1
// @description  Read-only scan aids for IBKR Client Portal: margin cushion, option expiry/ITM/premium badges, grouping, filters, order age and CSV copy. Never places, cancels or modifies orders. Optional: exports open orders to local Kubera only.
// @author       Zonito
// @match        https://www.interactivebrokers.co.uk/portal/*
// @match        https://www.interactivebrokers.com/portal/*
// @run-at       document-idle
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// @connect      localhost
// ==/UserScript==

(function () {
  'use strict';

  var LOG = '[IBKR Enhancer]';
  function log() {
    try { console.log.apply(console, [LOG].concat(Array.prototype.slice.call(arguments))); } catch (e) { /* silent */ }
  }

  // ================= PARSER START =================
  // Pure functions only: no DOM, no globals. Extracted by ibkr-enhancer.test.mjs.
  var EM_DASH = '\u2014';
  var MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

  function parseNumber(raw) {
    if (raw === null || raw === undefined) return null;
    var s = String(raw).trim();
    if (!s || s === EM_DASH || s === '-' || s === '--') return null;
    if (s.charAt(0) === 'C' && /\d/.test(s.charAt(1))) s = s.slice(1).trim();
    s = s.replace(/,/g, '').replace(/\s*(USD|GBP|EUR|CHF|CAD|AUD)\s*$/i, '').trim();
    var mult = 1;
    if (/B$/i.test(s)) { mult = 1e9; s = s.slice(0, -1); }
    else if (/M$/i.test(s)) { mult = 1e6; s = s.slice(0, -1); }
    else if (/K$/i.test(s)) { mult = 1e3; s = s.slice(0, -1); }
    if (s.charAt(s.length - 1) === '%') s = s.slice(0, -1);
    s = s.trim();
    if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
    var n = Number(s);
    return isFinite(n) ? n * mult : null;
  }

  function parseInstrument(text) {
    var t = String(text || '').trim().replace(/\s+/g, ' ');
    var m = t.match(/^(\S+)\s+([A-Z][a-z]{2})(\d{2})'(\d{2})\s+([\d,]+(?:\.\d+)?)\s+(Put|Call)\b/i);
    if (m) {
      var mon = MONTHS[m[2].charAt(0).toUpperCase() + m[2].slice(1).toLowerCase()];
      if (mon === undefined) {
        var tk = t.split(' ')[0] || '';
        return { instrument: t, underlying: tk, type: 'equity', expiry: null, expiryISO: null, strike: null };
      }
      var expiry = new Date(Date.UTC(2000 + Number(m[4]), mon, Number(m[3])));
      return { instrument: (m[1] + ' ' + m[2] + m[3] + "'" + m[4] + ' ' + m[5] + ' ' + m[6]),
        underlying: m[1], type: m[6].toLowerCase(), expiry: expiry,
        expiryISO: expiry.toISOString().slice(0, 10), strike: parseNumber(m[5]) };
    }
    var ticker = t.split(' ')[0] || '';
    return { instrument: t, underlying: ticker, type: 'equity', expiry: null, expiryISO: null, strike: null };
  }

  function normalizeHeader(h) {
    var s = String(h || '').trim().toLowerCase().replace(/\s+/g, ' ');
    var map = {
      'instrument': 'instrument', 'position': 'position', 'change %': 'changePct',
      'cost basis': 'costBasis', 'market value': 'marketValue', 'last': 'last',
      'last price': 'last', 'avg price': 'avgPrice', 'daily p&l': 'dailyPnl',
      'unrealized p&l': 'unrealizedPnl', 'delta': 'delta',
      '52wk iv rank': 'ivRank', '52 week iv rank': 'ivRank',
      '52wk iv pctl': 'ivPctl', '52 iv perc.': 'ivPctl', '52wk iv pctl %': 'ivPctl',
      'orders': 'orders', 'action': 'action', 'filled/remain': 'filledRemain',
      'status': 'status', 'price': 'price', 'account': 'account', 'order id': 'orderId',
      'market cap': 'marketCap', 'market capitalization': 'marketCap',
      'p/e': 'pe', 'p/e excluding extraordinary items': 'pe', 'forward p/e': 'forwardPe', 'beta': 'beta'
    };
    return map[s] || null;
  }

  function headerIndex(headers) {
    var idx = {};
    (headers || []).forEach(function (h, i) {
      var key = normalizeHeader(h);
      if (key && idx[key] === undefined) idx[key] = i;
    });
    return idx;
  }

  function parsePositionRow(headers, cells) {
    var idx = headerIndex(headers);
    function c(key) { var i = idx[key]; return i === undefined ? null : cells[i]; }
    var inst = parseInstrument(c('instrument'));
    return { instrument: inst.instrument, underlying: inst.underlying, type: inst.type,
      expiry: inst.expiry, expiryISO: inst.expiryISO, strike: inst.strike,
      qty: parseNumber(c('position')), last: parseNumber(c('last')),
      avgPrice: parseNumber(c('avgPrice')), costBasis: parseNumber(c('costBasis')),
      marketValue: parseNumber(c('marketValue')), dailyPnl: parseNumber(c('dailyPnl')),
      unrealizedPnl: parseNumber(c('unrealizedPnl')), delta: parseNumber(c('delta')),
      ivRank: parseNumber(c('ivRank')) };
  }

  function parseOrderMeta(ordersText) {
    var t = String(ordersText || '');
    var m = t.match(/(Limit|Market|Stop(?:\s+Limit)?)\s+([\d,]+(?:\.\d+)?)?\s*,\s*(GTC|DAY|GTD|IOC|OPG)\b/i);
    if (!m) {
      var tifOnly = t.match(/,\s*(GTC|DAY|GTD|IOC|OPG)\b/i);
      return { orderType: null, limitPrice: null, tif: tifOnly ? tifOnly[1].toUpperCase() : null };
    }
    return { orderType: m[1], limitPrice: m[2] ? parseNumber(m[2]) : null, tif: m[3].toUpperCase() };
  }

  function parseStatus(statusText) {
    var t = String(statusText || '').trim().replace(/\s+/g, ' ');
    var m = t.match(/^([A-Za-z]+)\s+(.*)$/);
    var word = m ? m[1] : t;
    var rest = m ? m[2] : '';
    var dm = rest.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:,\s*(\d{1,2}):(\d{2})\s*(AM|PM)?)?/i);
    var date = null;
    if (dm) {
      var hh = Number(dm[4] || 0);
      if (/PM/i.test(dm[6] || '') && hh < 12) hh += 12;
      if (/AM/i.test(dm[6] || '') && hh === 12) hh = 0;
      date = new Date(Date.UTC(Number(dm[3]), Number(dm[1]) - 1, Number(dm[2]), hh, Number(dm[5] || 0)));
    }
    return { status: word, statusDate: date, statusDateRaw: rest || null };
  }

  function parseOrderRow(headers, cells, dataId) {
    var idx = headerIndex(headers);
    function c(key) { var i = idx[key]; return i === undefined ? null : cells[i]; }
    var ordersText = c('orders') || '';
    var firstLine = String(ordersText).split('\n').map(function (s) { return s.trim(); }).filter(Boolean)[0] || '';
    var inst = parseInstrument(firstLine);
    var meta = parseOrderMeta(ordersText);
    var frText = c('filledRemain') || '';
    var fr = String(frText).match(/(-?[\d,]+)\s*\/\s*(-?[\d,]+)/);
    var filled = fr ? parseNumber(fr[1]) : null;
    var remain = fr ? parseNumber(fr[2]) : null;
    var st = parseStatus(c('status') || '');
    var colId = c('orderId') ? String(c('orderId')).trim() : '';
    var did = dataId ? String(dataId).trim() : '';
    return { instrument: inst.instrument, underlying: inst.underlying, type: inst.type,
      expiry: inst.expiry, expiryISO: inst.expiryISO, strike: inst.strike,
      action: c('action') ? String(c('action')).trim() : null,
      qty: (filled === null && remain === null) ? null : (filled || 0) + (remain || 0),
      filled: filled, remain: remain, status: st.status, statusDate: st.statusDate,
      limitPrice: meta.limitPrice, orderType: meta.orderType, tif: meta.tif,
      account: c('account') ? String(c('account')).trim() : null,
      orderId: colId || did || null, orderIdCorroborated: !!(colId && did && colId === did) };
  }

  function londonToday(now) {
    var d = now ? new Date(now) : new Date();
    try {
      var parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(d);
      var y = 0, mo = 0, da = 0;
      parts.forEach(function (p) { if (p.type === 'year') y = Number(p.value); if (p.type === 'month') mo = Number(p.value); if (p.type === 'day') da = Number(p.value); });
      return Date.UTC(y, mo - 1, da);
    } catch (e) { return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()); }
  }

  function dte(expiry, now) {
    if (!expiry) return null;
    var e = expiry instanceof Date ? expiry : new Date(expiry);
    return Math.round((Date.UTC(e.getUTCFullYear(), e.getUTCMonth(), e.getUTCDate()) - londonToday(now)) / 86400000);
  }

  function ageDays(statusDate, now) {
    if (!statusDate) return null;
    var s = statusDate instanceof Date ? statusDate : new Date(statusDate);
    return Math.floor(((now ? new Date(now).getTime() : Date.now()) - s.getTime()) / 86400000);
  }

  function cushionPct(excessLiquidity, nlv) {
    if (excessLiquidity === null || excessLiquidity === undefined || !nlv) return null;
    return (excessLiquidity / nlv) * 100;
  }
  function cushionBand(pct) {
    if (pct === null || pct === undefined || !isFinite(pct)) return null;
    return pct > 20 ? 'green' : (pct >= 10 ? 'amber' : 'red');
  }
  function premiumCaptured(last, avgPrice) {
    if (last === null || last === undefined || !avgPrice) return null;
    return 1 - (last / avgPrice);
  }
  function isITM(row, underlyingLast) {
    if (!row || row.type === 'equity' || underlyingLast === null || underlyingLast === undefined) return null;
    if (row.type === 'put') return underlyingLast < row.strike;
    if (row.type === 'call') return underlyingLast > row.strike;
    return null;
  }
  function netDeltaExposure(row) {
    if (!row) return null;
    if (row.type === 'equity') return row.qty;
    if (row.qty === null || row.qty === undefined || row.delta === null || row.delta === undefined) return null;
    return row.qty * row.delta * 100;
  }
  function remainingNotional(row) {
    if (!row || row.type === 'equity' || row.remain === null || row.remain === undefined || !row.strike) return null;
    return row.remain * row.strike * 100;
  }
  var TERMINAL_STATUSES = { Cancelled: true, ApiCancelled: true, Filled: true, Inactive: true, Expired: true, Rejected: true };
  function isTerminalStatus(status) { return !!TERMINAL_STATUSES[String(status || '').trim()]; }
  function isOpenOrder(o) { return !!o && !isTerminalStatus(o.status); }
  function summarizeOrders(orders, now) {
    var openCount = 0, totalNotional = 0, staleCount = 0;
    (orders || []).forEach(function (o) {
      if (!isOpenOrder(o)) return;
      openCount++;
      var notion = remainingNotional(o);
      if (notion !== null) totalNotional += notion;
      var age = ageDays(o.statusDate, now);
      if (age !== null && age > 14) staleCount++;
    });
    return { openCount: openCount, totalNotional: totalNotional, staleCount: staleCount };
  }
  function buildOrdersSnapshot(orders, savedAt) {
    return { savedAt: savedAt || null, orders: (orders || []).filter(isOpenOrder).map(function (o) {
      return { underlying: o.underlying, expiryISO: o.expiryISO || null, strike: o.strike, type: o.type,
        action: o.action, limitPrice: o.limitPrice, remain: o.remain, status: o.status, orderId: o.orderId || null };
    }) };
  }
  function gtcTargetLimit(avgPrice) {
    if (avgPrice === null || avgPrice === undefined || !(avgPrice > 0)) return null;
    return Math.floor(0.40 * avgPrice * 100) / 100;
  }
  function gtcChipState(row, snapshot, now) {
    var orders = (snapshot && snapshot.orders) || [];
    var savedAt = snapshot && snapshot.savedAt ? new Date(snapshot.savedAt).getTime() : null;
    var stale = savedAt !== null && ((now ? new Date(now).getTime() : Date.now()) - savedAt > 24 * 3600 * 1000);
    var matches = orders.filter(function (o) {
      return o && o.action === 'Buy' && o.underlying === row.underlying && o.expiryISO === row.expiryISO &&
        o.strike === row.strike && o.type === row.type;
    });
    matches.sort(function (a, b) {
      var la = a.limitPrice === null || a.limitPrice === undefined ? Infinity : a.limitPrice;
      var lb = b.limitPrice === null || b.limitPrice === undefined ? Infinity : b.limitPrice;
      return la - lb;
    });
    var match = matches.length ? matches[0] : null;
    var captured = premiumCaptured(row.last, row.avgPrice);
    if (!match) return { state: 'red', pct: null, order: null, stale: stale, escalated: captured !== null && captured >= 0.6, snapshotAt: savedAt };
    var pct = (row.avgPrice && match.limitPrice !== null && match.limitPrice !== undefined) ? (1 - (match.limitPrice / row.avgPrice)) : null;
    var target = gtcTargetLimit(row.avgPrice);
    var green = target !== null && match.limitPrice !== null && match.limitPrice !== undefined && match.limitPrice <= target;
    return { state: green ? 'green' : 'amber', pct: pct, order: match, stale: stale, escalated: false, target: target, snapshotAt: savedAt };
  }
  function wingPairState(positions, snapshot) {
    var rows = positions || [];
    var pool = {};
    rows.forEach(function (r, i) {
      if (r && r.type !== 'equity' && r.qty !== null && r.qty !== undefined && r.qty < 0) pool[i] = Math.abs(r.qty);
    });
    var snapOrders = (snapshot && snapshot.orders) || [];
    var byIndex = {}, winged = {};
    function expiryMs(r) { return r.expiryISO ? Date.parse(r.expiryISO + 'T00:00:00Z') : (r.expiry ? new Date(r.expiry).getTime() : NaN); }
    rows.forEach(function (r, i) {
      if (!r || r.type === 'equity' || r.qty === null || r.qty === undefined || r.qty <= 0) return;
      var candidates = [];
      rows.forEach(function (s, j) {
        if (!pool[j]) return;
        if (s.underlying !== r.underlying || s.type !== r.type) return;
        if (r.type === 'put' && !(r.strike < s.strike)) return;
        if (r.type === 'call' && !(r.strike > s.strike)) return;
        var le = expiryMs(r), se = expiryMs(s);
        if (isFinite(le) && isFinite(se) && le < se) return;
        candidates.push({ idx: j, expiryDist: (isFinite(le) && isFinite(se)) ? Math.abs(le - se) : 0, strikeDist: Math.abs(r.strike - s.strike) });
      });
      candidates.sort(function (a, b) { return (a.expiryDist - b.expiryDist) || (a.strikeDist - b.strikeDist); });
      var need = r.qty, pairs = [];
      candidates.forEach(function (c) {
        if (need <= 0) return;
        var take = Math.min(need, pool[c.idx]);
        if (take > 0) { pool[c.idx] -= take; need -= take; pairs.push({ shortIndex: c.idx, qty: take }); winged[c.idx] = true; }
      });
      var covered = r.qty - need;
      var state = covered >= r.qty ? 'paired' : (covered > 0 ? 'partial' : 'orphan');
      var hasExit = false;
      if (state === 'orphan') {
        hasExit = snapOrders.some(function (o) {
          return o && o.action === 'Sell' && o.underlying === r.underlying && o.expiryISO === r.expiryISO && o.strike === r.strike && o.type === r.type;
        });
        if (hasExit) state = 'orphan-exit';
      }
      byIndex[i] = { state: state, coveredQty: covered, neededQty: r.qty, pairs: pairs, hasExitOrder: hasExit };
    });
    return { byIndex: byIndex, wingedShorts: Object.keys(winged).map(Number) };
  }
  function ccCoverageState(equityRow, positions, snapshot) {
    var shares = equityRow && equityRow.qty !== null && equityRow.qty !== undefined ? equityRow.qty : 0;
    var capacity = Math.floor(Math.max(shares, 0) / 100);
    var covering = [], orderCovering = [];
    var shortContracts = 0;
    (positions || []).forEach(function (r) {
      if (r && r.type === 'call' && r.qty !== null && r.qty !== undefined && r.qty < 0 && r.underlying === equityRow.underlying) {
        shortContracts += Math.abs(r.qty);
        covering.push({ strike: r.strike, expiryISO: r.expiryISO || null, qty: Math.abs(r.qty), source: 'position' });
      }
    });
    var orderRemain = 0;
    (((snapshot && snapshot.orders) || [])).forEach(function (o) {
      if (o && o.action === 'Sell' && o.type === 'call' && o.underlying === equityRow.underlying && o.remain) {
        orderRemain += o.remain;
        orderCovering.push({ strike: o.strike, expiryISO: o.expiryISO || null, qty: o.remain, limitPrice: o.limitPrice !== undefined ? o.limitPrice : null, source: 'order' });
      }
    });
    // Only open short call POSITIONS earn green. Working Sell orders are a
    // separate amber contribution and never turn the chip green alone.
    var state;
    if (capacity > 0 && shortContracts >= capacity) state = 'full';
    else if (shortContracts > 0 && orderRemain > 0) state = 'mixed';
    else if (shortContracts > 0) state = 'partial';
    else if (orderRemain > 0) state = 'order';
    else state = 'none';
    return { capacity: capacity, covered: shortContracts, posCovered: shortContracts, shortContracts: shortContracts,
      orderRemain: orderRemain, covering: covering, orderCovering: orderCovering, state: state };
  }
  function parseInstrumentSearch(text) {
    var t = String(text || '').replace(/\s+/g, ' ');
    var m = t.match(/(\S+)\s+([A-Z][a-z]{2})(\d{2})'(\d{2})\s+([\d,]+(?:\.\d+)?)\s+(Put|Call)\b/i);
    if (!m) return null;
    var mon = MONTHS[m[2].charAt(0).toUpperCase() + m[2].slice(1).toLowerCase()];
    if (mon === undefined) return null;
    var expiry = new Date(Date.UTC(2000 + Number(m[4]), mon, Number(m[3])));
    return { instrument: (m[1] + ' ' + m[2] + m[3] + "'" + m[4] + ' ' + m[5] + ' ' + m[6]),
      underlying: m[1], type: m[6].toLowerCase(), expiry: expiry,
      expiryISO: expiry.toISOString().slice(0, 10), strike: parseNumber(m[5]) };
  }
  function buildPositionsSnapshot(positions, savedAt, alias) {
    return { savedAt: savedAt || null, alias: alias || null, positions: (positions || []).map(function (r) {
      return { underlying: r.underlying, expiryISO: r.expiryISO || null, strike: r.strike, type: r.type,
        qty: r.qty, avgPrice: r.avgPrice, last: (r.last !== undefined ? r.last : null) };
    }) };
  }
  function ticketFillPlan(pos, opts) {
    opts = opts || {};
    if (!pos) return { blocked: 'NO_MATCH' };
    if (opts.staleSnapshot) return { blocked: 'STALE_SNAPSHOT' };
    if (opts.aliasMismatch) return { blocked: 'ALIAS_MISMATCH' };
    var limit = gtcTargetLimit(pos.avgPrice);
    if (limit === null || limit <= 0 || (pos.avgPrice !== null && pos.avgPrice !== undefined && limit >= pos.avgPrice)) return { blocked: 'BAD_TARGET' };
    return { blocked: null, qty: Math.abs(pos.qty), limit: limit, avgPrice: pos.avgPrice,
      capturePct: (1 - (limit / pos.avgPrice)) * 100, last: (pos.last !== undefined ? pos.last : null) };
  }
  function findShortPosition(positions, key) {
    if (!key) return null;
    var found = null;
    (positions || []).forEach(function (r) {
      if (found || !r) return;
      if (r.underlying === key.underlying && r.expiryISO === key.expiryISO && r.strike === key.strike &&
          r.type === key.type && r.qty !== null && r.qty !== undefined && r.qty < 0) found = r;
    });
    return found;
  }
  function defaultFilterState(kind) {
    return kind === 'positions'
      ? { text: '', typeSeg: 'all', expirySeg: 'any', itmOnly: false }
      : { text: '', sideSeg: 'all', stale: false };
  }
  function filterIsActive(state, kind) {
    if (!state) return false;
    if (state.text) return true;
    if (kind === 'positions') return state.typeSeg !== 'all' || state.expirySeg !== 'any' || !!state.itmOnly;
    return state.sideSeg !== 'all' || !!state.stale;
  }
  function matchesRowFilters(r, kind, state, now) {
    if (!r || !state) return true;
    var text = state.text || '';
    if (text && (r.instrument + ' ' + r.underlying).toLowerCase().indexOf(text) === -1) return false;
    if (kind === 'positions') {
      if (state.typeSeg === 'options' && r.type === 'equity') return false;
      if (state.typeSeg === 'equities' && r.type !== 'equity') return false;
      if (state.itmOnly && !r._itm) return false;
      var days = dte(r.expiry, now);
      if (state.expirySeg === 'd7' && !(days !== null && days <= 7)) return false;
      if (state.expirySeg === 'd21' && !(days !== null && days <= 21)) return false;
    } else {
      if (!isOpenOrder(r) && (state.sideSeg !== 'all' || state.stale)) return false;
      if (state.sideSeg === 'buys' && r.action !== 'Buy') return false;
      if (state.sideSeg === 'sells' && r.action !== 'Sell') return false;
      if (state.stale) { var age = ageDays(r.statusDate, now); if (!(age !== null && age > 14)) return false; }
    }
    return true;
  }
  function duplicateOrderKeys(orders) {
    var seen = {}, dups = {};
    (orders || []).forEach(function (o, i) {
      if (!o || o.type === 'equity' || !isOpenOrder(o)) return;
      var k = [o.underlying, o.expiryISO || '', o.strike].join('|');
      if (seen[k] !== undefined) { dups[k] = true; dups[seen[k]] = true; }
      else seen[k] = i;
      if (dups[k]) dups[i] = true;
    });
    var out = {};
    Object.keys(dups).forEach(function (k) { out[k] = true; });
    return out;
  }
  function orderKey(o) { return [o.underlying, o.expiryISO || '', o.strike].join('|'); }

  function csvEscape(v) {
    if (v === null || v === undefined) return '';
    var s = String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function fmtNum(v) { return (v === null || v === undefined || !isFinite(v)) ? '' : String(Math.round(v * 10000) / 10000); }

  function positionsToCsv(rows, generatedAt) {
    var head = 'instrument,underlying,type,expiry,strike,qty,last,avgPrice,costBasis,marketValue,dailyPnl,unrealizedPnl,delta,ivRank';
    var lines = ['# generated-at: ' + generatedAt, head];
    (rows || []).forEach(function (r) {
      lines.push([r.instrument, r.underlying, r.type, r.expiryISO || '', fmtNum(r.strike), fmtNum(r.qty),
        fmtNum(r.last), fmtNum(r.avgPrice), fmtNum(r.costBasis), fmtNum(r.marketValue), fmtNum(r.dailyPnl),
        fmtNum(r.unrealizedPnl), fmtNum(r.delta), fmtNum(r.ivRank)].map(csvEscape).join(','));
    });
    return lines.join('\n');
  }
  function ordersToCsv(rows, generatedAt) {
    var head = 'instrument,underlying,expiry,strike,type,action,qty,filled,remain,status,statusDate,limitPrice,tif,account,orderId';
    var lines = ['# generated-at: ' + generatedAt, head];
    (rows || []).forEach(function (r) {
      lines.push([r.instrument, r.underlying, r.expiryISO || '', fmtNum(r.strike), r.type, r.action,
        fmtNum(r.qty), fmtNum(r.filled), fmtNum(r.remain), r.status,
        r.statusDate ? r.statusDate.toISOString() : '', fmtNum(r.limitPrice), r.tif || '', r.account || '',
        r.orderId || ''].map(csvEscape).join(','));
    });
    return lines.join('\n');
  }

  // ---- Kubera broker-orders export (pure payload builders) ----
  function londonOffsetMinutes(instant) {
    var d = instant ? new Date(instant) : new Date();
    try {
      var parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false }).formatToParts(d);
      var v = {};
      parts.forEach(function (p) { v[p.type] = Number(p.value); });
      var wallAsUTC = Date.UTC(v.year, v.month - 1, v.day, v.hour % 24, v.minute, v.second);
      return Math.round((wallAsUTC - Math.floor(d.getTime() / 1000) * 1000) / 60000);
    } catch (e) { return -d.getTimezoneOffset(); }
  }
  function formatLondonCapturedAt(instant) {
    var d = instant ? new Date(instant) : new Date();
    var off = londonOffsetMinutes(d);
    var shifted = new Date(d.getTime() + off * 60000);
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    var sign = off < 0 ? '-' : '+';
    var abs = Math.abs(off);
    return shifted.getUTCFullYear() + '-' + pad(shifted.getUTCMonth() + 1) + '-' + pad(shifted.getUTCDate()) +
      'T' + pad(shifted.getUTCHours()) + ':' + pad(shifted.getUTCMinutes()) + ':' + pad(shifted.getUTCSeconds()) +
      sign + pad(Math.floor(abs / 60)) + ':' + pad(abs % 60);
  }
  function currencyFromText(text) {
    var m = String(text || '').match(/\b(USD|GBP|EUR|CHF|CAD|AUD)\b/);
    return m ? m[1] : null;
  }
  function brokerOrderFromParsed(row, raw) {
    var pageText = raw !== undefined ? String(raw || '') : String(row.instrument || '');
    var isEquity = row.type === 'equity';
    return {
      order_id: row.orderId ? String(row.orderId) : '',
      symbol: row.underlying || '',
      asset_type: isEquity ? 'equity' : 'option',
      expiry_date: isEquity ? null : (row.expiryISO || null),
      strike_price: isEquity ? null : (row.strike !== undefined ? row.strike : null),
      option_type: isEquity ? null : (row.type === 'put' ? 'Put' : (row.type === 'call' ? 'Call' : null)),
      action: row.action || '',
      qty_total: (row.qty !== null && row.qty !== undefined) ? row.qty : ((row.filled || 0) + (row.remain || 0)),
      qty_filled: row.filled !== undefined ? row.filled : 0,
      qty_remain: row.remain !== undefined ? row.remain : 0,
      limit_price: row.limitPrice !== undefined ? row.limitPrice : null,
      tif: row.tif || null,
      status: row.status || '',
      status_at: row.statusDate ? new Date(row.statusDate).toISOString() : null,
      currency: currencyFromText(pageText) || 'USD',
      raw: pageText,
      legs: Array.isArray(row.legs) ? row.legs : []
    };
  }
  function exportedOrdersComplete(renderedCount, totalHint) {
    if (totalHint === null || totalHint === undefined || !isFinite(totalHint)) return true;
    return !(totalHint > renderedCount);
  }
  function buildBrokerSnapshots(rows, opts) {
    opts = opts || {};
    var groups = {}, order = [];
    (rows || []).forEach(function (r) {
      if (!isOpenOrder(r)) return;
      var accountId = r.account ? String(r.account).trim() : '';
      if (!accountId) return;
      if (!groups[accountId]) { groups[accountId] = []; order.push(accountId); }
      var raw = r._raw !== undefined ? r._raw : (r._cells ? r._cells.join('\n') : r.instrument);
      groups[accountId].push(brokerOrderFromParsed(r, raw));
    });
    order.sort();
    return order.map(function (accountId) {
      var labels = opts.accountLabels || {};
      return {
        ingest_source: opts.ingestSource || 'ibkr-enhancer',
        account_id: accountId,
        account_label: labels[accountId] || null,
        captured_at: opts.capturedAt || null,
        complete: !!opts.complete,
        orders: groups[accountId]
      };
    });
  }
  // ================= PARSER END =================

  var PARSER = { parseNumber: parseNumber, parseInstrument: parseInstrument, normalizeHeader: normalizeHeader,
    parsePositionRow: parsePositionRow, parseOrderRow: parseOrderRow, parseOrderMeta: parseOrderMeta,
    parseStatus: parseStatus, dte: dte, ageDays: ageDays, cushionPct: cushionPct, cushionBand: cushionBand,
    premiumCaptured: premiumCaptured, isITM: isITM, netDeltaExposure: netDeltaExposure,
    remainingNotional: remainingNotional, duplicateOrderKeys: duplicateOrderKeys, orderKey: orderKey,
    isTerminalStatus: isTerminalStatus, isOpenOrder: isOpenOrder, summarizeOrders: summarizeOrders,
    defaultFilterState: defaultFilterState, filterIsActive: filterIsActive, matchesRowFilters: matchesRowFilters,
    buildOrdersSnapshot: buildOrdersSnapshot, gtcTargetLimit: gtcTargetLimit, gtcChipState: gtcChipState, wingPairState: wingPairState, ccCoverageState: ccCoverageState,
    parseInstrumentSearch: parseInstrumentSearch, buildPositionsSnapshot: buildPositionsSnapshot, findShortPosition: findShortPosition, ticketFillPlan: ticketFillPlan,
    positionsToCsv: positionsToCsv, ordersToCsv: ordersToCsv,
    formatLondonCapturedAt: formatLondonCapturedAt, currencyFromText: currencyFromText,
    brokerOrderFromParsed: brokerOrderFromParsed, exportedOrdersComplete: exportedOrdersComplete,
    buildBrokerSnapshots: buildBrokerSnapshots };
  if (typeof module !== 'undefined' && module.exports) module.exports = PARSER;

  // ---------- settings ----------
  var DEFAULTS = { marginBar: true, badges: true, grouping: false, filters: true, orderAges: true,
    copyButtons: true, readability: true, gtcChips: true, wingChips: true, ccChips: true, ticketFill: true, exportOrders: false, kuberaIngestToken: '', density: 'comfortable', dismissedBar: false, barCollapsed: false };
  function getSetting(key) {
    try { if (typeof GM_getValue === 'function') { var v = GM_getValue('ibx.' + key, undefined); if (v !== undefined) return v; } } catch (e) { /* silent */ }
    try { var raw = window.localStorage.getItem('ibx.' + key); return raw === null ? DEFAULTS[key] : JSON.parse(raw); } catch (e) { return DEFAULTS[key]; }
  }
  function setSetting(key, value) {
    try { if (typeof GM_setValue === 'function') { GM_setValue('ibx.' + key, value); return; } } catch (e) { /* silent */ }
    try { window.localStorage.setItem('ibx.' + key, JSON.stringify(value)); } catch (e) { /* silent */ }
  }
  function allOff() {
    return !getSetting('marginBar') && !getSetting('badges') && !getSetting('grouping') &&
      !getSetting('filters') && !getSetting('orderAges') && !getSetting('copyButtons') && !getSetting('readability') && !getSetting('gtcChips') && !getSetting('wingChips') && !getSetting('ccChips') && !getSetting('ticketFill') && !getSetting('exportOrders');
  }

  var CSS = [
    '[data-ibkr-enhancer]{box-sizing:border-box}',
    '.ibx-bar{position:fixed;bottom:12px;right:12px;z-index:9999;display:flex;gap:10px;align-items:center;flex-wrap:wrap;max-width:92vw;padding:6px 10px;border-radius:8px;background:rgba(20,22,28,.94);color:#e8e8e8;border:1px solid rgba(255,255,255,.18);font:12px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;box-shadow:0 4px 18px rgba(0,0,0,.4)}',
    '.ibx-bar .ibx-lab{opacity:.65}.ibx-bar .ibx-val{font-weight:600}',
    '.ibx-cushion-green{color:#4caf50}.ibx-cushion-amber{color:#ffb300}.ibx-cushion-red{color:#ef5350}',
    '.ibx-pill-cushion{border-radius:999px;padding:2px 10px;font-weight:800;color:#111}',
    '.ibx-pill-cushion.ibx-cushion-green{background:#43a047;color:#fff}.ibx-pill-cushion.ibx-cushion-amber{background:#ffb300;color:#222}.ibx-pill-cushion.ibx-cushion-red{background:#c62828;color:#fff}.ibx-pill-cushion.ibx-cushion-none{background:#444;color:#bbb}',
    '.ibx-details{position:fixed;bottom:64px;right:12px;z-index:10001;min-width:300px;background:rgba(20,22,28,.97);color:#e8e8e8;border:1px solid rgba(255,255,255,.2);border-radius:10px;padding:12px 14px;font:12px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.5)}',
    '.ibx-details table{border-collapse:collapse;width:100%}.ibx-details td{padding:2px 6px}.ibx-details td:last-child{text-align:right;font-weight:600}',
    '.ibx-details-cushion{font-size:22px;font-weight:800}',
    '.ibx-dock{position:fixed;bottom:12px;right:12px;z-index:9999;display:flex;gap:6px;align-items:center;padding:4px 8px;border-radius:999px;background:rgba(20,22,28,.94);border:1px solid rgba(255,255,255,.18);cursor:pointer;font:12px -apple-system,Segoe UI,Roboto,sans-serif}',
    '.ibx-dock-dot{width:9px;height:9px;border-radius:50%;background:#888;display:inline-block}',
    '.ibx-badge{display:inline-block;margin-left:6px;padding:0 5px;border-radius:8px;font-size:10px;font-weight:700;vertical-align:middle}',
    '.ibx-badge-red{background:#5a1f1f;color:#ff8a80}.ibx-badge-amber{background:#554410;color:#ffd54f}.ibx-badge-green{background:#1e4620;color:#81c784}.ibx-badge-muted{background:#333;color:#bbb;font-weight:400}',
    '.ibx-badge-escalated{background:#8e0000;color:#fff;box-shadow:0 0 0 1px #ff5252 inset}',
    '.ibx-badge-stale{opacity:.45;filter:grayscale(1)}',
    '.ibx-filterbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:6px 4px;font:12px -apple-system,Segoe UI,Roboto,sans-serif}',
    '.ibx-filterbar input[type=text]{min-width:180px;height:26px;padding:3px 12px;border-radius:999px;background:rgba(20,22,28,.92);color:#e8e8e8;border:1px solid rgba(128,128,128,.55)}',
    '.ibx-filterbar input[type=text]::placeholder{color:rgba(200,200,200,.55)}',
    '.ibx-filterbar input[type=text]:focus{border-color:#0b5cad;outline:none}',
    '.ibx-copy{display:inline-flex;gap:6px;align-items:center;margin:4px;border:1px solid rgba(128,128,128,.55);background:transparent;color:inherit;border-radius:999px;padding:3px 10px;cursor:pointer;transition:transform .12s ease}',
    '.ibx-copy:hover{transform:translateY(-1px)}',
    '.ibx-toolbar-actions{margin-left:auto;display:inline-flex;gap:8px;align-items:center}',
    '.ibx-icon-btn{display:inline-flex!important;align-items:center;justify-content:center;width:32px;min-width:32px;height:26px;margin:0!important;padding:3px 8px!important;line-height:1}',
    '.ibx-icon-btn svg{display:block;flex:none}',
    '@keyframes ibx-pulse{0%,100%{opacity:1}50%{opacity:.4}}',
    '.ibx-icon-btn.ibx-exporting{animation:ibx-pulse 1s ease-in-out infinite;cursor:wait}',
    '.ibx-toast{position:fixed;right:16px;bottom:16px;z-index:10003;max-width:min(440px,calc(100vw - 32px));padding:10px 38px 10px 12px;border:1px solid rgba(255,255,255,.22);border-left:4px solid #888;border-radius:8px;background:rgba(20,22,28,.97);color:#e8e8e8;font:12px/1.45 -apple-system,Segoe UI,Roboto,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.5);cursor:pointer;opacity:0;transform:translateY(8px);transition:opacity .18s ease,transform .18s ease}',
    '.ibx-toast.ibx-toast-show{opacity:1;transform:translateY(0)}',
    '.ibx-toast.ibx-toast-success{border-left-color:#43a047}',
    '.ibx-toast.ibx-toast-failure{border-left-color:#ef5350}',
    '.ibx-toast-close{position:absolute!important;top:4px;right:6px;width:22px;height:22px;padding:0!important;border:0!important;border-radius:50%!important;background:transparent!important;color:inherit!important;opacity:.7;cursor:pointer;font-size:16px;line-height:1}',
    '.ibx-filterbar button,.ibx-bar button{cursor:pointer;border-radius:6px;padding:3px 8px}',
    '.ibx-flabel{opacity:.6;font-weight:600}',
    '.ibx-seg{display:inline-flex;border:1px solid rgba(128,128,128,.55);border-radius:999px;overflow:hidden}',
    '.ibx-seg button{border:0;border-radius:0;background:transparent;color:inherit;opacity:.75}',
    '.ibx-seg button.ibx-on{background:#0b5cad;color:#fff;opacity:1;font-weight:700}',
    '.ibx-pill{border:1px solid rgba(128,128,128,.55);background:transparent;color:inherit;opacity:.8;border-radius:999px!important}',
    '.ibx-pill.ibx-on{background:#0b5cad;color:#fff;border-color:#0b5cad;opacity:1;font-weight:700}',
    '.ibx-clear{border:1px solid rgba(128,128,128,.55);background:transparent;color:inherit}',
    '.ibx-subtotal{font-weight:700;background:rgba(255,255,255,.06)}',
    '.ibx-dupe{outline:2px solid #ffb300;outline-offset:-2px}',
    '.ibx-sticky thead th{position:sticky;top:0;z-index:2}',
    '.ibx-zebra tbody tr:nth-child(even){background:rgba(255,255,255,.03)}',
    '.ibx-compact td,.ibx-compact th{padding-top:2px!important;padding-bottom:2px!important}',
    '.ibx-pos{color:#4caf50}.ibx-neg{color:#ef5350}',
    '.ibx-panel{position:fixed;bottom:64px;right:12px;z-index:10000;background:rgba(20,22,28,.97);color:#e8e8e8;border:1px solid rgba(255,255,255,.2);border-radius:8px;padding:10px 12px;font:12px/1.6 -apple-system,Segoe UI,Roboto,sans-serif}',
    '.ibx-summary{padding:4px;font:12px -apple-system,Segoe UI,Roboto,sans-serif;opacity:.9}'
  ].join('\n');

  var styleInjected = false;
  function injectStyle() {
    if (styleInjected) return; styleInjected = true;
    try { if (typeof GM_addStyle === 'function') { GM_addStyle(CSS); return; } } catch (e) { /* fall through */ }
    var s = document.createElement('style'); s.setAttribute('data-ibkr-enhancer', 'style'); s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  function cellLines(cell) {
    if (!cell) return [''];
    var txt = '';
    try { txt = cell.innerText || ''; } catch (e) { txt = ''; }
    if (!txt || !txt.trim()) {
      var out = '';
      (function walk(n) {
        if (n.nodeType === 3) { out += n.textContent; return; }
        if (n.nodeType !== 1) return;
        if (n.tagName === 'BR') { out += '\n'; return; }
        var block = /^(DIV|P|LI|TR|SECTION)$/.test(n.tagName);
        if (block) out += '\n'; else out += ' ';
        Array.prototype.forEach.call(n.childNodes, walk);
        if (block) out += '\n';
      })(cell);
      txt = out;
    }
    return String(txt).split('\n');
  }
  function cellText(cell) { return cellLines(cell).join('\n').trim(); }

  function findTables() {
    var main = document.querySelector('#cp-ib-app-main-content') || document;
    var tables = Array.prototype.slice.call(main.querySelectorAll('table'));
    var positions = null, orders = null;
    tables.forEach(function (tbl) {
      var heads = Array.prototype.map.call(tbl.querySelectorAll('th'), function (th) { return (th.textContent || '').trim(); });
      var keys = {};
      heads.forEach(function (h) { var k = normalizeHeader(h); if (k) keys[k] = true; });
      if (keys.instrument && keys.position) positions = positions || { table: tbl, headers: heads };
      if (keys.orders && keys.filledRemain) orders = orders || { table: tbl, headers: heads };
    });
    return { positions: positions, orders: orders };
  }

  function dataRows(found) {
    if (!found) return [];
    return Array.prototype.slice.call(found.table.querySelectorAll('tbody tr')).filter(function (tr) {
      return tr.querySelectorAll('td').length > 0 && !tr.hasAttribute('data-ibkr-enhancer');
    });
  }

  function readPositions(found) {
    return dataRows(found).map(function (tr) {
      var cells = Array.prototype.map.call(tr.querySelectorAll('td'), cellText);
      var idx = headerIndex(found.headers);
      var aria = (tr.getAttribute('aria-label') || '').trim();
      if (aria && idx.instrument !== undefined) cells[idx.instrument] = aria;
      var model = parsePositionRow(found.headers, cells);
      model._tr = tr; model._cells = cells;
      return model;
    });
  }
  function readOrders(found) {
    return dataRows(found).map(function (tr) {
      var cells = Array.prototype.map.call(tr.querySelectorAll('td'), cellText);
      var model = parseOrderRow(found.headers, cells, tr.getAttribute('data-id'));
      model._tr = tr; model._cells = cells;
      model._raw = cells.join('\n');
      return model;
    });
  }

  // Live textContent glues leaf texts ("NikhilaU26948221USD..."); spacedText
  // joins text nodes with a separator so token boundaries survive.
  function spacedText(node) {
    if (!node) return '';
    try {
      var walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      var parts = [], n;
      while ((n = walker.nextNode())) { var t = n.textContent.trim(); if (t) parts.push(t); }
      if (parts.length) return parts.join(' ');
    } catch (e) { /* fall through */ }
    return String(node.textContent || '').replace(/\s+/g, ' ').trim();
  }
  var lastAnchorDebug = 'IBX-ANCHOR reason=NOT_RUN';
  function anchorDebugLine(d) {
    return 'IBX-ANCHOR labels[EL=' + d.el + ',BP=' + d.bp + ',MM=' + d.mm + ',UP=' + d.up + '] depth=' + d.depth +
      ' ids=' + d.ids + ' headerLen=' + d.headerLen + ' currency=' + d.currency + ' signed=' + d.signed +
      ' money=' + d.money + ' moneyShape=' + (d.moneyShape || '-') + ' clash=' + d.clash + ' reason=' + d.reason;
  }
  // Account header anchor: alias + account-id token + currency -> headline value -> signed change.
  function findAccountContext() {
    var dbg = { el: 0, bp: 0, mm: 0, up: 0, depth: -1, ids: 0, headerLen: 0, currency: false, signed: false, money: false, moneyShape: null, clash: false, reason: 'NO_MAIN' };
    var main = document.querySelector('#cp-ib-app-main-content');
    if (!main) { lastAnchorDebug = anchorDebugLine(dbg); return null; }
    dbg.reason = 'NO_LABELS';
    var labels = ['Excess Liquidity', 'Buying Power', 'Maintenance Margin', 'Unrealized P&L'];
    var labelEls = {}, firstLabelEl = null;
    var labelCounts = { 'Excess Liquidity': 'el', 'Buying Power': 'bp', 'Maintenance Margin': 'mm', 'Unrealized P&L': 'up' };
    Array.prototype.forEach.call(main.querySelectorAll('div,span,td,li'), function (el) {
      var t = (el.textContent || '').trim();
      labels.forEach(function (lab) {
        if (t === lab) { dbg[labelCounts[lab]]++; if (!labelEls[lab]) { labelEls[lab] = el; if (!firstLabelEl) firstLabelEl = el; } }
      });
    });
    function labelledValue(lab) {
      var el = labelEls[lab]; if (!el) return null;
      var container = el.parentElement;
      var scope = container ? spacedText(container) : spacedText(el);
      var rest = String(scope || '').replace(lab, '');
      var nums = rest.match(/[+-]?[\d,]+(?:\.\d+)?/g);
      return nums && nums.length ? parseNumber(nums[0]) : null;
    }
    var fields = {};
    labels.forEach(function (lab) { fields[lab] = labelledValue(lab); });
    ['Realized P&L', 'Settled Cash'].forEach(function (lab) {
      var found = null;
      Array.prototype.forEach.call(main.querySelectorAll('div,span,td,li'), function (el2) {
        if (!found && (el2.textContent || '').trim() === lab) found = el2;
      });
      if (found) { labelEls[lab] = found; fields[lab] = labelledValue(lab); }
    });
    // Headline anchor: the sidebar account item = largest ancestor of the
    // summary labels (up to 25 levels) still containing exactly one
    // account-ID token; 2+ IDs means the multi-account column, reject it.
    var cutLabels = labels.concat(['Settled Cash', 'Realized P&L']);
    var alias = null, headline = null, maskedId = null;
    var item = null, node = firstLabelEl;
    dbg.reason = firstLabelEl ? 'NO_ITEM_1ID' : 'NO_LABELS';
    for (var depth = 0; node && depth < 25; depth++) {
      var ids = spacedText(node).match(/\b[A-Z]\d{5,}\b/g) || [];
      if (ids.length === 1) { item = node; dbg.depth = depth; dbg.ids = 1; }
      if (ids.length >= 2) { if (!item) dbg.ids = ids.length; break; }
      node = node.parentElement;
    }
    if (item) {
      dbg.reason = 'NO_ID_IN_HEADER';
      var fullText = spacedText(item);
      var cut = fullText.length;
      cutLabels.forEach(function (lab) { var i = fullText.indexOf(lab); if (i >= 0 && i < cut) cut = i; });
      var header = fullText.slice(0, cut);
      // Inline elements glue alias/ID/currency/value without whitespace, and
      // the page header strip precedes the account segment: take the LAST
      // ID-shaped token in the header as the account ID.
      var idMatches = header.match(/[A-Z]\d{5,}/g) || [];
      var idTok = idMatches.length ? idMatches[idMatches.length - 1] : null;
      var idIdx = idTok ? header.lastIndexOf(idTok) : -1;
      dbg.headerLen = header.length;
      if (idTok && idIdx >= 0) {
        maskedId = idTok.charAt(0) + '\u2022\u2022\u2022' + idTok.slice(-2);
        var afterId = header.slice(idIdx + idTok.length);
        var curM = afterId.match(/(USD|GBP|EUR)/);
        dbg.currency = !!curM;
        dbg.signed = /[+-][\d,]+(?:\.\d+)?/.test(afterId);
        dbg.reason = !curM ? 'NO_CURRENCY' : 'NO_MONEY';
        // Money is evaluated independently of the signed gate; signed is
        // confidence only. Candidates clashing with a labelled field are
        // skipped, in the header segment first, then the full item text.
        function scanMoney(text) {
          var curRe = /(USD|GBP|EUR)/g, cm;
          while ((cm = curRe.exec(text)) !== null) {
            var rest = text.slice(cm.index + cm[1].length);
            var mm = rest.match(/[+-]?[\d,]+(?:\.\d{2})/);
            if (!mm) continue;
            var cand = parseNumber(mm[0]);
            var clash = Object.keys(fields).some(function (k) { return fields[k] !== null && cand === fields[k]; });
            dbg.money = true; dbg.moneyShape = mm[0].replace(/\d/g, '#'); dbg.clash = clash;
            if (!clash) return cand;
          }
          return null;
        }
        if (curM) headline = scanMoney(afterId);
        if (headline === null) {
          var fullAfter = fullText.slice(fullText.lastIndexOf(idTok) + idTok.length);
          headline = scanMoney(fullAfter);
          if (headline !== null) dbg.currency = true;
        }
        dbg.reason = headline !== null ? 'OK' : (dbg.money ? 'CLASH' : (curM ? 'NO_MONEY' : 'NO_CURRENCY'));
        var beforeId = header.slice(0, idIdx);
        var aliasM = beforeId.match(/([A-Za-z][A-Za-z'-]{1,})\s*$/);
        alias = aliasM ? aliasM[1] : maskedId;
      }
    }
    lastAnchorDebug = anchorDebugLine(dbg);
    return { fields: fields, headline: headline, alias: alias, maskedId: maskedId, debug: dbg };
  }

  function fmtMoney(v) {
    if (v === null || v === undefined || !isFinite(v)) return EM_DASH;
    return v.toLocaleString('en-GB', { maximumFractionDigits: 2 });
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    n.setAttribute('data-ibkr-enhancer', '1');
    return n;
  }

  function removeInjected(selector) {
    Array.prototype.forEach.call(document.querySelectorAll(selector), function (n) { n.remove(); });
  }

  var lastAccountAlias = null;
  function renderMarginBar(ctx) {
    if (ctx && ctx.alias) lastAccountAlias = ctx.alias;
    removeInjected('[data-ibkr-enhancer="bar"]');
    removeInjected('[data-ibkr-enhancer="dock"]');
    if (!getSetting('marginBar')) { removeInjected('[data-ibkr-enhancer="details"]'); return; }
    if (!ctx) return;
    var hasAny = ctx.headline !== null || Object.keys(ctx.fields).some(function (k) { return ctx.fields[k] !== null; });
    if (!hasAny) return;
    var cushion0 = cushionPct(ctx.fields['Excess Liquidity'], ctx.headline);
    var band0 = cushionBand(cushion0);
    if (getSetting('barCollapsed')) {
      var dock = el('button', 'ibx-dock'); dock.setAttribute('data-ibkr-enhancer', 'dock');
      dock.title = 'Expand margin bar';
      if (cushion0 !== null && band0) {
        dock.appendChild(el('span', 'ibx-pill-cushion ibx-cushion-' + band0, cushion0.toFixed(1) + '%'));
      } else {
        var dot = el('span', 'ibx-dock-dot'); dock.appendChild(dot);
        dock.appendChild(el('span', '', 'Margin'));
      }
      dock.addEventListener('click', function () { setSetting('barCollapsed', false); scheduleRun(); });
      document.body.appendChild(dock);
      return;
    }
    var bar = el('div', 'ibx-bar'); bar.setAttribute('data-ibkr-enhancer', 'bar');
    function pair(label, value) {
      var s = el('span'); var l = el('span', 'ibx-lab', label + ': '); var v = el('span', 'ibx-val', value);
      s.appendChild(l); s.appendChild(v); return s;
    }
    bar.appendChild(pair('Account', ctx.alias || ctx.maskedId || EM_DASH));
    bar.appendChild(pair('NLV', fmtMoney(ctx.headline)));
    var cushion = cushionPct(ctx.fields['Excess Liquidity'], ctx.headline);
    var band = cushionBand(cushion);
    var pill = el('span', 'ibx-pill-cushion ibx-cushion-' + (band || 'none'), cushion !== null && band ? cushion.toFixed(1) + '%' : EM_DASH);
    pill.title = 'Cushion = Excess Liquidity / NLV';
    bar.appendChild(pill);
    var details = el('button', '', 'Details');
    details.addEventListener('click', function (ev) { ev.stopPropagation(); toggleDetails(ctx, cushion, band); });
    var gear = el('button', '', '\u2699'); gear.title = 'IBKR Enhancer settings';
    gear.addEventListener('click', togglePanel);
    var close = el('button', '', '\u00D7'); close.title = 'Collapse to dock chip';
    close.addEventListener('click', function () { setSetting('barCollapsed', true); removeInjected('[data-ibkr-enhancer="details"]'); scheduleRun(); });
    bar.appendChild(details); bar.appendChild(gear); bar.appendChild(close);
    document.body.appendChild(bar);
  }

  var detailsOutsideHandler = null;
  function toggleDetails(ctx, cushion, band) {
    var existing = document.querySelector('[data-ibkr-enhancer="details"]');
    if (existing) { existing.remove(); if (detailsOutsideHandler) { document.removeEventListener('click', detailsOutsideHandler); detailsOutsideHandler = null; } return; }
    var panel = el('div', 'ibx-details'); panel.setAttribute('data-ibkr-enhancer', 'details');
    var head = el('div', '', (ctx.alias || ctx.maskedId || 'Account') + (ctx.maskedId && ctx.alias ? '  ' + ctx.maskedId : ''));
    head.style.fontWeight = '700'; panel.appendChild(head);
    var big = el('div', 'ibx-details-cushion ibx-cushion-' + (band || 'none'), cushion !== null && band ? cushion.toFixed(1) + '%' : EM_DASH);
    big.title = 'Cushion = Excess Liquidity / NLV';
    panel.appendChild(big);
    var table = document.createElement('table'); table.setAttribute('data-ibkr-enhancer', '1');
    [['NLV', ctx.headline], ['Excess Liquidity', ctx.fields['Excess Liquidity']], ['Buying Power', ctx.fields['Buying Power']],
     ['Maintenance Margin', ctx.fields['Maintenance Margin']], ['Unrealized P&L', ctx.fields['Unrealized P&L']],
     ['Realized P&L', ctx.fields['Realized P&L']], ['Settled Cash', ctx.fields['Settled Cash']]].forEach(function (rowDef) {
      if (rowDef[0] !== 'NLV' && (rowDef[1] === null || rowDef[1] === undefined)) return;
      var tr = document.createElement('tr'); tr.setAttribute('data-ibkr-enhancer', '1');
      var a = el('td', '', rowDef[0]); var b = el('td', '', fmtMoney(rowDef[1]));
      tr.appendChild(a); tr.appendChild(b); table.appendChild(tr);
    });
    panel.appendChild(table);
    var closeBtn = el('button', '', 'Close');
    closeBtn.addEventListener('click', function () { toggleDetails(ctx, cushion, band); });
    panel.appendChild(closeBtn);
    document.body.appendChild(panel);
    detailsOutsideHandler = function (ev) {
      if (!panel.contains(ev.target)) toggleDetails(ctx, cushion, band);
    };
    document.addEventListener('click', detailsOutsideHandler);
  }

  function togglePanel() {
    var existing = document.querySelector('[data-ibkr-enhancer="panel"]');
    if (existing) { existing.remove(); return; }
    var panel = el('div', 'ibx-panel'); panel.setAttribute('data-ibkr-enhancer', 'panel');
    var title = el('div', '', 'IBKR Enhancer settings'); title.style.fontWeight = '700'; panel.appendChild(title);
    [['marginBar', 'Margin bar'], ['badges', 'Positions badges'], ['grouping', 'Group by underlying'],
     ['filters', 'Filter bars'], ['orderAges', 'Order age / notional'], ['copyButtons', 'Copy CSV buttons'],
     ['readability', 'Readability (zebra/header/density)'], ['gtcChips', 'GTC closing-order chips'], ['wingChips', 'Wing pairing chips'], ['ccChips', 'Covered-call chips'], ['ticketFill', 'Order ticket GTC fill'], ['exportOrders', 'Export orders to Kubera']].forEach(function (pairDef) {
      var row = el('label'); row.style.display = 'block';
      var cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!getSetting(pairDef[0]);
      cb.setAttribute('data-ibkr-enhancer', '1');
      cb.addEventListener('change', function () { setSetting(pairDef[0], cb.checked); if (pairDef[0] === 'marginBar' && cb.checked) setSetting('barCollapsed', false); scheduleRun(); });
      row.appendChild(cb); row.appendChild(document.createTextNode(' ' + pairDef[1])); panel.appendChild(row);
    });
    var drow = el('label', '', 'Density: '); drow.style.display = 'block';
    var sel = document.createElement('select'); sel.setAttribute('data-ibkr-enhancer', '1');
    ['comfortable', 'compact'].forEach(function (d) { var o = document.createElement('option'); o.value = d; o.textContent = d; if (getSetting('density') === d) o.selected = true; sel.appendChild(o); });
    sel.addEventListener('change', function () { setSetting('density', sel.value); scheduleRun(); });
    drow.appendChild(sel); panel.appendChild(drow);
    var trow = el('label', '', 'Kubera ingest token: '); trow.style.display = 'block';
    var tokenInput = document.createElement('input'); tokenInput.type = 'password'; tokenInput.autocomplete = 'off';
    tokenInput.setAttribute('data-ibkr-enhancer', '1');
    tokenInput.value = getSetting('kuberaIngestToken') || '';
    tokenInput.placeholder = 'Stored locally only';
    tokenInput.addEventListener('change', function () { setSetting('kuberaIngestToken', tokenInput.value.trim()); });
    trow.appendChild(tokenInput); panel.appendChild(trow);
    var dbgBtn = el('button', '', 'Copy anchor debug');
    dbgBtn.addEventListener('click', function () {
      try { findAccountContext(); } catch (e) { /* silent */ }
      var line = lastAnchorDebug;
      try { navigator.clipboard.writeText(line); } catch (e) { /* clipboard unavailable */ }
      log(line);
    });
    panel.appendChild(dbgBtn);
    var hint = el('div', '', 'All off = native page. Read-only: never clicks native actions.');
    hint.style.opacity = '.6'; panel.appendChild(hint);
    document.body.appendChild(panel);
  }

  function instrumentCell(tr, headers) {
    var idx = headerIndex(headers);
    var tds = tr.querySelectorAll('td');
    return idx.instrument !== undefined ? tds[idx.instrument] : tds[1];
  }

  function addBadge(cell, text, cls, title) {
    if (!cell) return;
    var b = el('span', 'ibx-badge ' + cls, text);
    if (title) b.title = title;
    b.setAttribute('data-ibkr-enhancer', 'badge');
    cell.appendChild(b);
  }

  function enhancePositions(found) {
    var rows = readPositions(found);
    liveRows.positions = rows;
    try { setSetting('positionsSnapshot', buildPositionsSnapshot(rows, new Date().toISOString(), lastAccountAlias)); } catch (e) { /* silent */ }
    var visible = dataRows(found).length;
    log('positions parsed ' + rows.length + ' / visible ' + visible);
    var equityLast = {};
    rows.forEach(function (r) { if (r.type === 'equity' && r.last !== null) equityLast[r.underlying] = r.last; });
    rows.forEach(function (r) { r._itm = r.type === 'equity' ? null : isITM(r, equityLast[r.underlying]); });
    if (getSetting('badges')) {
      rows.forEach(function (r) {
        if (r.type === 'equity') return;
        var cell = instrumentCell(r._tr, found.headers);
        var days = dte(r.expiry);
        if (days !== null) addBadge(cell, days + 'd', days <= 7 ? 'ibx-badge-red' : (days <= 21 ? 'ibx-badge-amber' : 'ibx-badge-muted'), 'Days to expiry (Europe/London)');
        var ul = equityLast[r.underlying];
        if (ul === undefined) {
          if (cell) cell.title = ((cell.title || '') + ' underlying price unavailable').trim();
        } else if (r._itm && r.qty !== null && r.qty < 0) {
          addBadge(cell, 'ITM', 'ibx-badge-red', 'Short option in the money vs underlying Last');
        }
        if (r.qty !== null && r.qty < 0) {
          var cap = premiumCaptured(r.last, r.avgPrice);
          if (cap !== null && cap >= 0.6) addBadge(cell, Math.round(cap * 100) + '% captured', 'ibx-badge-green', 'Premium captured = 1 - Last/Avg Price');
        }
      });
    }
    if (getSetting('gtcChips')) {
      var snapshot = null;
      try { snapshot = getSetting('ordersSnapshot') || null; } catch (e) { snapshot = null; }
      rows.forEach(function (r) {
        if (r.type === 'equity' || r.qty === null || r.qty >= 0) return;
        var cell = instrumentCell(r._tr, found.headers);
        var chip = gtcChipState(r, snapshot);
        var snapTxt = chip.snapshotAt ? new Date(chip.snapshotAt).toISOString() : 'none saved (visit Orders)';
        var cls = chip.state === 'green' ? 'ibx-badge-green' : (chip.state === 'amber' ? 'ibx-badge-amber' : 'ibx-badge-red');
        if (chip.escalated) cls += ' ibx-badge-escalated';
        if (chip.stale) cls += ' ibx-badge-stale';
        if (chip.state === 'red') {
          addBadge(cell, 'NO GTC', cls, 'No matching GTC closing order | Snapshot: ' + snapTxt + (chip.stale ? ' (stale >24h)' : ''));
        } else {
          var pctTxt = chip.pct !== null && chip.pct !== undefined ? Math.round(chip.pct * 100) + '%' : 'n/a';
          var label = chip.state === 'green' ? 'GTC \u2713 ' + pctTxt : 'GTC ' + pctTxt;
          addBadge(cell, label, cls, 'Close limit: ' + (chip.order.limitPrice !== null && chip.order.limitPrice !== undefined ? chip.order.limitPrice : 'n/a') +
            ' | Remain: ' + (chip.order.remain !== null && chip.order.remain !== undefined ? chip.order.remain : 'n/a') +
            ' | 60% target \u2264 ' + (chip.target !== null && chip.target !== undefined ? chip.target : 'n/a') +
            ' | Snapshot: ' + snapTxt + (chip.stale ? ' (stale >24h)' : ''));
        }
      });
    }
    if (getSetting('ccChips')) {
      var ccSnap = null;
      try { ccSnap = getSetting('ordersSnapshot') || null; } catch (e) { ccSnap = null; }
      rows.forEach(function (r) {
        if (r.type !== 'equity') return;
        var cc = ccCoverageState(r, rows, ccSnap);
        if (cc.capacity < 1) return;
        var cell = instrumentCell(r._tr, found.headers);
        var coverTxt = cc.covering.length ? cc.covering.map(function (c) { return c.strike + ' ' + (c.expiryISO || '') + ' \u00D7' + c.qty + ' (' + c.source + ')'; }).join('; ') : '';
        var orderTxt = cc.orderCovering.length ? cc.orderCovering.map(function (c) { return c.strike + ' ' + (c.expiryISO || '') + ' @ ' + (c.limitPrice !== null && c.limitPrice !== undefined ? c.limitPrice : 'n/a') + ' \u00D7' + c.qty; }).join('; ') : '';
        if (cc.state === 'full') addBadge(cell, 'CC \u2713 ' + cc.posCovered + '/' + cc.capacity, 'ibx-badge-green', 'Covering calls: ' + coverTxt);
        else if (cc.state === 'mixed') addBadge(cell, 'CC \u2713 ' + cc.posCovered + '/' + cc.capacity + ' \u00B7 order ' + cc.orderRemain, 'ibx-badge-amber', 'Covering calls: ' + coverTxt + ' | Working Sell orders: ' + orderTxt);
        else if (cc.state === 'partial') addBadge(cell, 'CC ' + cc.posCovered + '/' + cc.capacity, 'ibx-badge-amber', 'Covering calls: ' + coverTxt);
        else if (cc.state === 'order') addBadge(cell, 'CC order ' + cc.orderRemain + '/' + cc.capacity + ' working', 'ibx-badge-amber', 'Working Sell call orders: ' + orderTxt);
        else addBadge(cell, 'No CC \u00B7 up to ' + cc.capacity, 'ibx-badge-muted', 'Available contracts: ' + cc.capacity + ' (no short calls or working Sell call orders)');
      });
    }
    if (getSetting('wingChips')) {
      var wingSnap = null;
      try { wingSnap = getSetting('ordersSnapshot') || null; } catch (e) { wingSnap = null; }
      var wing = wingPairState(rows, wingSnap);
      Object.keys(wing.byIndex).forEach(function (k) {
        var r = rows[Number(k)], info = wing.byIndex[k];
        var cell = instrumentCell(r._tr, found.headers);
        if (info.state === 'paired') {
          var desc = info.pairs.map(function (p) { var s = rows[p.shortIndex]; return 'Wing \u2192 ' + s.underlying + ' ' + (s.expiryISO || '') + ' ' + s.strike + ' ' + s.type + ' \u00D7' + p.qty; }).join('; ');
          addBadge(cell, 'PAIRED', 'ibx-badge-muted', desc);
        } else if (info.state === 'partial') {
          addBadge(cell, 'PARTIAL', 'ibx-badge-amber', 'Wing covers ' + info.coveredQty + ' of ' + info.neededQty);
        } else if (info.state === 'orphan-exit') {
          addBadge(cell, 'Orphan, exit working', 'ibx-badge-amber', 'No matching short; a working Sell exit order exists in the orders snapshot.');
        } else {
          addBadge(cell, 'ORPHAN', 'ibx-badge-red', 'No matching short, hedge is gone, review for close.');
        }
      });
      wing.wingedShorts.forEach(function (idx) {
        addBadge(instrumentCell(rows[idx]._tr, found.headers), 'WINGED', 'ibx-badge-muted', 'This short has at least one paired long wing.');
      });
    }
    if (getSetting('grouping')) applyGrouping(found, rows);
    var positionsBar = null;
    if (getSetting('filters')) positionsBar = renderFilterBar(found, rows, 'positions');
    else if (getSetting('copyButtons')) {
      clearFilterState(found);
      positionsBar = renderFilterBar(found, rows, 'positions', false);
    } else clearFilterState(found);
    if (getSetting('copyButtons')) renderCopyButton(found, function () { return positionsToCsv(rows, new Date().toISOString()); }, 'Copy positions as CSV', positionsBar);
    if (getSetting('readability')) applyReadability(found.table);
    return rows;
  }

  function applyGrouping(found, rows) {
    var tbody = found.table.querySelector('tbody');
    if (!tbody) return;
    if (!found.table._ibxOriginalOrder) {
      found.table._ibxOriginalOrder = Array.prototype.slice.call(tbody.querySelectorAll('tr'));
    }
    var groups = {}, order = [];
    rows.forEach(function (r) { if (!groups[r.underlying]) { groups[r.underlying] = []; order.push(r.underlying); } groups[r.underlying].push(r); });
    order.sort();
    order.forEach(function (u) {
      var list = groups[u].slice().sort(function (a, b) { return (a.type === 'equity' ? 0 : 1) - (b.type === 'equity' ? 0 : 1); });
      list.forEach(function (r) { tbody.appendChild(r._tr); });
      var mv = 0, up = 0, dp = 0, nd = 0, hasNd = false;
      list.forEach(function (r) { mv += r.marketValue || 0; up += r.unrealizedPnl || 0; dp += r.dailyPnl || 0; var d = netDeltaExposure(r); if (d !== null) { nd += d; hasNd = true; } });
      var tr = el('tr', 'ibx-subtotal'); tr.setAttribute('data-ibkr-enhancer', 'subtotal');
      var td = el('td', '', u + ' subtotal: MV ' + fmtMoney(mv) + ' | U P&L ' + fmtMoney(up) + ' | Daily ' + fmtMoney(dp) + ' | Net \u0394 ' + (hasNd ? fmtMoney(nd) : EM_DASH));
      td.colSpan = 20; tr.appendChild(td); tbody.appendChild(tr);
    });
  }
  function restoreGrouping(found) {
    var tbody = found && found.table.querySelector('tbody');
    if (tbody && found.table._ibxOriginalOrder) found.table._ibxOriginalOrder.forEach(function (tr) { tbody.appendChild(tr); });
  }

  function rowMatchesFilters(r, kind, state) { return matchesRowFilters(r, kind, state); }

  var filterStates = { positions: null, orders: null };
  var liveRows = { positions: [], orders: [] };
  function getFilterState(kind) {
    if (!filterStates[kind]) filterStates[kind] = defaultFilterState(kind);
    return filterStates[kind];
  }
  function applyFilterToRows(kind) {
    var state = getFilterState(kind);
    if (!filterIsActive(state, kind)) return;
    (liveRows[kind] || []).forEach(function (r) { r._tr.style.display = matchesRowFilters(r, kind, state) ? '' : 'none'; });
  }
  var activeFilterInput = null;
  var slashBound = false;
  function ensureSlashListener() {
    if (slashBound) return;
    slashBound = true;
    document.addEventListener('keydown', function (ev) {
      if (ev.key !== '/' || !activeFilterInput || !document.contains(activeFilterInput)) return;
      if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
      ev.preventDefault(); activeFilterInput.focus();
    });
  }
  function clearFilterState(found) {
    if (!found || !found.table) return;
    var bar = found.table.parentElement && found.table.parentElement.querySelector('[data-ibkr-enhancer="filterbar"]');
    if (bar) bar.remove();
    Array.prototype.forEach.call(found.table.querySelectorAll('tbody tr'), function (tr) { tr.style.display = ''; });
  }

  var CLIPBOARD_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
  var UPLOAD_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 15V4"/><path d="m7 9 5-5 5 5"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg>';
  var CHECK_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
  var X_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
  function toolbarActions(bar) {
    if (!bar) return null;
    var actions = bar.querySelector('.ibx-toolbar-actions');
    if (!actions) {
      actions = el('span', 'ibx-toolbar-actions');
      bar.appendChild(actions);
    }
    return actions;
  }
  function showTransientIcon(button, icon, delay) {
    if (!button) return;
    if (button._ibxIconTimer) clearTimeout(button._ibxIconTimer);
    button.innerHTML = icon;
    button._ibxIconTimer = setTimeout(function () {
      button.innerHTML = button._ibxBaseIcon || '';
      button._ibxIconTimer = null;
    }, delay || 2000);
  }

  function renderFilterBar(found, rows, kind, includeControls) {
    var withControls = includeControls !== false;
    var existing = found.table.parentElement && found.table.parentElement.querySelector('[data-ibkr-enhancer="filterbar"]');
    if (existing && withControls && !existing.querySelector('input[type=text]')) {
      existing.remove();
      existing = null;
    }
    if (existing && !withControls && existing.querySelector('input[type=text]')) {
      existing.remove();
      existing = null;
    }
    if (existing) {
      var ex = existing.querySelector('input[type=text]');
      if (ex) { activeFilterInput = ex; ensureSlashListener(); }
      return existing;
    }
    var bar = el('div', 'ibx-filterbar'); bar.setAttribute('data-ibkr-enhancer', 'filterbar');
    if (!withControls) {
      if (found.table.parentElement) found.table.parentElement.insertBefore(bar, found.table);
      return bar;
    }
    bar.appendChild(el('span', 'ibx-flabel', 'Filters'));
    var input = document.createElement('input'); input.type = 'text'; input.placeholder = 'Filter instrument / underlying ( / )';
    input.setAttribute('data-ibkr-enhancer', '1');
    bar.appendChild(input);
    var state = getFilterState(kind);
    input.value = state.text || '';
    var refreshers = [];
    function paintBtn(b, on, label) {
      b.classList.toggle('ibx-on', !!on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.textContent = (on ? '\u2713 ' : '') + label;
    }
    function segmented(options, get, set) {
      var wrap = el('span', 'ibx-seg'); wrap.setAttribute('role', 'group');
      var btns = options.map(function (opt) {
        var b = el('button', '', opt[1]);
        b.addEventListener('click', function () { set(opt[0]); refresh(); apply(); });
        wrap.appendChild(b); return { b: b, value: opt[0], label: opt[1] };
      });
      refreshers.push(function () { btns.forEach(function (x) { paintBtn(x.b, get() === x.value, x.label); }); });
      bar.appendChild(wrap);
    }
    function pill(label, get, set) {
      var b = el('button', 'ibx-pill', label);
      b.addEventListener('click', function () { set(!get()); refresh(); apply(); });
      refreshers.push(function () { paintBtn(b, get(), label); });
      bar.appendChild(b);
    }
    function refresh() { refreshers.forEach(function (f) { f(); }); syncClear(); }
    if (kind === 'positions') {
      segmented([['all', 'All'], ['options', 'Options'], ['equities', 'Equities']], function () { return state.typeSeg; }, function (v) { state.typeSeg = v; });
      segmented([['any', 'Any'], ['d21', '\u226421d'], ['d7', '\u22647d']], function () { return state.expirySeg; }, function (v) { state.expirySeg = v; });
      pill('ITM only', function () { return state.itmOnly; }, function (v) { state.itmOnly = v; });
    } else {
      segmented([['all', 'All'], ['buys', 'Buys'], ['sells', 'Sells']], function () { return state.sideSeg; }, function (v) { state.sideSeg = v; });
      pill('Stale >14d', function () { return state.stale; }, function (v) { state.stale = v; });
    }
    var clear = el('button', 'ibx-clear', 'Clear all');
    clear.style.display = 'none';
    clear.addEventListener('click', function () {
      filterStates[kind] = defaultFilterState(kind);
      state = filterStates[kind];
      input.value = '';
      (liveRows[kind] || []).forEach(function (r) { r._tr.style.display = ''; });
      refresh();
    });
    bar.appendChild(clear);
    function syncClear() { clear.style.display = filterIsActive(state, kind) ? '' : 'none'; }
    function apply() {
      state.text = input.value.trim().toLowerCase();
      (liveRows[kind] || []).forEach(function (r) { r._tr.style.display = rowMatchesFilters(r, kind, state) ? '' : 'none'; });
      syncClear();
    }
    input.addEventListener('input', apply);
    refresh();
    if (found.table.parentElement) found.table.parentElement.insertBefore(bar, found.table);
    activeFilterInput = input;
    ensureSlashListener();
    return bar;
  }

  function renderCopyButton(found, makeCsv, label, bar) {
    var actions = toolbarActions(bar);
    if (!actions || actions.querySelector('[data-ibkr-enhancer="copy"]')) return;
    var b = el('button', 'ibx-pill ibx-icon-btn'); b.setAttribute('data-ibkr-enhancer', 'copy');
    b.type = 'button';
    b.title = label;
    b.setAttribute('aria-label', label);
    b._ibxBaseIcon = CLIPBOARD_ICON;
    b.innerHTML = CLIPBOARD_ICON;
    b.addEventListener('click', function () {
      var csv = makeCsv();
      try {
        var pending = navigator.clipboard.writeText(csv);
        if (pending && typeof pending.then === 'function') {
          pending.then(function () { log('copied CSV (' + csv.split('\n').length + ' lines)'); showTransientIcon(b, CHECK_ICON, 1500); }, function (err) { log('clipboard failed', err && err.message); showTransientIcon(b, X_ICON, 1500); });
        } else showTransientIcon(b, CHECK_ICON, 1500);
      } catch (e) { log('clipboard failed', e && e.message); showTransientIcon(b, X_ICON, 1500); }
    });
    actions.appendChild(b);
  }

  function applyReadability(table) {
    table.classList.add('ibx-sticky', 'ibx-zebra');
    if (getSetting('density') === 'compact') table.classList.add('ibx-compact'); else table.classList.remove('ibx-compact');
    Array.prototype.forEach.call(table.querySelectorAll('td,span,div'), function (n) {
      if (n.classList && n.classList.contains('_npos')) n.classList.add('ibx-pos');
      if (n.classList && n.classList.contains('_nneg')) n.classList.add('ibx-neg');
    });
  }

  // ---- Kubera export: Orders page only, GM_xmlhttpRequest only ----
  var KUBERA_SNAPSHOT_URL = 'http://127.0.0.1:8000/api/v1/broker-orders/snapshot';
  var lastOrdersFound = null;
  var exportState = { stableTimer: null, stableCount: null, stableSince: 0, inFlight: false, lastFingerprint: '', attemptedFingerprint: '' };
  function pagerTotalHint(found) {
    try {
      var host = found.table.parentElement;
      var text = host ? spacedText(host) : '';
      var m = text.match(/(\d+)\s*[-–]\s*(\d+)\s+of\s+(\d+)/i) || text.match(/of\s+(\d+)\s+(?:orders|rows|entries)\b/i);
      if (m) return parseNumber(m[m.length - 1]);
      if (/\b(next|previous)\b/i.test(text) && /\bpage\b/i.test(text)) return Infinity;
    } catch (e) { /* silent */ }
    return null;
  }
  var toastTimer = null;
  function dismissToast() {
    if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
    Array.prototype.forEach.call(document.querySelectorAll('[data-ibkr-enhancer="toast"]'), function (node) { node.remove(); });
  }
  function showToast(message, kind) {
    if (allOff()) return;
    injectStyle();
    dismissToast();
    var toast = el('div', 'ibx-toast ibx-toast-' + (kind === 'failure' ? 'failure' : 'success'));
    toast.setAttribute('data-ibkr-enhancer', 'toast');
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.appendChild(el('span', '', message));
    var close = el('button', 'ibx-toast-close', '\u00D7');
    close.type = 'button';
    close.title = 'Dismiss';
    close.setAttribute('aria-label', 'Dismiss');
    close.addEventListener('click', function (event) { event.stopPropagation(); dismissToast(); });
    toast.appendChild(close);
    toast.addEventListener('click', dismissToast);
    document.body.appendChild(toast);
    setTimeout(function () { toast.classList.add('ibx-toast-show'); }, 0);
    toastTimer = setTimeout(dismissToast, 6000);
  }
  function currentExportButton() {
    return document.querySelector('[data-ibkr-enhancer="export"]');
  }
  function setExportBusy(busy) {
    var button = currentExportButton();
    if (!button) return;
    if (button._ibxIconTimer) { clearTimeout(button._ibxIconTimer); button._ibxIconTimer = null; }
    button.innerHTML = button._ibxBaseIcon || UPLOAD_ICON;
    button.disabled = !!busy;
    button.classList.toggle('ibx-exporting', !!busy);
  }
  function shortExportReason(result) {
    var reason = '';
    if (result) reason = result.detail || (result.status ? 'HTTP ' + result.status : '') || result.message || '';
    reason = String(reason || 'network error').replace(/\s+/g, ' ').trim();
    return reason.length > 60 ? reason.slice(0, 60) : reason;
  }
  function kuberaPost(snapshot, token) {
    return new Promise(function (resolve) {
      if (typeof GM_xmlhttpRequest !== 'function') { resolve({ ok: false, detail: 'GM_xmlhttpRequest unavailable' }); return; }
      try {
        GM_xmlhttpRequest({
          method: 'POST', url: KUBERA_SNAPSHOT_URL,
          headers: { 'Content-Type': 'application/json', 'X-Kubera-Ingest-Token': token },
          data: JSON.stringify(snapshot), timeout: 8000,
          onload: function (res) {
            var body = null;
            try { body = JSON.parse(res.responseText || 'null'); } catch (e) { body = null; }
            var ok = res.status >= 200 && res.status < 300;
            resolve({ ok: ok, status: res.status, body: body, detail: ok ? '' : 'HTTP ' + res.status });
          },
          onerror: function () { resolve({ ok: false, detail: 'network error' }); },
          ontimeout: function () { resolve({ ok: false, detail: 'timeout' }); }
        });
      } catch (e) { resolve({ ok: false, detail: String(e && e.message || e) }); }
    });
  }
  function doExportOrders(force) {
    if (!getSetting('exportOrders') || exportState.inFlight) return;
    var rows = liveRows.orders || [];
    if (!lastOrdersFound) return;
    var capturedAt = formatLondonCapturedAt(new Date());
    var openRows = rows.filter(isOpenOrder);
    var complete = exportedOrdersComplete(rows.length, pagerTotalHint(lastOrdersFound));
    var snapshots = buildBrokerSnapshots(rows, { capturedAt: capturedAt, complete: complete, ingestSource: 'ibkr-enhancer', accountLabels: {} });
    // The panel alias names only the account in view; label it solely
    // when the table holds that one account, never guess the others.
    if (snapshots.length === 1 && lastAccountAlias) snapshots[0].account_label = lastAccountAlias;
    var exportedCount = snapshots.reduce(function (n, s) { return n + s.orders.length; }, 0);
    if (exportedCount < openRows.length) snapshots.forEach(function (s) { s.complete = false; });
    var fingerprint = JSON.stringify(snapshots.map(function (s) {
      return [s.account_id, s.complete, s.orders.map(function (o) { return [o.order_id, o.limit_price, o.qty_remain, o.status].join(':'); }).join(',')].join('|');
    }));
    if (!force && (fingerprint === exportState.lastFingerprint || fingerprint === exportState.attemptedFingerprint)) return;
    var token = String(getSetting('kuberaIngestToken') || '').trim();
    if (!snapshots.length) return;
    if (!token) {
      exportState.attemptedFingerprint = fingerprint;
      try { setSetting('kuberaPendingSnapshots', snapshots); } catch (e) { /* silent */ }
      showToast('Export failed: missing ingest token. Will retry on next page load.', 'failure');
      return;
    }
    exportState.inFlight = true;
    setExportBusy(true);
    Promise.all(snapshots.map(function (s) { return kuberaPost(s, token); })).then(function (results) {
      exportState.inFlight = false;
      setExportBusy(false);
      var failed = results.filter(function (r) { return !r.ok; });
      var hhmm = capturedAt.slice(11, 16);
      if (failed.length) {
        exportState.attemptedFingerprint = fingerprint;
        try { setSetting('kuberaPendingSnapshots', snapshots); } catch (e) { /* silent */ }
        var reason = shortExportReason(failed[0]);
        showToast('Export failed: ' + reason + '. Will retry on next page load.', 'failure');
        log('Kubera export failed', reason);
        return;
      }
      exportState.lastFingerprint = fingerprint;
      try { setSetting('kuberaPendingSnapshots', []); } catch (e) { /* silent */ }
      var added = 0, changed = 0, gone = 0;
      results.forEach(function (r) {
        var diff = (r.body && r.body.diff) || {};
        added += (diff.new || []).length;
        changed += (diff.changed || []).length;
        gone += (diff.gone || []).length;
      });
      showToast('Exported ' + hhmm + ', ' + exportedCount + ' orders, +' + added + ' new, ~' + changed + ' changed, -' + gone + ' gone', 'success');
      var button = currentExportButton();
      if (button) showTransientIcon(button, CHECK_ICON, 2000);
    }).catch(function (err) {
      exportState.inFlight = false;
      setExportBusy(false);
      exportState.attemptedFingerprint = fingerprint;
      try { setSetting('kuberaPendingSnapshots', snapshots); } catch (e) { /* silent */ }
      var reason = shortExportReason(err);
      showToast('Export failed: ' + reason + '. Will retry on next page load.', 'failure');
      log('Kubera export failed', reason);
    });
  }
  function scheduleStableExport() {
    if (!getSetting('exportOrders')) return;
    var count = (liveRows.orders || []).length;
    var now = Date.now();
    if (exportState.stableCount !== count) {
      exportState.stableCount = count;
      exportState.stableSince = now;
    }
    if (exportState.stableTimer) return;
    var delay = Math.max(0, 500 - (now - exportState.stableSince));
    exportState.stableTimer = setTimeout(function () {
      exportState.stableTimer = null;
      // Second check: export only when the same count has held for 500ms.
      // Re-renders alone do not restart the clock; a count change does.
      if ((liveRows.orders || []).length === exportState.stableCount) doExportOrders(false);
      else scheduleStableExport();
    }, delay);
  }
  function renderExportButton(found, bar) {
    if (!getSetting('exportOrders')) {
      removeInjected('[data-ibkr-enhancer="export"]');
      return;
    }
    var actions = toolbarActions(bar);
    if (!actions || actions.querySelector('[data-ibkr-enhancer="export"]')) return;
    var b = el('button', 'ibx-pill ibx-icon-btn');
    b.setAttribute('data-ibkr-enhancer', 'export');
    b.type = 'button';
    b.title = 'Export orders to Kubera now';
    b.setAttribute('aria-label', 'Export orders to Kubera now');
    b._ibxBaseIcon = UPLOAD_ICON;
    b.innerHTML = UPLOAD_ICON;
    if (exportState.inFlight) {
      b.disabled = true;
      b.classList.add('ibx-exporting');
    }
    b.addEventListener('click', function () { doExportOrders(true); });
    actions.appendChild(b);
  }

  function enhanceOrders(found) {
    lastOrdersFound = found;
    var rows = readOrders(found);
    liveRows.orders = rows;
    var visible = dataRows(found).length;
    log('orders parsed ' + rows.length + ' / visible ' + visible);
    var dupes = duplicateOrderKeys(rows);
    try { setSetting('ordersSnapshot', buildOrdersSnapshot(rows, new Date().toISOString())); } catch (e) { /* silent */ }
    var summary = summarizeOrders(rows);
    var totalNotional = summary.totalNotional, staleCount = summary.staleCount;
    rows.forEach(function (r) {
      if (!isOpenOrder(r)) return;
      var age = ageDays(r.statusDate);
      var notion = remainingNotional(r);
      if (getSetting('orderAges')) {
        var cell = instrumentCell(r._tr, found.headers);
        if (age !== null) addBadge(cell, age + 'd old', age > 14 ? 'ibx-badge-red' : 'ibx-badge-muted', 'Age from Status date. Remaining notional at strike: ' + (notion !== null ? fmtMoney(notion) : 'n/a'));
        else if (cell) cell.title = 'Order age unavailable; remaining notional: ' + (notion !== null ? fmtMoney(notion) : 'n/a');
        if (dupes[orderKey(r)] || dupes[rows.indexOf(r)]) r._tr.classList.add('ibx-dupe');
        if (dupes[orderKey(r)]) addBadge(cell, 'duplicate strike', 'ibx-badge-amber', 'Another open order shares underlying + expiry + strike. Flag only, no action.');
      }
    });
    if (getSetting('orderAges') && found.table.parentElement && !found.table.parentElement.querySelector('[data-ibkr-enhancer="summary"]')) {
      var s = el('div', 'ibx-summary', 'Open orders: ' + summary.openCount + ' | Total remaining option notional: ' + fmtMoney(totalNotional) + ' | Orders >14 days: ' + staleCount);
      s.setAttribute('data-ibkr-enhancer', 'summary');
      found.table.parentElement.insertBefore(s, found.table);
    }
    var ordersBar = null;
    if (getSetting('filters')) ordersBar = renderFilterBar(found, rows, 'orders');
    else if (getSetting('copyButtons') || getSetting('exportOrders')) {
      clearFilterState(found);
      ordersBar = renderFilterBar(found, rows, 'orders', false);
    } else clearFilterState(found);
    removeInjected('[data-ibkr-enhancer="export-status"]');
    if (getSetting('copyButtons')) renderCopyButton(found, function () { return ordersToCsv(rows, new Date().toISOString()); }, 'Copy orders as CSV', ordersBar);
    if (getSetting('readability')) applyReadability(found.table);
    renderExportButton(found, ordersBar);
    scheduleStableExport();
    return rows;
  }

  function setNativeValue(input, value) {
    try {
      var proto = window.HTMLInputElement && window.HTMLInputElement.prototype;
      var desc = proto && Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc && desc.set) desc.set.call(input, String(value)); else input.value = String(value);
    } catch (e) { input.value = String(value); }
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
  }
  function findLabelledInput(root, label) {
    var nodes = root.querySelectorAll('label,span,div,p');
    for (var i = 0; i < nodes.length; i++) {
      if ((nodes[i].textContent || '').trim() !== label) continue;
      var scope = nodes[i];
      for (var d = 0; scope && d < 5; d++) {
        var inp = scope.querySelector ? scope.querySelector('input') : null;
        if (inp) return inp;
        scope = scope.parentElement;
        if (scope && !root.contains(scope)) break;
      }
    }
    return null;
  }
  function enhanceTicket() {
    var ticket = document.querySelector('.order-ticket__sidebar');
    if (!ticket || !getSetting('ticketFill')) { removeInjected('[data-ibkr-enhancer="ticketfill"]'); return; }
    var tabs = ticket.querySelectorAll('[role="tab"],button,div,span');
    var closeSelected = false;
    Array.prototype.forEach.call(tabs, function (t) {
      if ((t.textContent || '').trim() !== 'Close') return;
      if (t.getAttribute && (t.getAttribute('aria-selected') === 'true' || /active|selected|checked/i.test(t.className || ''))) closeSelected = true;
    });
    if (!closeSelected) { removeInjected('[data-ibkr-enhancer="ticketfill"]'); return; }
    var key = parseInstrumentSearch(spacedText(ticket));
    if (!key) { removeInjected('[data-ibkr-enhancer="ticketfill"]'); return; }
    var snapObj = null, usingSnapshot = false;
    var source = (liveRows.positions && liveRows.positions.length) ? liveRows.positions : null;
    if (!source) {
      try { snapObj = getSetting('positionsSnapshot'); source = snapObj && snapObj.positions ? snapObj.positions : null; usingSnapshot = !!source; } catch (e) { source = null; }
    }
    var pos = findShortPosition(source, key);
    var staleSnapshot = false, aliasMismatch = false;
    if (usingSnapshot && snapObj) {
      staleSnapshot = !snapObj.savedAt || (Date.now() - new Date(snapObj.savedAt).getTime() > 24 * 3600 * 1000);
      var curAlias = null;
      try { var ctxNow = findAccountContext(); curAlias = ctxNow && ctxNow.alias ? ctxNow.alias : null; } catch (e) { curAlias = null; }
      aliasMismatch = !!(snapObj.alias && curAlias && snapObj.alias !== curAlias);
    }
    var plan = ticketFillPlan(pos, { staleSnapshot: staleSnapshot, aliasMismatch: aliasMismatch });
    if (ticket.querySelector('[data-ibkr-enhancer="ticketfill"]')) return;
    var wrap = el('div', ''); wrap.setAttribute('data-ibkr-enhancer', 'ticketfill');
    wrap.style.padding = '8px 12px';
    if (plan.blocked) {
      var reasons = { NO_MATCH: 'No exact short position match for this instrument.', STALE_SNAPSHOT: 'Positions snapshot is older than 24 hours; visit Positions to refresh it.', ALIAS_MISMATCH: 'Snapshot account does not match the account in view.', BAD_TARGET: 'Computed 60% target is not a valid limit for this position.' };
      wrap.appendChild(el('div', '', 'Fill GTC unavailable: ' + (reasons[plan.blocked] || plan.blocked)));
      var submitBtn0 = ticket.querySelector('#cp-submit-order-Buy-btn');
      var previewBtn0 = Array.prototype.filter.call(ticket.querySelectorAll('button'), function (b) { return /preview/i.test(b.textContent || ''); })[0];
      var anchor0 = (submitBtn0 && ticket.contains(submitBtn0)) ? submitBtn0 : previewBtn0;
      var footer0 = anchor0 ? anchor0.parentElement : null;
      if (footer0 && footer0.parentElement) footer0.parentElement.insertBefore(wrap, footer0); else ticket.appendChild(wrap);
      return;
    }
    var btn = el('button', 'ibx-pill', 'Fill GTC 60% close');
    btn.style.display = 'block'; btn.style.width = '100%'; btn.style.padding = '8px';
    var caption = el('div', '', 'Fills quantity, limit and TIF only. Review and submit yourself.');
    caption.style.opacity = '.65'; caption.style.fontSize = '11px'; caption.style.marginTop = '4px';
    btn.addEventListener('click', function () {
      if (wrap.querySelector('[data-ibkr-enhancer="ticket-summary"]')) return;
      var summary = el('div', ''); summary.setAttribute('data-ibkr-enhancer', 'ticket-summary');
      summary.style.marginTop = '8px';
      var lines = [
        'You are about to fill a BUY to close order.',
        'Quantity: ' + plan.qty,
        'Instrument: ' + key.instrument,
        'Limit: ' + plan.limit.toFixed(2) + ' (60% capture target)',
        'Average premium received: ' + (plan.avgPrice !== null && plan.avgPrice !== undefined ? plan.avgPrice : 'n/a'),
        'Capture at this limit: ' + plan.capturePct.toFixed(1) + '%',
        'Time-In-Force: GTC'
      ];
      lines.forEach(function (ln) { summary.appendChild(el('div', '', ln)); });
      var askEl = ticket.querySelector('.ask-price');
      var ask = askEl ? parseNumber(askEl.textContent) : null;
      if (ask === null) {
        var askM = spacedText(ticket).match(/\bAsk\s*:?\s+([+-]?[\d,]+(?:\.\d+)?)/i);
        ask = askM ? parseNumber(askM[1]) : null;
      }
      if (ask !== null && plan.limit >= ask) summary.appendChild(el('div', '', 'Warning: target is at or above the ask price; this fills immediately and will not rest as a GTC.'));
      if (plan.last !== null && plan.last !== undefined && plan.last < plan.limit) summary.appendChild(el('div', '', 'Warning: the last price is already beyond the target.'));
      var fillBtn = el('button', 'ibx-pill ibx-on', 'Fill');
      var cancelBtn = el('button', '', 'Cancel');
      fillBtn.addEventListener('click', function () {
        var qtyInput = findLabelledInput(ticket, 'Quantity');
        var limitInput = findLabelledInput(ticket, 'Limit Price');
        var tifSelect = ticket.querySelector('select');
        var tifCombo = ticket.querySelector('[role="combobox"],[aria-haspopup="listbox"]');
        if (!qtyInput || !limitInput || (!tifSelect && !tifCombo)) { log('ticket fill aborted: controls missing'); return; }
        var pre = { qty: qtyInput.value, limit: limitInput.value, tif: tifCombo ? (tifCombo.textContent || '').trim() : (tifSelect ? tifSelect.value : '') };
        setNativeValue(qtyInput, plan.qty);
        setNativeValue(limitInput, plan.limit.toFixed(2));
        if (tifSelect) {
          var opt = Array.prototype.filter.call(tifSelect.options || [], function (o) { return (o.textContent || '').trim().toUpperCase() === 'GTC'; })[0];
          if (opt) { tifSelect.value = opt.value; tifSelect.dispatchEvent(new window.Event('change', { bubbles: true })); }
        } else if (tifCombo && !/\bGTC\b/.test(tifCombo.textContent || '')) {
          tifCombo.click();
          setTimeout(function () {
            Array.prototype.forEach.call(document.querySelectorAll('[role="option"]'), function (o) { if ((o.textContent || '').trim().toUpperCase() === 'GTC') o.click(); });
          }, 60);
        }
        setTimeout(function () {
          var gotQty = qtyInput.value, gotLimit = limitInput.value;
          var gotTif = tifCombo ? (tifCombo.textContent || '').trim() : (tifSelect ? tifSelect.options[tifSelect.selectedIndex].textContent.trim() : '');
          var problems = [];
          if (String(gotQty) !== String(plan.qty)) problems.push('quantity reads ' + gotQty);
          if (parseNumber(gotLimit) !== plan.limit) problems.push('limit reads ' + gotLimit);
          if (!/\bGTC\b/.test(gotTif || '')) problems.push('TIF reads ' + (gotTif || 'empty'));
          var receipt = el('div', '', problems.length ? ('Receipt warning: ' + problems.join('; ') + '. Review before submitting.') :
            ('Filled: quantity ' + gotQty + ', limit ' + gotLimit + ', TIF GTC. Review and submit yourself.'));
          receipt.style.marginTop = '6px';
          var undoBtn = el('button', '', 'Undo');
          undoBtn.addEventListener('click', function () {
            setNativeValue(qtyInput, pre.qty);
            setNativeValue(limitInput, pre.limit);
            if (tifCombo && pre.tif && !new RegExp('\\b' + pre.tif.toUpperCase() + '\\b').test((tifCombo.textContent || '').toUpperCase())) {
              tifCombo.click();
              setTimeout(function () {
                Array.prototype.forEach.call(document.querySelectorAll('[role="option"]'), function (o) { if ((o.textContent || '').trim() === pre.tif) o.click(); });
              }, 60);
            } else if (tifSelect && pre.tif) { tifSelect.value = pre.tif; tifSelect.dispatchEvent(new window.Event('change', { bubbles: true })); }
            receipt.textContent = 'Undone: pre-fill values restored.';
          });
          summary.appendChild(receipt); summary.appendChild(undoBtn);
        }, 200);
      });
      cancelBtn.addEventListener('click', function () { summary.remove(); });
      summary.appendChild(fillBtn); summary.appendChild(cancelBtn);
      wrap.appendChild(summary);
    });
    wrap.appendChild(btn); wrap.appendChild(caption);
    var submitBtn = ticket.querySelector('#cp-submit-order-Buy-btn') || document.querySelector('#cp-submit-order-Buy-btn');
    var previewBtn = Array.prototype.filter.call(ticket.querySelectorAll('button'), function (b) { return /preview/i.test(b.textContent || ''); })[0];
    var anchorBtn = (submitBtn && ticket.contains(submitBtn)) ? submitBtn : previewBtn;
    var footer = anchorBtn ? anchorBtn.parentElement : null;
    if (footer && footer.parentElement) footer.parentElement.insertBefore(wrap, footer);
    else ticket.appendChild(wrap);
  }

  function cleanupNative() {
    removeInjected('[data-ibkr-enhancer]');
    Array.prototype.forEach.call(document.querySelectorAll('table.ibx-sticky, table.ibx-zebra, table.ibx-compact'), function (t) {
      t.classList.remove('ibx-sticky', 'ibx-zebra', 'ibx-compact');
    });
    Array.prototype.forEach.call(document.querySelectorAll('#cp-ib-app-main-content tbody tr'), function (tr) { tr.style.display = ''; });
  }

  var running = false, queued = false;
  function run() {
    if (running) { queued = true; return; }
    running = true;
    try {
      // Clear enhancer-owned row artefacts; native rows themselves are never removed.
      removeInjected('[data-ibkr-enhancer="badge"]');
      removeInjected('[data-ibkr-enhancer="subtotal"]');
      Array.prototype.forEach.call(document.querySelectorAll('tr.ibx-dupe'), function (tr) { tr.classList.remove('ibx-dupe'); tr.style.display = ''; });
      if (allOff()) { cleanupNative(); return; }
      injectStyle();
      var found = findTables();
      if (found.positions && !getSetting('grouping')) restoreGrouping(found.positions);
      renderMarginBar(findAccountContext());
      if (found.positions) enhancePositions(found.positions);
      if (found.orders) enhanceOrders(found.orders);
      if (found.positions) applyFilterToRows('positions');
      if (found.orders) applyFilterToRows('orders');
      enhanceTicket();
      if (!found.positions) removeInjected('[data-ibkr-enhancer="panel"]');
    } catch (e) { log('run failed (silent in UI)', e && e.message); }
    finally { running = false; if (queued) { queued = false; scheduleRun(); } }
  }

  var timer = null;
  function scheduleRun() { if (timer) clearTimeout(timer); timer = setTimeout(run, 250); }

  function boot() {
    window.addEventListener('hashchange', scheduleRun);
    var main = document.querySelector('#cp-ib-app-main-content');
    if (main) {
      var obs = new MutationObserver(function (muts) {
        var relevant = muts.some(function (m) { return !(m.target.closest && m.target.closest('[data-ibkr-enhancer]')); });
        if (relevant) scheduleRun();
      });
      obs.observe(main, { childList: true, subtree: true });
    } else {
      var fallback = new MutationObserver(function () { var m2 = document.querySelector('#cp-ib-app-main-content'); if (m2) { fallback.disconnect(); boot(); } });
      fallback.observe(document.documentElement, { childList: true, subtree: true });
    }
    scheduleRun();
    log('loaded on ' + window.location.hash);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
