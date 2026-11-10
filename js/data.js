/* ============================================================
   RAILMET demo data: rake history + simulated MQTT wagon stream.
   Replace RMData.* with calls to your API / MQTT client.
   ============================================================ */
(function (global) {
  'use strict';
  const KEY = 'rm_rakes';

  // deterministic PRNG so seeded demo data is stable
  function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
  const r2 = v => Math.round(v * 100) / 100;

  function makeWagon(rand, loaded) {
    const base = loaded ? 10.6 + rand() * 1.8 : 2.7 + rand() * 0.5;   // tonnes per wheel
    const lh = [], rh = [];
    for (let i = 0; i < 4; i++) {
      const skew = (rand() - 0.5) * (loaded ? 0.9 : 0.2);
      lh.push(r2(base + skew / 2 + (rand() - 0.5) * 0.2));
      rh.push(r2(base - skew / 2 + (rand() - 0.5) * 0.2));
    }
    return { speed: Math.round((11.5 + rand() * 1.2) * 10) / 10, lh, rh };
  }

  function makeRake(no, seed, when) {
    const rand = rng(seed);
    const count = 40 + Math.floor(rand() * 20);
    const loaded = rand() > 0.3;
    const wagons = [];
    for (let i = 0; i < count; i++) wagons.push(makeWagon(rand, loaded));
    const inAt = new Date(when);
    const outAt = new Date(inAt.getTime() + (8 + rand() * 6) * 3600e3);
    const stations = ['UBL', 'SBC', 'MYS', 'DWR', 'HPT', 'GDG', 'BAY', 'YPR'];
    return {
      rakeNo: no,
      source: stations[Math.floor(rand() * stations.length)],
      destination: stations[Math.floor(rand() * stations.length)],
      direction: rand() > 0.5 ? 'IN' : 'OUT',
      wagonType: 'BOXN',
      inAt: inAt.toISOString(), outAt: outAt.toISOString(),
      wagons,
    };
  }

  function seed() {
    const nums = ['001', '002', '003', '004', '007', '008', '009', '010', '011', '012', '013', '014'];
    const start = Date.now() - nums.length * 4 * 86400e3;
    return nums.map((n, i) => makeRake(n, 97 + i * 31, start + i * 4 * 86400e3 + 17 * 3600e3));
  }

  function all() {
    let v = null;
    try { v = JSON.parse(localStorage.getItem(KEY)); } catch { }
    if (!v) { v = seed(); localStorage.setItem(KEY, JSON.stringify(v)); }
    return v;
  }
  const saveAll = v => localStorage.setItem(KEY, JSON.stringify(v));
  const get = no => all().find(r => r.rakeNo === no);
  function add(rake) { const v = all().filter(r => r.rakeNo !== rake.rakeNo); v.push(rake); saveAll(v); }
  function nextRakeNo() {
    const max = all().reduce((m, r) => Math.max(m, parseInt(r.rakeNo, 10) || 0), 0);
    return String(max + 1).padStart(3, '0');
  }

  /* Derived columns used by the grid, reports and PDF */
  function calc(w) {
    const s = a => a.reduce((x, y) => x + y, 0);
    const front = w.lh[0] + w.rh[0] + w.lh[1] + w.rh[1];
    const rear = w.lh[2] + w.rh[2] + w.lh[3] + w.rh[3];
    return {
      front, rear, gross: front + rear,
      diff: w.lh.map((l, i) => l - w.rh[i]),
      bogie1: (w.lh[0] + w.lh[1]) - (w.rh[0] + w.rh[1]),
      bogie2: (w.lh[2] + w.lh[3]) - (w.rh[2] + w.rh[3]),
      wagon: s(w.lh) - s(w.rh),
    };
  }

  /* ---------- Simulated MQTT link ---------- */
  const SETTINGS_KEY = 'rm_settings';
  const DEFAULT_SETTINGS = { brokerHost: 'mqtt.febinoo.com', deviceId: '6010419531', logging: false };
  function settings() {
    let s = null; try { s = JSON.parse(localStorage.getItem(SETTINGS_KEY)); } catch { }
    return { ...DEFAULT_SETTINGS, ...(s || {}) };
  }
  const saveSettings = s => localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...settings(), ...s }));

  const pad = n => String(n).padStart(2, '0');
  const hms = d => pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  const toHex = str => Array.from(new TextEncoder().encode(str)).map(b => b.toString(16).toUpperCase().padStart(2, '0')).join('');

  /** Push one simulated message; returns the diagnostics snapshot. */
  function mqttTick(type, extra) {
    const s = settings();
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().replace('Z', '');
    const msg = JSON.stringify({ device_id: s.deviceId, timestamp: local, is_indicator_active: !!(extra && extra.active), message_type: type || 'beat', message: type === 'wagon' ? 'wagon_data' : 'heartbeat', ...(extra && extra.payload ? { data: extra.payload } : {}) })
      .replace(/":/g, '": ').replace(/,"/g, ', "');
    const count = (parseInt(localStorage.getItem('rm_mqtt_count'), 10) || 0) + 1;
    localStorage.setItem('rm_mqtt_count', count);
    const diag = { count, last: '[' + hms(now) + '] ' + msg, hex: '[' + hms(now) + '] ' + toHex(msg) };
    localStorage.setItem('rm_mqtt_last', JSON.stringify(diag));
    if (s.logging) {
      const log = JSON.parse(localStorage.getItem('rm_mqtt_log') || '[]');
      log.push(diag.last); if (log.length > 500) log.shift();
      localStorage.setItem('rm_mqtt_log', JSON.stringify(log));
    }
    return diag;
  }
  function mqttDiag() {
    try { return JSON.parse(localStorage.getItem('rm_mqtt_last')) || mqttTick(); } catch { return mqttTick(); }
  }
  const trunc = (s, n) => s.length > n ? s.slice(0, n) + '...' : s;

  global.RMData = { all, get, add, nextRakeNo, calc, makeWagon, rng, settings, saveSettings, mqttTick, mqttDiag, trunc };
})(window);
