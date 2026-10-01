/* ============================================================
 * CafeBar — Lapisan realtime (Server LAN → Firebase → Lokal)
 * Prioritas sinkronisasi:
 *  1. SERVER (api.php terjangkau — XAMPP di PC kasir, semua HP
 *     + admin buka http://IP-PC/... ): polling 2,5 dtk + POST.
 *     TANPA akun / tanpa konfigurasi apa pun.
 *  2. FIREBASE (config valid di firebase-config.js): mirror dua
 *     arah ke Realtime Database — untuk hosting statis.
 *  3. LOKAL (tidak ada server & Firebase): antar-tab 1 browser.
 * - Di browser tetap array JSON (kompatibel kode lama).
 * ============================================================ */
(function () {
  'use strict';

  var cfg = (typeof FIREBASE_CONFIG !== 'undefined') ? FIREBASE_CONFIG : null;
  var configured = !!(cfg && cfg.apiKey && !/^GANTI/i.test(cfg.apiKey) && cfg.databaseURL && !/GANTI/i.test(cfg.databaseURL));

  var suppress = false;      // cegah loop tulis-baca
  var pushTimer = null;
  var db = null, ordersRef = null, menuRef = null;
  var serverMode = false, serverTimer = null, serverBusy = false;
  var hooked = false;
  var serverSnapshot = { orders: '[]', menu: '[]' };

  function isFirebaseLive() { return configured && !!db; }
  function isLive() { return serverMode || isFirebaseLive(); }
  function isConfigured() { return isLive(); }

  function setSyncBadge(mode) {
    try {
      var warn = document.getElementById('localModeWarn');
      if (warn) warn.classList.toggle('hidden', mode !== 'local');
      document.querySelectorAll('[data-sync-status]').forEach(function (el) {
        if (mode === 'server') {
          el.innerHTML = '<span class="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></span> Realtime: Server';
        } else if (mode === 'firebase') {
          el.innerHTML = '<span class="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></span> Realtime: Firebase';
        } else {
          el.textContent = 'Mode lokal — order HP tidak tersinkron';
        }
      });
      var b = document.getElementById('syncStatus');
      if (b) {
        if (mode !== 'local') {
          b.innerHTML = '<span class="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse inline-block"></span> REALTIME';
        } else {
          b.textContent = 'LOKAL';
        }
      }
    } catch (e) {}
  }

  function notifyChanged(key) {
    try {
      // Beri tahu tab lain di perangkat yang sama
      if (typeof BroadcastChannel !== 'undefined') {
        new BroadcastChannel('cafe').postMessage({ type: 'sync', key: key });
      }
    } catch (e) {}
    try {
      window.dispatchEvent(new CustomEvent('cafe-sync', { detail: { key: key } }));
    } catch (e) {}
    // Panggil ulang render yang dikenal (tanpa error jika tidak ada)
    ['render', 'renderHistory', 'renderMenu', 'renderMyOrders', 'refreshStats'].forEach(function (fn) {
      try { if (typeof window[fn] === 'function') window[fn](); } catch (e) {}
    });
  }

  function arrToMap(arr, keyField) {
    var map = {};
    (arr || []).forEach(function (item) {
      var k = String(item[keyField || 'id']);
      map[k] = item;
    });
    return map;
  }

  function mapToOrders(map) {
    var arr = Object.keys(map || {}).map(function (k) { return map[k]; });
    arr.sort(function (a, b) { return (b.timestamp || 0) - (a.timestamp || 0); });
    return arr;
  }

  function mapToMenu(map) {
    var arr = Object.keys(map || {}).map(function (k) { return map[k]; });
    // menu: terbaru di depan (id desc), fallback nama
    arr.sort(function (a, b) { return (b.id || 0) - (a.id || 0); });
    return arr;
  }

  function pushOrdersToCloud() {
    if (!isConfigured()) return;
    try {
      var arr = JSON.parse(localStorage.getItem('cafe_orders') || '[]');
      clearTimeout(pushTimer);
      pushTimer = setTimeout(function () {
        try { ordersRef.set(arrToMap(arr, 'id')); } catch (e) {}
      }, 400);
    } catch (e) {}
  }

  function pushMenuToCloud() {
    if (!isConfigured()) return;
    try {
      var arr = JSON.parse(localStorage.getItem('cafe_menu') || '[]');
      clearTimeout(pushTimer);
      pushTimer = setTimeout(function () {
        try { menuRef.set(arrToMap(arr, 'id')); } catch (e) {}
      }, 400);
    } catch (e) {}
  }

  // Menu resmi cafe (12 item). Di-seed SEKALI ke perangkat yang
  // belum pernah punya menu — tetap bisa diubah via Admin.
  var MENU_SEED_KEY = 'cafe_menu_seed_v1';
  var REAL_MENU = [
    {id:1, name:"Kopi Susu Gula Aren", price:25000, cat:"kopi", img:"https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=400", desc:"Espresso + susu + gula aren legit"},
    {id:2, name:"Americano", price:22000, cat:"kopi", img:"https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=400", desc:"Hot / Ice"},
    {id:3, name:"Cappuccino", price:28000, cat:"kopi", img:"https://images.unsplash.com/photo-1572442388796-11668a67e53d?w=400", desc:"Foam creamy"},
    {id:4, name:"Matcha Latte", price:30000, cat:"nonkopi", img:"https://images.unsplash.com/photo-1515825838458-f2a94b20105a?w=400", desc:"Premium matcha Jepang"},
    {id:5, name:"Lychee Tea", price:24000, cat:"nonkopi", img:"https://images.unsplash.com/photo-1544148103-005eec06c04d?w=400", desc:"Teh lychee segar"},
    {id:6, name:"Chocolate Ice", price:26000, cat:"nonkopi", img:"https://images.unsplash.com/photo-1579954115545-a95591f99d71?w=400", desc:"Coklat premium"},
    {id:7, name:"Nasi Goreng Special", price:35000, cat:"makanan", img:"https://images.unsplash.com/photo-1603133872875-ca2a98a0a862?w=400", desc:"Telur + ayam + kerupuk"},
    {id:8, name:"Chicken Katsu Curry", price:42000, cat:"makanan", img:"https://images.unsplash.com/photo-1565557623262-b51c2513a641?w=400", desc:"Katsu + curry Jepang"},
    {id:9, name:"Mie Goreng Aceh", price:33000, cat:"makanan", img:"https://images.unsplash.com/photo-1612874742237-6526221588d2?w=400", desc:"Pedas mantap"},
    {id:10, name:"Kentang Goreng", price:18000, cat:"snack", img:"https://images.unsplash.com/photo-1573080496219-bb080dd4f877?w=400", desc:"200gr + saus"},
    {id:11, name:"Roti Bakar Coklat Keju", price:22000, cat:"snack", img:"https://images.unsplash.com/photo-1509440159596-0249088772ff?w=400", desc:"Lumer di mulut"},
    {id:12, name:"Croissant Butter", price:20000, cat:"snack", img:"https://images.unsplash.com/photo-1556911220-e15b29be8c8f?w=400", desc:"Fresh bake"}
  ];
  function rawSet(key, value) {
    try { Storage.prototype.setItem.call(localStorage, key, value); }
    catch (e) { try { localStorage.setItem(key, value); } catch (e2) {} }
  }
  function seedRealMenuOnce() {
    try {
      if (localStorage.getItem(MENU_SEED_KEY)) return;
      var cur = null;
      try { cur = JSON.parse(localStorage.getItem('cafe_menu') || 'null'); } catch (e) { cur = null; }
      if (!cur || !cur.length) {
        suppress = true;
        rawSet('cafe_menu', JSON.stringify(REAL_MENU));
        suppress = false;
        if (isConfigured() && menuRef) { try { menuRef.set(arrToMap(REAL_MENU, 'id')); } catch (e) {} }
        notifyChanged('cafe_menu');
      }
      rawSet(MENU_SEED_KEY, '1');
    } catch (e) {}
  }

  // ---- Backend server LAN (api.php) ----
  function apiPost(payload) {
    return fetch('api.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then(function (r) { return r.json(); });
  }
  function detectServer(cb) {
    try {
      if (typeof fetch === 'undefined') return cb(false);
      var ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var done = false;
      var t = setTimeout(function () { if (!done) { done = true; try { ctl && ctl.abort(); } catch (e) {} cb(false); } }, 4000);
      fetch('api.php?action=ping', { cache: 'no-store', signal: ctl ? ctl.signal : undefined })
        .then(function (r) { return r.json(); })
        .then(function (j) { if (!done) { done = true; clearTimeout(t); cb(!!(j && j.ok)); } })
        .catch(function () { if (!done) { done = true; clearTimeout(t); cb(false); } });
    } catch (e) { cb(false); }
  }
  function snapshotLocal() {
    try {
      serverSnapshot.orders = localStorage.getItem('cafe_orders') || '[]';
      serverSnapshot.menu = localStorage.getItem('cafe_menu') || '[]';
    } catch (e) {}
  }
  function scheduleServerPush() {
    clearTimeout(serverTimer);
    serverTimer = setTimeout(reconcileUp, 500);
  }
  function reconcileUp() {
    if (!serverMode || serverBusy) return;
    serverBusy = true;
    var chain = Promise.resolve();
    try {
      var localO = JSON.parse(localStorage.getItem('cafe_orders') || '[]');
      var snapO = JSON.parse(serverSnapshot.orders || '[]');
      var snapMap = {};
      snapO.forEach(function (o) { snapMap[String(o.id)] = o; });
      var seen = {};
      localO.forEach(function (o) {
        seen[String(o.id)] = 1;
        var s = snapMap[String(o.id)];
        if (!s || JSON.stringify(s) !== JSON.stringify(o)) {
          chain = chain.then(function () { return apiPost({ action: 'order_add', order: o }); }).catch(function () {});
        }
      });
      snapO.forEach(function (s) {
        if (!seen[String(s.id)]) {
          chain = chain.then(function () { return apiPost({ action: 'order_delete', id: s.id }); }).catch(function () {});
        }
      });
      var localM = localStorage.getItem('cafe_menu') || '[]';
      if (localM !== serverSnapshot.menu) {
        chain = chain.then(function () { return apiPost({ action: 'menu_save', menu: JSON.parse(localM) }); }).catch(function () {});
      }
    } catch (e) {}
    chain.then(function () { snapshotLocal(); serverBusy = false; });
  }
  function pollServer() {
    if (!serverMode || serverBusy) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    fetch('api.php?action=state', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (st) {
        if (!st || !st.ok) return;
        var srvO = JSON.stringify(st.orders || []), srvM = JSON.stringify(st.menu || []);
        if (srvO !== (localStorage.getItem('cafe_orders') || '[]')) {
          suppress = true; rawSet('cafe_orders', srvO); suppress = false;
          notifyChanged('cafe_orders');
        }
        if (srvM !== (localStorage.getItem('cafe_menu') || '[]')) {
          suppress = true; rawSet('cafe_menu', srvM); suppress = false;
          notifyChanged('cafe_menu');
        }
        snapshotLocal();
      })
      .catch(function () {});
  }
  function initServerMode() {
    hookStorage();
    snapshotLocal();
    // Sinkron awal: server ada isi → pakai server; server kosong → dorong lokal (termasuk seed 12 menu)
    fetch('api.php?action=state', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (st) {
        var srvO = JSON.stringify((st && st.orders) || []), srvM = JSON.stringify((st && st.menu) || []);
        var locO = localStorage.getItem('cafe_orders') || '[]', locM = localStorage.getItem('cafe_menu') || '[]';
        if (srvO !== '[]') { suppress = true; rawSet('cafe_orders', srvO); suppress = false; notifyChanged('cafe_orders'); }
        if (srvM !== '[]') { suppress = true; rawSet('cafe_menu', srvM); suppress = false; notifyChanged('cafe_menu'); }
        snapshotLocal();
        if (srvO === '[]' || srvM === '[]') { if (locO !== '[]' || locM !== '[]') scheduleServerPush(); }
      })
      .catch(function () {});
    setInterval(pollServer, 2500);
  }

  // Monkey-patch: setiap save lokal diteruskan ke Server LAN dan/atau Firebase
  function routePush(key) {
    if (suppress) return;
    if (serverMode) {
      if (key === 'cafe_orders' || key === 'cafe_menu') scheduleServerPush();
    } else if (isFirebaseLive()) {
      if (key === 'cafe_orders') pushOrdersToCloud();
      if (key === 'cafe_menu') pushMenuToCloud();
    }
  }
  function hookStorage() {
    if (hooked) return;
    hooked = true;
    try {
      var origSet = localStorage.setItem.bind(localStorage);
      localStorage.setItem = function (key, value) {
        origSet(key, value);
        routePush(key);
      };
      var origRemove = localStorage.removeItem.bind(localStorage);
      localStorage.removeItem = function (key) {
        origRemove(key);
        if (suppress) return;
        if (serverMode) {
          if (key === 'cafe_orders') apiPost({ action: 'orders_clear' }).catch(function () {});
          if (key === 'cafe_menu') apiPost({ action: 'menu_save', menu: [] }).catch(function () {});
        } else if (isFirebaseLive()) {
          if (key === 'cafe_orders') { try { ordersRef.set({}); } catch (e) {} }
          if (key === 'cafe_menu') { try { menuRef.set({}); } catch (e) {} }
        }
      };
    } catch (e) {}
  }

  function pullInitialThenListen() {
    // Orders
    ordersRef.on('value', function (snap) {
      try {
        var arr = mapToOrders(snap.val() || {});
        var local = localStorage.getItem('cafe_orders');
        var localArr = []; try { localArr = JSON.parse(local || '[]'); } catch (e) {}
        if (!arr.length && localArr.length) { pushOrdersToCloud(); return; } // cloud kosong → dorong lokal
        if (JSON.stringify(arr) !== local) {
          suppress = true;
          rawSet('cafe_orders', JSON.stringify(arr));
          suppress = false;
          notifyChanged('cafe_orders');
        } else if (suppress) { suppress = false; }
      } catch (e) {}
    });
    // Menu
    menuRef.on('value', function (snap) {
      try {
        var arr = mapToMenu(snap.val() || {});
        var local = localStorage.getItem('cafe_menu');
        var localArr = []; try { localArr = JSON.parse(local || '[]'); } catch (e) {}
        if (!arr.length && localArr.length) { pushMenuToCloud(); return; } // cloud kosong → dorong lokal
        if (JSON.stringify(arr) !== local) {
          suppress = true;
          rawSet('cafe_menu', JSON.stringify(arr));
          suppress = false;
          notifyChanged('cafe_menu');
        } else if (suppress) { suppress = false; }
      } catch (e) {}
    });
  }

  function initFirebase() {
    // Dipanggil hanya bila mode Server LAN tidak tersedia.
    try {
      if (typeof firebase === 'undefined') { setSyncBadge('local'); return; }
      if (!firebase.apps || !firebase.apps.length) firebase.initializeApp(cfg);
      db = firebase.database();
      ordersRef = db.ref('cafe/orders');
      menuRef = db.ref('cafe/menu');
      hookStorage();
      try { seedRealMenuOnce(); } catch (e) {}
      pullInitialThenListen();
      // Jika cloud kosong tapi lokal ada → dorong lokal ke cloud (first writer)
      setTimeout(function () {
        try {
          ordersRef.once('value', function (s) {
            if (!s.exists()) {
              var l = localStorage.getItem('cafe_orders');
              if (l && l !== '[]') pushOrdersToCloud();
            }
          });
          menuRef.once('value', function (s) {
            if (!s.exists()) {
              var l = localStorage.getItem('cafe_menu');
              if (l && l !== '[]') pushMenuToCloud();
            }
          });
        } catch (e) {}
      }, 1500);
      setSyncBadge('firebase');
    } catch (e) {
      setSyncBadge('local');
    }
  }

  function init() {
    try { seedRealMenuOnce(); } catch (e) {}
    setSyncBadge('local');
    // Prioritas 1: Server LAN (api.php) — tanpa akun apa pun.
    detectServer(function (found) {
      if (found) {
        serverMode = true;
        try { initServerMode(); } catch (e) { serverMode = false; setSyncBadge('local'); return; }
        setSyncBadge('server');
        return;
      }
      // Prioritas 2: Firebase (hosting statis).
      if (!configured) { setSyncBadge('local'); return; }
      initFirebase();
    });
  }

  // Expose untuk debug / tombol status
  window.CafeDB = {
    isConfigured: function () { return isLive(); },
    isLive: isLive,
    init: init
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
