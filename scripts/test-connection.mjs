#!/usr/bin/env node
/**
 * Feedback loop script for diagnosing the dshdian connection issue.
 * Simulates the exact connection sequence the plugin performs:
 * 1. Health check via HTTP (like DshProcessManager)
 * 2. Open mux WebSocket (like HarnessClient.openStream)
 * 3. Open host WebSocket (like HarnessClient.openStream)
 * 4. Call host.describe RPC (like HarnessClient.connectionLoop handshake)
 * 
 * Run: node scripts/test-connection.mjs
 * Requires DSH running on port 3180.
 */

import WebSocket from 'ws';
import http from 'http';

const PORT = 3180;
const BASE = `http://127.0.0.1:${PORT}`;
const WS_BASE = `ws://127.0.0.1:${PORT}`;

function rpc(method, payload) {
  const body = JSON.stringify({
    type: 'client-request',
    rpcId: crypto.randomUUID(),
    method,
    payload,
  });
  return new Promise((resolve, reject) => {
    const req = http.request(`${BASE}/api/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error(`Non-JSON response: ${data.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function openWs(path, label) {
  return new Promise((resolve, reject) => {
    const url = `${WS_BASE}${path}`;
    const ws = new WebSocket(url);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error(`${label} timeout`));
    }, 5000);
    ws.on('open', () => {
      clearTimeout(timeout);
      resolve(ws);
    });
    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`${label} error: ${err.code || err.message}`));
    });
  });
}

async function main() {
  console.log('=== dshdian connection diagnostic ===\n');

  // Step 1: Health check
  process.stdout.write('1. Health check (HTTP GET /)... ');
  try {
    await new Promise((resolve, reject) => {
      http.get(`${BASE}/`, (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      }).on('error', reject);
    });
    console.log('✓ OK');
  } catch (e) {
    console.log(`✗ FAIL: ${e.message}`);
    console.log('\n❌ DSH is not running on port 3180. Start it first.');
    process.exit(1);
  }

  // Step 2: Open mux WebSocket
  process.stdout.write('2. Open mux WebSocket... ');
  let muxWs;
  try {
    muxWs = await openWs('/api/events.mux', 'mux');
    console.log('✓ CONNECTED');
  } catch (e) {
    console.log(`✗ FAIL: ${e.message}`);
    process.exit(1);
  }

  // Step 3: Open host WebSocket
  process.stdout.write('3. Open host WebSocket... ');
  let hostWs;
  try {
    hostWs = await openWs('/api/events.host', 'host');
    console.log('✓ CONNECTED');
  } catch (e) {
    console.log(`✗ FAIL: ${e.message}`);
    muxWs.close();
    process.exit(1);
  }

  // Step 4: host.describe RPC
  process.stdout.write('4. RPC host.describe... ');
  try {
    const resp = await rpc('host.describe', {});
    if (resp.result?.ok) {
      console.log('✓ OK');
      console.log(`   Home: ${resp.result.value?.home ?? '(none)'}`);
    } else {
      console.log(`✗ FAIL: ${JSON.stringify(resp.result?.error)}`);
      process.exit(1);
    }
  } catch (e) {
    console.log(`✗ FAIL: ${e.message}`);
    process.exit(1);
  }

  // Step 5: Wait for a mux frame
  process.stdout.write('5. Waiting for first mux frame... ');
  const framePromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('no frame in 3s')), 3000);
    muxWs.on('message', (data) => {
      clearTimeout(timeout);
      resolve(JSON.parse(data.toString()));
    });
  });
  try {
    const frame = await framePromise;
    console.log(`✓ Got frame: ${frame.payload?.type}`);
  } catch (e) {
    console.log(`⚠ ${e.message} (may be normal if no active session)`);
  }

  // Cleanup
  muxWs.close();
  hostWs.close();

  console.log('\n✅ All connection steps passed. The plugin connection logic should work.');
  process.exit(0);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
