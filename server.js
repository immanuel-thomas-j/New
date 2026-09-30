const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push({ name, address: iface.address, url: `http://${iface.address}:${PORT}` });
      }
    }
  }
  return addresses;
}

// Load ws module from project
let WebSocketServer;
try {
  const wsPkg = require(path.join(__dirname, 'Simulation - Copy', 'project', 'node_modules', 'ws'));
  WebSocketServer = wsPkg.WebSocketServer || wsPkg.Server;
} catch (e) {
  try {
    WebSocketServer = require('ws').WebSocketServer || require('ws').Server;
  } catch (err) {
    console.error('WebSocket module load error:', err);
  }
}

const PORT = process.env.PORT || 8080;
const ROOT_DIR = path.join(__dirname, 'Guard-PWA');
const BASE_DIR = __dirname;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

// In-Memory Shared State
let lastTelemetry = {
  depth: 12.4,
  initial: 12.0,
  ambient: 26.8,
  object: 33.5,
  status: 'NORMAL',
  timestamp: new Date().toISOString()
};
let lastDistress = null;
const sseClients = new Set();
let wss = null;

function broadcastState(type, payload, senderWs = null) {
  const msgObj = { type, payload, timestamp: Date.now() };
  const rawJson = JSON.stringify(msgObj);

  // 1. Broadcast to WebSocket clients
  if (wss) {
    wss.clients.forEach((client) => {
      if (client !== senderWs && client.readyState === 1) {
        try { client.send(rawJson); } catch (_) {}
      }
    });
  }

  // 2. Broadcast to Server-Sent Events (SSE) mobile clients
  sseClients.forEach((res) => {
    try {
      res.write(`data: ${rawJson}\n\n`);
    } catch (_) {
      sseClients.delete(res);
    }
  });
}

// Create HTTP Server with API & Static Files
const server = http.createServer((req, res) => {
  // Global CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const parsedUrl = req.url.split('?')[0];

  // ───────── API ENDPOINTS ─────────

  // 1. GET /api/telemetry (Instant state snapshot)
  if (req.method === 'GET' && parsedUrl === '/api/telemetry') {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    });
    res.end(JSON.stringify({
      telemetry: lastTelemetry,
      distress: lastDistress,
      serverTime: Date.now()
    }));
    return;
  }

  // 2. GET /api/events (Server-Sent Events fallback for mobile)
  if (req.method === 'GET' && parsedUrl === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Connection': 'keep-alive'
    });
    res.write(`data: ${JSON.stringify({ type: 'INIT', telemetry: lastTelemetry, distress: lastDistress })}\n\n`);
    sseClients.add(res);

    req.on('close', () => {
      sseClients.delete(res);
    });
    return;
  }

  // 3. POST /api/telemetry (Push telemetry from console)
  if (req.method === 'POST' && parsedUrl === '/api/telemetry') {
    let body = '';
    req.on('data', (chunk) => body += chunk);
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        lastTelemetry = Object.assign(lastTelemetry, payload);
        lastTelemetry.timestamp = new Date().toISOString();
        broadcastState('AMSRS_TELEMETRY', lastTelemetry);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  // 4. POST /api/rescue (Trigger emergency dispatch)
  if (req.method === 'POST' && parsedUrl === '/api/rescue') {
    let body = '';
    req.on('data', (chunk) => body += chunk);
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        lastDistress = payload;
        broadcastState('AMSRS_RESCUE', lastDistress);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  // 5. POST /api/guard_ack / POST /api/standdown
  if (req.method === 'POST' && (parsedUrl === '/api/guard_ack' || parsedUrl === '/api/standdown')) {
    let body = '';
    req.on('data', (chunk) => body += chunk);
    req.on('end', () => {
      if (parsedUrl === '/api/standdown') lastDistress = null;
      broadcastState(parsedUrl === '/api/guard_ack' ? 'GUARD_ACK' : 'GUARD_STANDDOWN', {});
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    });
    return;
  }

  // 6. GET /api/network (Get list of active LAN IP addresses & QR info)
  if (req.method === 'GET' && parsedUrl === '/api/network') {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-cache'
    });
    res.end(JSON.stringify({
      port: PORT,
      ips: getLocalIpAddresses()
    }));
    return;
  }

  // ───────── STATIC FILE SERVING ─────────
  let reqPath = decodeURIComponent(parsedUrl);
  let filePath = '';

  if (reqPath === '/console' || reqPath === '/amsrs-console-v2.html') {
    filePath = path.join(BASE_DIR, 'amsrs-console-v2.html');
  } else {
    if (reqPath === '/') reqPath = '/index.html';
    filePath = path.join(ROOT_DIR, reqPath);
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      const altPath = path.join(BASE_DIR, reqPath);
      fs.stat(altPath, (err2, stats2) => {
        if (!err2 && stats2.isFile()) {
          serveFile(altPath, res);
        } else {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('404 Not Found');
        }
      });
      return;
    }
    serveFile(filePath, res);
  });
});

function serveFile(filePath, res) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('500 Server Error');
      return;
    }

    // Force no-cache on HTML/JS/CSS to prevent stale mobile cache
    const isCode = ext === '.html' || ext === '.js' || ext === '.css' || ext === '.json';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': isCode ? 'no-cache, no-store, must-revalidate' : 'public, max-age=3600'
    });
    res.end(content);
  });
}

// ───────── WEBSOCKET SERVER ─────────
if (WebSocketServer) {
  wss = new WebSocketServer({ server });

  wss.on('connection', (ws, req) => {
    const clientIp = req.socket.remoteAddress;
    console.log(`[WS] Client connected from ${clientIp} (Total clients: ${wss.clients.size})`);

    // Immediately send current live state to new connection
    if (lastTelemetry) {
      try { ws.send(JSON.stringify({ type: 'AMSRS_TELEMETRY', payload: lastTelemetry })); } catch (_) {}
    }
    if (lastDistress) {
      try { ws.send(JSON.stringify({ type: 'AMSRS_RESCUE', payload: lastDistress })); } catch (_) {}
    }

    ws.on('message', (message) => {
      try {
        const rawStr = message.toString();
        const data = JSON.parse(rawStr);

        if (data.type === 'AMSRS_TELEMETRY') {
          lastTelemetry = Object.assign(lastTelemetry, data.payload || {});
          broadcastState('AMSRS_TELEMETRY', lastTelemetry, ws);
        } else if (data.type === 'AMSRS_RESCUE') {
          lastDistress = data.payload || {};
          broadcastState('AMSRS_RESCUE', lastDistress, ws);
        } else if (data.type === 'GUARD_STANDDOWN') {
          lastDistress = null;
          broadcastState('GUARD_STANDDOWN', {}, ws);
        } else if (data.type === 'GUARD_ACK') {
          broadcastState('GUARD_ACK', data.payload || {}, ws);
        }
      } catch (e) {
        console.error('[WS] Parse error:', e.message);
      }
    });

    ws.on('close', () => {
      console.log(`[WS] Client disconnected (Remaining: ${wss.clients.size})`);
    });

    ws.on('error', (err) => {
      console.warn('[WS] Socket error:', err.message);
    });
  });

  console.log('[WS] Real-Time WebSocket Relay initialized on port ' + PORT);
}

server.listen(PORT, '0.0.0.0', () => {
  const ips = getLocalIpAddresses();
  console.log(`=======================================================`);
  console.log(` AMSRS REAL-TIME RELAY & COASTAL SYSTEM ACTIVE`);
  console.log(` Desktop Console:   http://localhost:${PORT}/console`);
  console.log(` Local Guard PWA:   http://localhost:${PORT}`);
  if (ips.length > 0) {
    console.log(` Mobile Guard URLs on LAN:`);
    ips.forEach((ip) => {
      console.log(`    http://${ip.address}:${PORT} (${ip.name})`);
    });
  } else {
    console.log(` Mobile Guard: Connect to Wi-Fi or Hotspot to get LAN URL`);
  }
  console.log(`=======================================================`);
});
