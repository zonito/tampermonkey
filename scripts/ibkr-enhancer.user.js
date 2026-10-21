// ==UserScript==
// @name         IBKR Enhancer
// @namespace    https://github.com/zonito/tampermonkey
// @version      0.1.1
// @description  Read-only scan aids for IBKR Client Portal: margin cushion, option expiry/ITM/premium badges, grouping, filters, order age and CSV copy. Never places, cancels or modifies orders.
// @author       Zonito
// @match        https://www.interactivebrokers.co.uk/portal/*
// @match        https://www.interactivebrokers.com/portal/*
// @run-at       document-idle
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
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
  function duplicateOrderKeys(orders) {
    var seen = {}, dups = {};
    (orders || []).forEach(function (o, i) {
      if (!o || o.type === 'equity') return;
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
  // ================= PARSER END =================

  var PARSER = { parseNumber: parseNumber, parseInstrument: parseInstrument, normalizeHeader: normalizeHeader,
    parsePositionRow: parsePositionRow, parseOrderRow: parseOrderRow, parseOrderMeta: parseOrderMeta,
    parseStatus: parseStatus, dte: dte, ageDays: ageDays, cushionPct: cushionPct, cushionBand: cushionBand,
    premiumCaptured: premiumCaptured, isITM: isITM, netDeltaExposure: netDeltaExposure,
    remainingNotional: remainingNotional, duplicateOrderKeys: duplicateOrderKeys, orderKey: orderKey,
    positionsToCsv: positionsToCsv, ordersToCsv: ordersToCsv };
  if (typeof module !== 'undefined' && module.exports) module.exports = PARSER;

  // ---------- settings ----------
  var DEFAULTS = { marginBar: true, badges: true, grouping: false, filters: true, orderAges: true,
    copyButtons: true, readability: true, density: 'comfortable', dismissedBar: false };
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
      !getSetting('filters') && !getSetting('orderAges') && !getSetting('copyButtons') && !getSetting('readability');
  }

  var CSS = [
    '[data-ibkr-enhancer]{box-sizing:border-box}',
    '.ibx-bar{position:fixed;bottom:12px;right:12px;z-index:9999;display:flex;gap:10px;align-items:center;flex-wrap:wrap;max-width:92vw;padding:6px 10px;border-radius:8px;background:rgba(20,22,28,.94);color:#e8e8e8;border:1px solid rgba(255,255,255,.18);font:12px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;box-shadow:0 4px 18px rgba(0,0,0,.4)}',
    '.ibx-bar .ibx-lab{opacity:.65}.ibx-bar .ibx-val{font-weight:600}',
    '.ibx-cushion-green{color:#4caf50}.ibx-cushion-amber{color:#ffb300}.ibx-cushion-red{color:#ef5350}',
    '.ibx-badge{display:inline-block;margin-left:6px;padding:0 5px;border-radius:8px;font-size:10px;font-weight:700;vertical-align:middle}',
    '.ibx-badge-red{background:#5a1f1f;color:#ff8a80}.ibx-badge-amber{background:#554410;color:#ffd54f}.ibx-badge-green{background:#1e4620;color:#81c784}.ibx-badge-muted{background:#333;color:#bbb;font-weight:400}',
    '.ibx-filterbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:6px 4px;font:12px -apple-system,Segoe UI,Roboto,sans-serif}',
    '.ibx-filterbar input[type=text]{min-width:180px;padding:4px 8px;border-radius:6px}',
    '.ibx-filterbar button,.ibx-bar button{cursor:pointer;border-radius:6px;padding:3px 8px}',
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
    if (!txt) txt = cell.textContent || '';
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
      return model;
    });
  }

  // Account header anchor: alias + account-id token + currency -> headline value -> signed change.
  function findAccountContext() {
    var main = document.querySelector('#cp-ib-app-main-content');
    if (!main) return null;
    var labels = ['Excess Liquidity', 'Buying Power', 'Maintenance Margin', 'Unrealized P&L'];
    var labelEls = {}, firstLabelEl = null;
    Array.prototype.forEach.call(main.querySelectorAll('div,span,td,li'), function (el) {
      var t = (el.textContent || '').trim();
      labels.forEach(function (lab) {
        if (t === lab && !labelEls[lab]) { labelEls[lab] = el; if (!firstLabelEl) firstLabelEl = el; }
      });
    });
    function labelledValue(lab) {
      var el = labelEls[lab]; if (!el) return null;
      var container = el.parentElement;
      var scope = container ? container.textContent : el.textContent;
      var rest = String(scope || '').replace(lab, '');
      var nums = rest.match(/[+-]?[\d,]+(?:\.\d+)?/g);
      return nums && nums.length ? parseNumber(nums[0]) : null;
    }
    var fields = {};
    labels.forEach(function (lab) { fields[lab] = labelledValue(lab); });
    // Headline anchor: the sidebar account item = smallest ancestor of the
    // summary labels whose subtree also contains the account-ID token.
    var alias = null, headline = null, maskedId = null;
    var item = null, node = firstLabelEl;
    for (var depth = 0; node && depth < 10; depth++) {
      if (/\b[A-Z]\d{5,}\b/.test(node.textContent || '')) { item = node; break; }
      node = node.parentElement;
    }
    if (item) {
      var fullText = (item.textContent || '').replace(/\s+/g, ' ').trim();
      var cut = fullText.length;
      labels.forEach(function (lab) { var i = fullText.indexOf(lab); if (i >= 0 && i < cut) cut = i; });
      var header = fullText.slice(0, cut);
      var idm = header.match(/\b([A-Z]\d{5,})\b/);
      if (idm) {
        maskedId = idm[1].charAt(0) + '\u2022\u2022\u2022' + idm[1].slice(-2);
        var curIdx = header.search(/\b(USD|GBP|EUR)\b/);
        var signed = /[+-][\d,]+(?:\.\d+)?/.test(header);
        if (curIdx >= 0 && signed) {
          var afterCur = header.slice(curIdx).replace(/^(USD|GBP|EUR)\b/, '');
          var money = afterCur.match(/[+-]?[\d,]+(?:\.\d{2})/);
          if (money) {
            var candidate = parseNumber(money[0]);
            var clashes = Object.keys(fields).some(function (k) { return fields[k] !== null && candidate === fields[k]; });
            if (!clashes) headline = candidate;
          }
        }
        var before = header.split(idm[1])[0].trim().replace(/[|•·\-:]+$/, '').trim();
        alias = before ? before.split(/\s+/).slice(-3).join(' ') : maskedId;
      }
    }
    return { fields: fields, headline: headline, alias: alias, maskedId: maskedId };
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

  function renderMarginBar(ctx) {
    removeInjected('[data-ibkr-enhancer="bar"]');
    if (!getSetting('marginBar') || getSetting('dismissedBar')) return;
    if (!ctx) return;
    var hasAny = ctx.headline !== null || Object.keys(ctx.fields).some(function (k) { return ctx.fields[k] !== null; });
    if (!hasAny) return;
    var bar = el('div', 'ibx-bar'); bar.setAttribute('data-ibkr-enhancer', 'bar');
    function pair(label, value) {
      var s = el('span'); var l = el('span', 'ibx-lab', label + ': '); var v = el('span', 'ibx-val', value);
      s.appendChild(l); s.appendChild(v); return s;
    }
    bar.appendChild(pair('Account', ctx.alias || ctx.maskedId || 'Account \u2022\u2022\u2022'));
    bar.appendChild(pair('NLV', fmtMoney(ctx.headline)));
    bar.appendChild(pair('Excess Liq', fmtMoney(ctx.fields['Excess Liquidity'])));
    bar.appendChild(pair('Buying Power', fmtMoney(ctx.fields['Buying Power'])));
    bar.appendChild(pair('Maint Margin', fmtMoney(ctx.fields['Maintenance Margin'])));
    bar.appendChild(pair('Unreal. P&L', fmtMoney(ctx.fields['Unrealized P&L'])));
    var cushion = cushionPct(ctx.fields['Excess Liquidity'], ctx.headline);
    var band = cushionBand(cushion);
    if (cushion !== null && band) {
      var c = pair('Cushion', cushion.toFixed(1) + '%');
      c.querySelector('.ibx-val').className = 'ibx-val ibx-cushion-' + band;
      bar.appendChild(c);
    }
    var gear = el('button', '', '\u2699'); gear.title = 'IBKR Enhancer settings';
    gear.addEventListener('click', togglePanel);
    var close = el('button', '', '\u00D7'); close.title = 'Dismiss (re-enable in settings)';
    close.addEventListener('click', function () { setSetting('dismissedBar', true); bar.remove(); });
    bar.appendChild(gear); bar.appendChild(close);
    document.body.appendChild(bar);
  }

  function togglePanel() {
    var existing = document.querySelector('[data-ibkr-enhancer="panel"]');
    if (existing) { existing.remove(); return; }
    var panel = el('div', 'ibx-panel'); panel.setAttribute('data-ibkr-enhancer', 'panel');
    var title = el('div', '', 'IBKR Enhancer settings'); title.style.fontWeight = '700'; panel.appendChild(title);
    [['marginBar', 'Margin bar'], ['badges', 'Positions badges'], ['grouping', 'Group by underlying'],
     ['filters', 'Filter bars'], ['orderAges', 'Order age / notional'], ['copyButtons', 'Copy CSV buttons'],
     ['readability', 'Readability (zebra/header/density)']].forEach(function (pairDef) {
      var row = el('label'); row.style.display = 'block';
      var cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!getSetting(pairDef[0]);
      cb.setAttribute('data-ibkr-enhancer', '1');
      cb.addEventListener('change', function () { setSetting(pairDef[0], cb.checked); if (pairDef[0] === 'marginBar' && cb.checked) setSetting('dismissedBar', false); scheduleRun(); });
      row.appendChild(cb); row.appendChild(document.createTextNode(' ' + pairDef[1])); panel.appendChild(row);
    });
    var drow = el('label', '', 'Density: '); drow.style.display = 'block';
    var sel = document.createElement('select'); sel.setAttribute('data-ibkr-enhancer', '1');
    ['comfortable', 'compact'].forEach(function (d) { var o = document.createElement('option'); o.value = d; o.textContent = d; if (getSetting('density') === d) o.selected = true; sel.appendChild(o); });
    sel.addEventListener('change', function () { setSetting('density', sel.value); scheduleRun(); });
    drow.appendChild(sel); panel.appendChild(drow);
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
    if (getSetting('grouping')) applyGrouping(found, rows);
    if (getSetting('filters')) renderFilterBar(found, rows, 'positions'); else clearFilterState(found);
    if (getSetting('copyButtons')) renderCopyButton(found, function () { return positionsToCsv(rows, new Date().toISOString()); }, 'Copy positions as CSV');
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

  function rowMatchesFilters(r, kind, state) {
    var text = state.text;
    if (text && (r.instrument + ' ' + r.underlying).toLowerCase().indexOf(text) === -1) return false;
    if (kind === 'positions') {
      if (state.optionsOnly && r.type === 'equity') return false;
      if (state.equitiesOnly && r.type !== 'equity') return false;
      if (state.itmOnly && !r._itm) return false;
      var days = dte(r.expiry);
      if (state.d7 && !(days !== null && days <= 7)) return false;
      if (state.d21 && !(days !== null && days <= 21)) return false;
    } else {
      if (state.buysOnly && r.action !== 'Buy') return false;
      if (state.sellsOnly && r.action !== 'Sell') return false;
      var age = ageDays(r.statusDate);
      if (state.stale && !(age !== null && age > 14)) return false;
    }
    return true;
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

  function renderFilterBar(found, rows, kind) {
    var existing = found.table.parentElement && found.table.parentElement.querySelector('[data-ibkr-enhancer="filterbar"]');
    if (existing) { var ex = existing.querySelector('input[type=text]'); if (ex) { activeFilterInput = ex; ensureSlashListener(); } return; }
    var bar = el('div', 'ibx-filterbar'); bar.setAttribute('data-ibkr-enhancer', 'filterbar');
    var input = document.createElement('input'); input.type = 'text'; input.placeholder = 'Filter instrument / underlying ( / )';
    input.setAttribute('data-ibkr-enhancer', '1');
    bar.appendChild(input);
    var state = { text: '', optionsOnly: false, equitiesOnly: false, itmOnly: false, d7: false, d21: false, buysOnly: false, sellsOnly: false, stale: false };
    function toggle(label, key) {
      var b = el('button', '', label);
      b.addEventListener('click', function () { state[key] = !state[key]; b.style.fontWeight = state[key] ? '700' : '400'; apply(); });
      bar.appendChild(b);
    }
    if (kind === 'positions') { toggle('Options only', 'optionsOnly'); toggle('Equities only', 'equitiesOnly'); toggle('ITM only', 'itmOnly'); toggle('Expiring \u22647d', 'd7'); toggle('Expiring \u226421d', 'd21'); }
    else { toggle('Buys only', 'buysOnly'); toggle('Sells only', 'sellsOnly'); toggle('Stale >14d', 'stale'); }
    var reset = el('button', '', 'Reset');
    reset.addEventListener('click', function () {
      Object.keys(state).forEach(function (k) { state[k] = (k === 'text' ? '' : false); });
      input.value = '';
      rows.forEach(function (r) { r._tr.style.display = ''; });
      Array.prototype.forEach.call(bar.querySelectorAll('button'), function (b) { b.style.fontWeight = '400'; });
    });
    bar.appendChild(reset);
    function apply() {
      state.text = input.value.trim().toLowerCase();
      rows.forEach(function (r) { r._tr.style.display = rowMatchesFilters(r, kind, state) ? '' : 'none'; });
    }
    input.addEventListener('input', apply);
    if (found.table.parentElement) found.table.parentElement.insertBefore(bar, found.table);
    activeFilterInput = input;
    ensureSlashListener();
  }

  function renderCopyButton(found, makeCsv, label) {
    if (found.table.parentElement && found.table.parentElement.querySelector('[data-ibkr-enhancer="copy"]')) return;
    var b = el('button', '', label); b.setAttribute('data-ibkr-enhancer', 'copy');
    b.addEventListener('click', function () {
      var csv = makeCsv();
      try { navigator.clipboard.writeText(csv).then(function () { log('copied CSV (' + csv.split('\n').length + ' lines)'); }); }
      catch (e) { log('clipboard failed', e && e.message); }
    });
    if (found.table.parentElement) found.table.parentElement.insertBefore(b, found.table);
  }

  function applyReadability(table) {
    table.classList.add('ibx-sticky', 'ibx-zebra');
    if (getSetting('density') === 'compact') table.classList.add('ibx-compact'); else table.classList.remove('ibx-compact');
    Array.prototype.forEach.call(table.querySelectorAll('td,span,div'), function (n) {
      if (n.classList && n.classList.contains('_npos')) n.classList.add('ibx-pos');
      if (n.classList && n.classList.contains('_nneg')) n.classList.add('ibx-neg');
    });
  }

  function enhanceOrders(found) {
    var rows = readOrders(found);
    var visible = dataRows(found).length;
    log('orders parsed ' + rows.length + ' / visible ' + visible);
    var dupes = duplicateOrderKeys(rows);
    var totalNotional = 0, staleCount = 0;
    rows.forEach(function (r) {
      var age = ageDays(r.statusDate);
      if (age !== null && age > 14) staleCount++;
      var notion = remainingNotional(r);
      if (notion !== null) totalNotional += notion;
      if (getSetting('orderAges')) {
        var cell = instrumentCell(r._tr, found.headers);
        if (age !== null) addBadge(cell, age + 'd old', age > 14 ? 'ibx-badge-red' : 'ibx-badge-muted', 'Age from Status date. Remaining notional at strike: ' + (notion !== null ? fmtMoney(notion) : 'n/a'));
        else if (cell) cell.title = 'Order age unavailable; remaining notional: ' + (notion !== null ? fmtMoney(notion) : 'n/a');
        if (dupes[orderKey(r)] || dupes[rows.indexOf(r)]) r._tr.classList.add('ibx-dupe');
        if (dupes[orderKey(r)]) addBadge(cell, 'duplicate strike', 'ibx-badge-amber', 'Another open order shares underlying + expiry + strike. Flag only, no action.');
      }
    });
    if (getSetting('orderAges') && found.table.parentElement && !found.table.parentElement.querySelector('[data-ibkr-enhancer="summary"]')) {
      var s = el('div', 'ibx-summary', 'Open orders: ' + rows.length + ' | Total remaining option notional: ' + fmtMoney(totalNotional) + ' | Orders >14 days: ' + staleCount);
      s.setAttribute('data-ibkr-enhancer', 'summary');
      found.table.parentElement.insertBefore(s, found.table);
    }
    if (getSetting('filters')) renderFilterBar(found, rows, 'orders'); else clearFilterState(found);
    if (getSetting('copyButtons')) renderCopyButton(found, function () { return ordersToCsv(rows, new Date().toISOString()); }, 'Copy orders as CSV');
    if (getSetting('readability')) applyReadability(found.table);
    return rows;
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
