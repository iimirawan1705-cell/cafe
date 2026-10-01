/* ============================================================
 * CafeBar — Lapisan realtime (Firebase ↔ localStorage)
 * - Tanpa config Firebase: mode LOKAL (perilaku lama, tetap jalan).
 * - Dengan config valid: mirror dua arah ke Realtime Database,
 *   semua perangkat (HP pelanggan, Admin, Dapur) update otomatis.
 * - Struktur di Firebase:
 *     cafe/orders/{orderId} = object order
 *     cafe/menu/{menuId}    = object menu
 * - Di browser tetap array JSON (kompatibel kode lama).
 * ============================================================ */
(function () {
  'use strict';

  var cfg = (typeof FIREBASE_CONFIG !== 'undefined') ? FIREBASE_CONFIG : null;
  var configured = !!(cfg && cfg.apiKey && !/^GANTI/i.test(cfg.apiKey) && cfg.databaseURL && !/GANTI/i.test(cfg.databaseURL));

  var suppress = false;      // cegah loop tulis-baca
  var pushTimer = null;
  var db = null, ordersRef = null, menuRef = null;

  function isConfigured() { return configured && !!db; }

  function setSyncBadge(mode) {
    try {
      document.querySelectorAll('[data-sync-status]').forEach(function (el) {
        if (mode === 'firebase') {
          el.innerHTML = '<span class="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></span> Realtime: Firebase';
          el.className = el.className.replace(/bg-[a-z-]+\/\d+|bg-[a-z-]+/g, '').trim();
        } else {
          el.textContent = 'Mode lokal (isi Firebase config untuk realtime antar-HP)';
        }
      });
      var b = document.getElementById('syncStatus');
      if (b) {
        if (mode === 'firebase') {
          b.innerHTML = '<span class="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse inline-block"></span> REALTIME';
          b.className = b.className.replace(/bg-red[^"']*|bg-slate[^"']*/g, '');
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

  // Monkey-patch localStorage.setItem agar setiap save lokal ikut ke cloud
  function hookStorage() {
    try {
      var origSet = localStorage.setItem.bind(localStorage);
      localStorage.setItem = function (key, value) {
        origSet(key, value);
        if (!suppress && isConfigured()) {
          if (key === 'cafe_orders') pushOrdersToCloud();
          if (key === 'cafe_menu') pushMenuToCloud();
        }
      };
      var origRemove = localStorage.removeItem.bind(localStorage);
      localStorage.removeItem = function (key) {
        origRemove(key);
        if (!suppress && isConfigured()) {
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

  function init() {
    // Seed menu resmi sekali — berlaku untuk mode lokal maupun Firebase.
    // (menuRef belum ada saat mode lokal; seedRealMenuOnce aman tanpa cloud.)
    try { seedRealMenuOnce(); } catch (e) {}
    if (!configured) { setSyncBadge('local'); return; }
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

  // Expose untuk debug / tombol status
  window.CafeDB = {
    isConfigured: function () { return configured; },
    isLive: isConfigured,
    init: init
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
