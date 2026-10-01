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
        if (JSON.stringify(arr) !== local) {
          suppress = true;
          try { Storage.prototype.setItem.call(localStorage, 'cafe_orders', JSON.stringify(arr)); }
          catch (e) { localStorage.setItem('cafe_orders', JSON.stringify(arr)); }
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
        if (JSON.stringify(arr) !== local) {
          suppress = true;
          try { Storage.prototype.setItem.call(localStorage, 'cafe_menu', JSON.stringify(arr)); }
          catch (e) {}
          suppress = false;
          notifyChanged('cafe_menu');
        } else if (suppress) { suppress = false; }
      } catch (e) {}
    });
  }

  function init() {
    if (!configured) { setSyncBadge('local'); return; }
    try {
      if (typeof firebase === 'undefined') { setSyncBadge('local'); return; }
      if (!firebase.apps || !firebase.apps.length) firebase.initializeApp(cfg);
      db = firebase.database();
      ordersRef = db.ref('cafe/orders');
      menuRef = db.ref('cafe/menu');
      hookStorage();
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
