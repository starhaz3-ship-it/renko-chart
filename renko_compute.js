/* renko_compute.js — on-device port of the Python Renko/Star/Chandelier/Fib/RSI/EWO/ADX/DEMA pipeline.
   Produces the SAME payload shape the chart's render layer consumes, so the standalone app needs NO server:
   the phone fetches Binance klines and computes everything here. Validated vs the Python in node. */
(function (root) {
  'use strict';
  const FIB_ZONES = [0.5, 0.618, 0.707, 0.786];
  const GRID = [0, 0.236, 0.382, 0.5, 0.618, 0.707, 0.786, 1.0];
  const r2 = (x) => Math.round(x * 100) / 100, r4 = (x) => Math.round(x * 10000) / 10000;

  function ema(x, n) { const a = 2 / (n + 1), o = new Array(x.length); o[0] = x[0]; for (let i = 1; i < x.length; i++) o[i] = a * x[i] + (1 - a) * o[i - 1]; return o; }
  function rma(x, n) { const a = 1 / n, o = new Array(x.length); o[0] = x[0]; for (let i = 1; i < x.length; i++) o[i] = a * x[i] + (1 - a) * o[i - 1]; return o; }
  function sma(x, n) { const o = new Array(x.length); let s = 0; for (let i = 0; i < x.length; i++) { s += x[i]; if (i >= n) s -= x[i - n]; o[i] = s / Math.min(i + 1, n); } return o; }
  function atr(h, l, c, n) { const tr = new Array(c.length); tr[0] = h[0] - l[0]; for (let i = 1; i < c.length; i++) { const pc = c[i - 1]; tr[i] = Math.max(h[i] - l[i], Math.abs(h[i] - pc), Math.abs(l[i] - pc)); } return rma(tr, n); }
  function rollmax(x, n) { const o = new Array(x.length); for (let i = 0; i < x.length; i++) { let m = -Infinity; for (let j = Math.max(0, i - n + 1); j <= i; j++) if (x[j] > m) m = x[j]; o[i] = m; } return o; }
  function rollmin(x, n) { const o = new Array(x.length); for (let i = 0; i < x.length; i++) { let m = Infinity; for (let j = Math.max(0, i - n + 1); j <= i; j++) if (x[j] < m) m = x[j]; o[i] = m; } return o; }
  function median(x) { const a = x.filter((v) => isFinite(v)).slice().sort((p, q) => p - q); const m = a.length; if (!m) return 0; const mid = Math.floor(m / 2); return m % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2; }  // matches numpy nanmedian
  function dema(x, p) { const e = ema(x, p), ee = ema(e, p); return x.map((_, i) => 2 * e[i] - ee[i]); }

  function star_entries(o, h, l, c, len) {
    len = len || 55; const n = c.length;
    const src = c.map((_, i) => (o[i] + h[i] + l[i] + c[i]) / 4);
    const haO = new Array(n); haO[0] = src[0]; for (let i = 1; i < n; i++) haO[i] = (src[i] + haO[i - 1]) / 2;
    const haC = c.map((_, i) => (src[i] + haO[i] + Math.max(h[i], haO[i]) + Math.min(l[i], haO[i])) / 4);
    const tma = (s) => { const e1 = ema(s, len), e2 = ema(e1, len), e3 = ema(e2, len); return s.map((_, i) => 3 * e1[i] - 3 * e2[i] + e3[i]); };
    const T1 = tma(haC), T2 = tma(T1), kirmizi = T1.map((_, i) => T1[i] + (T1[i] - T2[i]));
    const hlc3 = c.map((_, i) => (h[i] + l[i] + c[i]) / 3);
    const T3 = tma(hlc3), T4 = tma(T3), mavi = T3.map((_, i) => T3[i] + (T3[i] - T4[i]));
    const lng = new Array(n).fill(false), sht = new Array(n).fill(false);
    for (let i = 1; i < n; i++) { lng[i] = mavi[i] > kirmizi[i] && mavi[i - 1] <= kirmizi[i - 1]; sht[i] = mavi[i] < kirmizi[i] && mavi[i - 1] >= kirmizi[i - 1]; }
    return { mavi, kirmizi, long: lng, short: sht };
  }

  function chandelier(h, l, c, len, mult) {
    len = len || 22; mult = mult || 3.0; const n = c.length;
    const a = atr(h, l, c, len).map((v) => v * mult), hh = rollmax(c, len), ll = rollmin(c, len);
    const longStop = hh.map((v, i) => v - a[i]), shortStop = ll.map((v, i) => v + a[i]);
    const LS = longStop.slice(), SS = shortStop.slice(), dir = new Array(n).fill(1);
    for (let i = 1; i < n; i++) {
      LS[i] = c[i - 1] > LS[i - 1] ? Math.max(longStop[i], LS[i - 1]) : longStop[i];
      SS[i] = c[i - 1] < SS[i - 1] ? Math.min(shortStop[i], SS[i - 1]) : shortStop[i];
      dir[i] = c[i] > SS[i - 1] ? 1 : (c[i] < LS[i - 1] ? -1 : dir[i - 1]);
    }
    const buy = new Array(n).fill(false), sell = new Array(n).fill(false);
    for (let i = 1; i < n; i++) { buy[i] = dir[i] === 1 && dir[i - 1] === -1; sell[i] = dir[i] === -1 && dir[i - 1] === 1; }
    return { long_stop: LS, short_stop: SS, dir, buy, sell };
  }

  function build_renko(ts, close, high, low, brick) {
    const bo = [], bh = [], bl = [], bc = [], bt = [], bd = []; let last = Math.round(close[0] / brick) * brick;
    for (let i = 0; i < close.length; i++) {
      const p = close[i], diff = p - last; if (Math.abs(diff) < brick) continue;
      const steps = Math.floor(Math.abs(diff) / brick), d = diff > 0 ? 1 : -1;
      for (let s = 0; s < steps; s++) { const o = last, cl = last + d * brick; bo.push(o); bc.push(cl); bh.push(Math.max(o, cl)); bl.push(Math.min(o, cl)); bd.push(d); bt.push(ts[i]); last = cl; }
    }
    return { ts: bt, open: bo, high: bh, low: bl, close: bc, dir: bd };
  }

  function find_pivots(c, k) {
    const n = c.length, ph = new Array(n).fill(false), pl = new Array(n).fill(false);
    for (let i = k; i < n - k; i++) {
      let mx = -Infinity, mn = Infinity, amx = i, amn = i;
      for (let j = i - k; j <= i + k; j++) { if (c[j] > mx) { mx = c[j]; amx = j; } if (c[j] < mn) { mn = c[j]; amn = j; } }
      if (c[i] === mx && amx === i) ph[i] = true; if (c[i] === mn && amn === i) pl[i] = true;
    }
    return { ph, pl };
  }
  function dominant_swing(c, lb) { const n = c.length, a = Math.max(0, n - lb); let ih = a, il = a; for (let i = a; i < n; i++) { if (c[i] > c[ih]) ih = i; if (c[i] < c[il]) il = i; } return { il, ih, L: c[il], H: c[ih] }; }
  function fib_levels(L, H) { const rng = H - L; return GRID.map((p) => ({ p, price: r2(L + p * rng), zone: FIB_ZONES.indexOf(p) >= 0 })); }
  function fib_zone_reversals(c, ph, pl, L, H, brick, bandFrac) {
    const rng = Math.max(H - L, 1e-9), band = Math.max(0.6 * brick, bandFrac * rng), zp = FIB_ZONES.map((p) => L + p * rng), revs = [];
    for (let i = 0; i < c.length; i++) { if (!(ph[i] || pl[i])) continue; for (let z = 0; z < zp.length; z++) { if (Math.abs(c[i] - zp[z]) <= band) { revs.push({ idx: i, dir: ph[i] ? -1 : 1, level: FIB_ZONES[z], price: c[i] }); break; } } }
    return revs;
  }
  function confluence(se, ce, fib, gap, win) {
    const sL = [], sS = [], cB = [], cS = [];
    for (let i = 0; i < se.long.length; i++) { if (se.long[i]) sL.push(i); if (se.short[i]) sS.push(i); if (ce.buy[i]) cB.push(i); if (ce.sell[i]) cS.push(i); }
    const out = {};
    [[1, sL, cB], [-1, sS, cS]].forEach(([d, stars, chands]) => stars.forEach((si) => {
      const near = chands.filter((ci) => Math.abs(ci - si) <= gap); if (!near.length) return;
      const ci = near.reduce((b, x) => Math.abs(x - si) < Math.abs(b - si) ? x : b), sig = Math.max(si, ci);
      const fz = fib.filter((r) => r.dir === d && sig - r.idx >= 0 && sig - r.idx <= win);
      if (fz.length) { const fr = fz.reduce((b, x) => x.idx > b.idx ? x : b); out[sig] = { idx: sig, dir: d, fib_level: fr.level }; }
    }));
    return Object.values(out).sort((a, b) => a.idx - b.idx);
  }
  function rsi(c, n) { n = n || 14; const d = new Array(c.length); d[0] = 0; for (let i = 1; i < c.length; i++) d[i] = c[i] - c[i - 1]; const up = d.map((v) => v > 0 ? v : 0), dn = d.map((v) => v < 0 ? -v : 0), ru = rma(up, n), rd = rma(dn, n); return c.map((_, i) => 100 - 100 / (1 + ru[i] / (rd[i] + 1e-12))); }
  function ewo(h, l) { const hl2 = h.map((_, i) => (h[i] + l[i]) / 2), f = sma(hl2, 5), s = sma(hl2, 35); return hl2.map((_, i) => f[i] - s[i]); }
  function adx(h, l, c, n) {
    n = n || 14; const N = c.length, up = new Array(N).fill(0), dn = new Array(N).fill(0), tr = new Array(N); tr[0] = h[0] - l[0];
    for (let i = 1; i < N; i++) { const u = h[i] - h[i - 1], dd = l[i - 1] - l[i]; up[i] = (u > dd && u > 0) ? u : 0; dn[i] = (dd > u && dd > 0) ? dd : 0; const pc = c[i - 1]; tr[i] = Math.max(h[i] - l[i], Math.abs(h[i] - pc), Math.abs(l[i] - pc)); }
    const a = rma(tr, n).map((v) => v === 0 ? 1e-9 : v), pdi = rma(up, n).map((v, i) => 100 * v / a[i]), ndi = rma(dn, n).map((v, i) => 100 * v / a[i]);
    return rma(pdi.map((v, i) => 100 * Math.abs(pdi[i] - ndi[i]) / Math.max(pdi[i] + ndi[i], 1e-9)), n);
  }

  const TUNED = { CONFLUENCE_GAP: 3, FIB_WINDOW: 14, PIVOT_K: 4, SWING_LOOKBACK: 260, CE_LEN: 22, CE_MULT: 3.0, FIB_BAND_FRAC: 0.045 };

  // klines: Binance fapi rows [openTimeMs, o,h,l,c,vol,...]; renko=true (5m bricks) / false (raw candles)
  function computePayload(symbol, interval, klines, renko, tuned) {
    const T = Object.assign({}, TUNED, tuned || {});
    const ts0 = klines.map((k) => Math.floor(k[0] / 1000)), o0 = klines.map((k) => +k[1]), h0 = klines.map((k) => +k[2]), l0 = klines.map((k) => +k[3]), c0 = klines.map((k) => +k[4]);
    const brick = Math.max(median(atr(h0, l0, c0, 14)), 1e-9);
    let ro, rh, rl, rc, rts;
    if (renko) { const r = build_renko(ts0, c0, h0, l0, brick); ro = r.open; rh = r.high; rl = r.low; rc = r.close; rts = r.ts; }
    else { ro = o0; rh = h0; rl = l0; rc = c0; rts = ts0; }
    const n = rc.length;
    if (n < 40) return { error: 'only ' + n + ' bars' };
    const t = new Array(n); let prev = 0; for (let i = 0; i < n; i++) { let x = Math.floor(rts[i]); if (x <= prev) x = prev + 1; t[i] = x; prev = x; }

    const se = star_entries(ro, rh, rl, rc, 55), ce = chandelier(rh, rl, rc, +T.CE_LEN, +T.CE_MULT);
    const sw = dominant_swing(rc, +T.SWING_LOOKBACK), pv = find_pivots(rc, +T.PIVOT_K);
    const fibRevs = fib_zone_reversals(rc, pv.ph, pv.pl, sw.L, sw.H, brick, +T.FIB_BAND_FRAC);
    const qual = confluence(se, ce, fibRevs, +T.CONFLUENCE_GAP, +T.FIB_WINDOW);
    const rs = rsi(rc, 14), ew = ewo(rh, rl), ax = adx(rh, rl, rc, 14);

    const series = (v) => { const a = []; for (let i = 0; i < n; i++) if (isFinite(v[i])) a.push({ time: t[i], value: r4(v[i]) }); return a; };
    const bricks = []; for (let i = 0; i < n; i++) bricks.push({ time: t[i], open: r2(ro[i]), high: r2(rh[i]), low: r2(rl[i]), close: r2(rc[i]) });
    const star_markers = [], chand_markers = [], qual_markers = [], robust_markers = [], ewoArr = [];
    for (let i = 0; i < n; i++) {
      if (se.long[i]) star_markers.push({ time: t[i], position: 'belowBar', color: '#26a69a', shape: 'circle', text: 'Buy', size: 1 });
      if (se.short[i]) star_markers.push({ time: t[i], position: 'aboveBar', color: '#ef5350', shape: 'circle', text: 'Sell', size: 1 });
      if (ce.buy[i]) chand_markers.push({ time: t[i], position: 'belowBar', color: '#00e5ff', shape: 'arrowUp', text: 'CE Buy', size: 1 });
      if (ce.sell[i]) chand_markers.push({ time: t[i], position: 'aboveBar', color: '#ff9800', shape: 'arrowDown', text: 'CE Sell', size: 1 });
      ewoArr.push({ time: t[i], value: r4(ew[i]), color: ew[i] >= 0 ? '#26c6da' : '#ab47bc' });
    }
    qual.forEach((s) => { const buy = s.dir === 1; qual_markers.push({ time: t[s.idx], position: buy ? 'belowBar' : 'aboveBar', color: buy ? '#00ff7f' : '#ff1744', shape: buy ? 'arrowUp' : 'arrowDown', text: (buy ? 'BUY ' : 'SELL ') + s.fib_level, size: 2, price: r2(rc[s.idx]), dir: s.dir, fib: s.fib_level, adx: r2(ax[s.idx]) }); });
    // robust DEMA 14/200 cross
    const df = dema(rc, 14), ds = dema(rc, 200); let pd = 0;
    for (let i = 1; i < n; i++) { const rd = Math.sign(df[i] - ds[i]); if (rd !== 0 && rd !== pd) { const buy = rd > 0; robust_markers.push({ time: t[i], position: buy ? 'belowBar' : 'aboveBar', color: buy ? '#ffd54f' : '#b388ff', shape: buy ? 'arrowUp' : 'arrowDown', text: 'DEMA' + (buy ? '▲' : '▼'), size: 1 }); pd = rd; } else if (rd !== 0) pd = rd; }
    const lastDir = ce.dir[n - 1];
    const lsv = ce.dir.map((d, i) => d === 1 ? ce.long_stop[i] : NaN), ssv = ce.dir.map((d, i) => d === -1 ? ce.short_stop[i] : NaN);
    return {
      symbol, interval, brick: r4(brick), chart_type: renko ? 'renko' : 'candles', brick_mode: renko ? 'ATR(14)' : 'candles',
      n_bricks: n, last_close: r2(rc[n - 1]), updated_utc: new Date().toISOString().slice(0, 19) + 'Z',
      trend: lastDir === 1 ? 'LONG' : 'SHORT', bricks,
      mavi: series(se.mavi), kirmizi: series(se.kirmizi), long_stop: series(lsv), short_stop: series(ssv),
      rsi: series(rs), ewo: ewoArr, fib: fib_levels(sw.L, sw.H), swing: { low_t: t[sw.il], high_t: t[sw.ih], L: r2(sw.L), H: r2(sw.H) },
      star_markers, chand_markers, qual_markers, robust_markers, n_qualified: qual.length,
      rsi_bands: { top1: 70, top2: 82, bot1: 30, bot2: 18 },
      tuned: { gap: +T.CONFLUENCE_GAP, window: +T.FIB_WINDOW, pivot_k: +T.PIVOT_K, swing_lb: +T.SWING_LOOKBACK, ce_len: +T.CE_LEN, ce_mult: +T.CE_MULT, robust: true }
    };
  }

  const API = { computePayload, star_entries, chandelier, build_renko, atr, median, TUNED };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.RenkoCompute = API;
})(typeof window !== 'undefined' ? window : globalThis);
