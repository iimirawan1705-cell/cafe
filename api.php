<?php
/* ============================================================
 * CafeBar — Backend sinkron LAN (tanpa database / tanpa akun)
 * Penyimpanan: data/orders.json & data/menu.json (file + lock).
 * Dipakai otomatis oleh db.js bila api.php bisa dijangkau
 * (misal semua HP + PC kasir buka http://192.168.1.31/...).
 * Host statis (GitHub Pages / EdgeOne) tidak menjalankan PHP,
 * di sana aplikasi tetap mode lokal / Firebase.
 * ============================================================ */
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

$DATA_DIR = __DIR__ . '/data';
if (!is_dir($DATA_DIR)) { @mkdir($DATA_DIR, 0777, true); }
$ORDERS_FILE = $DATA_DIR . '/orders.json';
$MENU_FILE   = $DATA_DIR . '/menu.json';

function read_json($file) {
  if (!is_file($file)) return [];
  $fp = @fopen($file, 'r');
  if (!$fp) return [];
  $data = [];
  if (flock($fp, LOCK_SH)) {
    $raw = stream_get_contents($fp);
    flock($fp, LOCK_UN);
    $j = json_decode($raw, true);
    if (is_array($j)) $data = $j;
  }
  fclose($fp);
  return $data;
}
function write_json($file, $data) {
  $fp = @fopen($file, 'c+');
  if (!$fp) return false;
  $ok = false;
  if (flock($fp, LOCK_EX)) {
    ftruncate($fp, 0);
    rewind($fp);
    $ok = (fwrite($fp, json_encode($data, JSON_UNESCAPED_UNICODE)) !== false);
    fflush($fp);
    flock($fp, LOCK_UN);
  }
  fclose($fp);
  return $ok;
}
function by_id($arr) {
  $m = [];
  foreach ((array)$arr as $it) {
    if (isset($it['id'])) $m[(string)$it['id']] = $it;
  }
  return $m;
}

$method = $_SERVER['REQUEST_METHOD'];
$action = isset($_GET['action']) ? $_GET['action'] : '';

if ($method === 'GET' && ($action === '' || $action === 'ping')) {
  echo json_encode(['ok' => true, 'server' => 'cafebar-lan', 'time' => time()]);
  exit;
}
if ($method === 'GET' && $action === 'state') {
  echo json_encode(['ok' => true, 'orders' => array_values(read_json($ORDERS_FILE)), 'menu' => array_values(read_json($MENU_FILE))]);
  exit;
}
if ($method === 'POST') {
  $in = json_decode(file_get_contents('php://input'), true);
  if (!is_array($in)) $in = $_POST;
  $action = isset($in['action']) ? $in['action'] : $action;

  if ($action === 'order_add' && isset($in['order']['id'])) {
    $orders = read_json($ORDERS_FILE);
    $map = by_id($orders);
    $map[(string)$in['order']['id']] = $in['order']; // idempotent (coba ulang aman)
    $list = array_values($map);
    usort($list, function ($a, $b) { return ($b['timestamp'] ?? 0) - ($a['timestamp'] ?? 0); });
    write_json($ORDERS_FILE, $list);
    echo json_encode(['ok' => true, 'orders' => $list]);
    exit;
  }
  if ($action === 'order_status' && isset($in['id'])) {
    $orders = read_json($ORDERS_FILE);
    foreach ($orders as &$o) {
      if ((string)$o['id'] === (string)$in['id']) { $o['status'] = $in['status']; break; }
    }
    unset($o);
    write_json($ORDERS_FILE, array_values($orders));
    echo json_encode(['ok' => true, 'orders' => array_values($orders)]);
    exit;
  }
  if ($action === 'order_delete' && isset($in['id'])) {
    $orders = array_values(array_filter(read_json($ORDERS_FILE), function ($o) use ($in) {
      return (string)$o['id'] !== (string)$in['id'];
    }));
    write_json($ORDERS_FILE, $orders);
    echo json_encode(['ok' => true, 'orders' => $orders]);
    exit;
  }
  if ($action === 'orders_clear') {
    write_json($ORDERS_FILE, []);
    echo json_encode(['ok' => true, 'orders' => []]);
    exit;
  }
  if ($action === 'menu_save' && isset($in['menu']) && is_array($in['menu'])) {
    $menu = array_values($in['menu']);
    write_json($MENU_FILE, $menu);
    echo json_encode(['ok' => true, 'menu' => $menu]);
    exit;
  }
  echo json_encode(['ok' => false, 'error' => 'unknown_action']);
  exit;
}
http_response_code(404);
echo json_encode(['ok' => false, 'error' => 'not_found']);
