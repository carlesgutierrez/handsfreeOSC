/**
 * HandsfreeOSC - WebSocket → UDP/OSC Bridge
 *
 * Receives JSON hand data from the browser via WebSocket,
 * converts each field to an OSC message and forwards as UDP.
 *
 * Configuration via environment variables:
 *   WS_PORT      WebSocket server port   (default: 8080)
 *   OSC_HOST     OSC target hostname     (default: 127.0.0.1)
 *   OSC_PORT     OSC target UDP port     (default: 57120)
 */

const WebSocket = require('ws');
const dgram = require('dgram');

// ── Configuration ─────────────────────────────────────────────────────────────
const WS_PORT  = parseInt(process.env.WS_PORT  || '8080', 10);
const OSC_HOST = process.env.OSC_HOST || '127.0.0.1';
const OSC_PORT = parseInt(process.env.OSC_PORT || '57120', 10);

// ── OSC packet builder (manual, no heavy lib needed for simple floats/ints) ───
function padTo4(buf) {
  const rem = buf.length % 4;
  if (rem === 0) return buf;
  return Buffer.concat([buf, Buffer.alloc(4 - rem)]);
}

function encodeString(str) {
  const buf = Buffer.from(str + '\0', 'ascii');
  return padTo4(buf);
}

/**
 * Build a raw OSC message buffer.
 * @param {string} address  - OSC address e.g. '/hand/thumb/curl'
 * @param {Array}  args     - Array of {type:'f'|'i'|'s', value}
 */
function buildOSCMessage(address, args) {
  const addrBuf = encodeString(address);

  // Type tag string
  const typeTags = ',' + args.map(a => a.type).join('');
  const typeTagBuf = encodeString(typeTags);

  // Arguments
  const argBufs = args.map(({ type, value }) => {
    const b = Buffer.alloc(4);
    if (type === 'f') b.writeFloatBE(value, 0);
    else if (type === 'i') b.writeInt32BE(Math.round(value), 0);
    return b;
  });

  return Buffer.concat([addrBuf, typeTagBuf, ...argBufs]);
}

// ── UDP socket ────────────────────────────────────────────────────────────────
const udp = dgram.createSocket('udp4');

function sendOSC(address, args) {
  const msg = buildOSCMessage(address, args);
  udp.send(msg, 0, msg.length, OSC_PORT, OSC_HOST, (err) => {
    if (err) console.error('UDP send error:', err);
  });
}

// ── Direction enum names (matches fingerpose FingerDirection) ─────────────────
const DIRECTION_NAMES = [
  'VerticalUp',        // 0
  'DiagonalUpRight',   // 1
  'HorizontalRight',   // 2
  'DiagonalDownRight', // 3
  'VerticalDown',      // 4
  'DiagonalDownLeft',  // 5
  'HorizontalLeft',    // 6
  'DiagonalUpLeft',    // 7
];

// ── WebSocket server ──────────────────────────────────────────────────────────
const wss = new WebSocket.Server({ port: WS_PORT });

console.log(`\n┌─────────────────────────────────────────┐`);
console.log(`│  HandsfreeOSC Bridge                    │`);
console.log(`├─────────────────────────────────────────┤`);
console.log(`│  WebSocket  → ws://localhost:${WS_PORT}       │`);
console.log(`│  OSC (UDP)  → ${OSC_HOST}:${OSC_PORT}           │`);
console.log(`└─────────────────────────────────────────┘\n`);

wss.on('connection', (ws, req) => {
  console.log(`[+] Client connected from ${req.socket.remoteAddress}`);

  ws.on('message', (raw) => {
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      console.warn('Invalid JSON received:', e.message);
      return;
    }

    // ── Palm position ────────────────────────────────────────────
    if (data.palm) {
      sendOSC('/hand/palm/position', [
        { type: 'f', value: data.palm.x },
        { type: 'f', value: data.palm.y },
      ]);
    }

    // ── Per-finger data ──────────────────────────────────────────
    const fingers = ['thumb', 'index', 'middle', 'ring', 'pinky'];
    for (const name of fingers) {
      const f = data[name];
      if (!f) continue;

      // Fingertip position
      if (f.tip) {
        sendOSC(`/hand/${name}/tip`, [
          { type: 'f', value: f.tip.x },
          { type: 'f', value: f.tip.y },
        ]);
      }

      // Curl: 0=open, 0.5=half, 1=closed
      if (f.curl !== undefined) {
        sendOSC(`/hand/${name}/curl`, [
          { type: 'f', value: f.curl },
        ]);
      }

      // Direction: integer 0-7
      if (f.direction !== undefined) {
        sendOSC(`/hand/${name}/direction`, [
          { type: 'i', value: f.direction },
        ]);
        // Also log the human name occasionally for debugging
      }
    }

    // Optional verbose logging (uncomment to debug)
    // console.log(JSON.stringify(data, null, 2));
  });

  ws.on('close', () => {
    console.log(`[-] Client disconnected`);
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err.message);
  });
});

wss.on('error', (err) => {
  console.error('Server error:', err.message);
  process.exit(1);
});

process.on('SIGINT', () => {
  console.log('\nShutting down...');
  udp.close();
  wss.close();
  process.exit(0);
});
