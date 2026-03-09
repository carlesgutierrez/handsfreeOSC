/**
 * app.js
 * HandsfreeOSC - Logic, WebSocket, Hand Processing and UI Management
 */

// ── Constants & Config ───────────────────────────────────────────────────────
const DIRECTION_NAMES = [
  'VerticalUp', 'DiagonalUpRight', 'HorizontalRight', 'DiagonalDownRight',
  'VerticalDown', 'DiagonalDownLeft', 'HorizontalLeft', 'DiagonalUpLeft',
];

const CURL_VAL = { 'No Curl': 0, 'Half Curl': 0.5, 'Full Curl': 1 };

const LANDMARKS = { palm: 0, thumb: 4, index: 8, middle: 12, ring: 16, pinky: 20 };

const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],       // Thumb
  [0, 5], [5, 6], [6, 7], [7, 8],       // Index
  [5, 9], [9, 10], [10, 11], [11, 12],  // Middle
  [9, 13], [13, 14], [14, 15], [15, 16], // Ring
  [13, 17], [17, 18], [18, 19], [19, 20], // Pinky
  [0, 17] 
];

window.LANDMARKS = LANDMARKS;
window.HAND_CONNECTIONS = HAND_CONNECTIONS;
window.CURL_VAL = CURL_VAL;
window.DIRECTION_NAMES = DIRECTION_NAMES;

const OSC_ROWS = [
  { id: 'palm-pos',     addr: '/hand/palm/position' },
  { id: 'thumb-tip',    addr: '/hand/thumb/tip' },
  { id: 'thumb-curl',   addr: '/hand/thumb/curl' },
  { id: 'thumb-dir',    addr: '/hand/thumb/direction' },
  { id: 'index-tip',    addr: '/hand/index/tip' },
  { id: 'index-curl',   addr: '/hand/index/curl' },
  { id: 'index-dir',    addr: '/hand/index/direction' },
  { id: 'middle-tip',   addr: '/hand/middle/tip' },
  { id: 'middle-curl',  addr: '/hand/middle/curl' },
  { id: 'middle-dir',   addr: '/hand/middle/direction' },
  { id: 'ring-tip',     addr: '/hand/ring/tip' },
  { id: 'ring-curl',    addr: '/hand/ring/curl' },
  { id: 'ring-dir',     addr: '/hand/ring/direction' },
  { id: 'pinky-tip',    addr: '/hand/pinky/tip' },
  { id: 'pinky-curl',   addr: '/hand/pinky/curl' },
  { id: 'pinky-dir',    addr: '/hand/pinky/direction' },
];

// ── State ────────────────────────────────────────────────────────────────────
let handsfree = null;
let gestureEstimator = null;
let ws = null;
window.isTracking = false;
let lastSendTime = 0;
let sendInterval = 1000 / 30; 
let fpsTs = performance.now();
let fpsCount = 0;

window.currentHandData = null;
window.currentPoseData = null;

// DOM Elements (assigned in init)
let btnStart, btnStop, statusBadge, statusText, fpsBadge, logStrip, fpsSlider, fpsSliderVal, checkAutoFps, btnFullscreen, btnToggleOsc, selectRes, checkSmoothing, oscTableContainer;

let isOscHidden = false;
window.isSmoothing = true;
let lastSmoothHand = null;
const SMOOTH_FACTOR = 0.5; // Balances smoothness and responsiveness
window.trackingFps = 0;
let trackFpsCount = 0;
let trackFpsTs = performance.now();

// ── Initialization ───────────────────────────────────────────────────────────
function init() {
  // Bind Elements
  btnStart    = document.getElementById('btn-start');
  btnStop     = document.getElementById('btn-stop');
  statusText  = document.getElementById('status-text');
  fpsBadge    = document.getElementById('fps-badge');
  logStrip    = document.getElementById('log-text');
  fpsSlider   = document.getElementById('fps-slider');
  fpsSliderVal= document.getElementById('fps-slider-val');
  checkAutoFps = document.getElementById('check-autofps');
  btnFullscreen= document.getElementById('btn-fullscreen');
  btnToggleUi  = document.getElementById('btn-toggle-ui');
  btnToggleOsc = document.getElementById('btn-toggle-osc');
  selectRes    = document.getElementById('select-resolution');
  checkSmoothing=document.getElementById('check-smoothing');
  oscTableContainer = document.getElementById('osc-table');

  buildOSCTable();
  if (logStrip) logStrip.textContent = 'Ready.';
  
  fpsSlider.addEventListener('input', () => {
    const v = parseInt(fpsSlider.value, 10);
    fpsSliderVal.textContent = v;
    sendInterval = 1000 / v;
  });

  btnStart.addEventListener('click', startTracking);
  btnStop.addEventListener('click', stopTracking);
  
  btnToggleOsc.addEventListener('click', () => {
    isOscHidden = !isOscHidden;
    oscTableContainer.classList.toggle('hidden', isOscHidden);
    btnToggleOsc.textContent = isOscHidden ? 'Show Table' : 'Hide Table';
    document.querySelectorAll('.osc-group').forEach(el => el.classList.toggle('hidden', isOscHidden));
  });

  btnFullscreen.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(err => {
        if (logStrip) logStrip.textContent = `Error: ${err.message}`;
      });
    } else {
      document.exitFullscreen();
    }
  });

  if (checkSmoothing) {
    checkSmoothing.addEventListener('change', () => {
      window.isSmoothing = checkSmoothing.checked;
    });
  }

  if (selectRes) {
    selectRes.addEventListener('change', () => {
      if (window.isTracking) {
        if (logStrip) logStrip.textContent = 'Changing resolution... Restarting tracking.';
        stopTracking();
        setTimeout(startTracking, 500);
      }
    });
  }
}

function buildOSCTable() {
  const table = document.getElementById('osc-table');
  const groups = [
    { label: 'Palm',   rows: ['palm-pos'] },
    { label: 'Thumb',  rows: ['thumb-tip','thumb-curl','thumb-dir'] },
    { label: 'Index',  rows: ['index-tip','index-curl','index-dir'] },
    { label: 'Middle', rows: ['middle-tip','middle-curl','middle-dir'] },
    { label: 'Ring',   rows: ['ring-tip','ring-curl','ring-dir'] },
    { label: 'Pinky',  rows: ['pinky-tip','pinky-curl','pinky-dir'] },
  ];

  let html = '';
  for (const g of groups) {
    html += `<div class="osc-group">${g.label}</div>`;
    for (const rowId of g.rows) {
      const row = OSC_ROWS.find(r => r.id === rowId);
      html += `
        <div class="osc-row" id="row-${rowId}">
          <span class="osc-addr">${row.addr}</span>
          <span class="osc-val" id="val-${rowId}">—</span>
        </div>`;
    }
  }
  table.innerHTML = html;
}

// ── Lifecycle ────────────────────────────────────────────────────────────────
function startTracking() {
  if (window.isTracking) return;
  window.isTracking = true;

  btnStart.disabled = true;
  btnStop.disabled  = false;

  connectWS();
  gestureEstimator = buildGestureEstimator();

    // Calculate resolution
    const [rw, rh] = selectRes.value.split('x').map(Number);

    handsfree = new Handsfree({
      hands: {
        enabled: true,
        maxNumHands: 2,
        minDetectionConfidence: 0.7,
        minTrackingConfidence: 0.5,
      },
      setup: {
        wrap: { id: 'camera-wrap' },
      },
      assets: {
        video: { width: rw, height: rh }
      },
      debugger: {
        enabled: false, 
      }
    });
    
    // Also update p5 capture size
    window.p5Instance?.updateCaptureSize(rw, rh);

    handsfree.use('osc-sender', (data) => {
      trackFpsCount++;
      const now = performance.now();
      if (now - trackFpsTs >= 1000) {
        window.trackingFps = trackFpsCount;
        fpsBadge.textContent = `${window.trackingFps} fps`; // Fixed: now updates the badge
        trackFpsCount = 0; trackFpsTs = now;
        if (checkAutoFps.checked && window.trackingFps > 0) {
          sendInterval = 1000 / window.trackingFps;
          fpsSlider.value = Math.min(60, Math.max(1, window.trackingFps));
          fpsSliderVal.textContent = Math.round(fpsSlider.value);
        }
      }
      if (!data.hands) return;
      processHandData(data.hands);
    });

  handsfree.start().then(() => {
    // DO NOT DISABLE hands plugin yet to ensure video layer is generated
    log('Hand tracking active');
  });
}

function stopTracking() {
  if (!window.isTracking) return;
  window.isTracking = false;
  btnStart.disabled = false; btnStop.disabled = true;
  if (window.reconnectTimeout) clearTimeout(window.reconnectTimeout);
  if (handsfree) { handsfree.stop(); handsfree = null; }
  if (ws) { ws.close(); ws = null; }
  window.currentHandData = null; window.currentPoseData = null;
  fpsBadge.textContent = '— fps';
  
  // Clear the camera wrap content to avoid element accumulation
  const wrap = document.getElementById('camera-wrap');
  if (wrap) {
    // Keep p5-wrap but clear everything else (the videos added by Handsfree)
    const p5Wrap = document.getElementById('p5-wrap');
    wrap.innerHTML = '';
    if (p5Wrap) wrap.appendChild(p5Wrap);
  }
  
  log('Stopped.');
}

// ── WebSocket ────────────────────────────────────────────────────────────────
function connectWS() {
  const host = document.getElementById('ws-host').value.trim() || 'localhost';
  const port = document.getElementById('ws-port').value.trim() || '8080';
  const url  = `ws://${host}:${port}`;
  if (ws) { ws.close(); ws = null; }
  log(`Connecting to WebSocket…`);
  ws = new WebSocket(url);
  ws.onopen = () => { setStatus('connected', 'WS Connected'); log(`Bridge connected: ${url}`); };
  ws.onclose = () => { 
    setStatus('disconnected', 'WS Disconnected'); 
    log('Bridge closed'); 
    ws = null; 
    
    // Auto-reconnect if still tracking
    if (window.isTracking) {
      log('Attempting to reconnect in 2s...');
      if (window.reconnectTimeout) clearTimeout(window.reconnectTimeout);
      window.reconnectTimeout = setTimeout(connectWS, 2000);
    }
  };
  ws.onerror = () => { setStatus('disconnected', 'WS Error'); };
}

function sendJSON(data) {
  if (ws && ws.readyState === WebSocket.OPEN) { ws.send(JSON.stringify(data)); }
}

// ── Processing ────────────────────────────────────────────────────────────────
function processHandData(handsData) {
  if (!handsData || !handsData.landmarks) return;
  let handIdx = -1;
  for (let i = 0; i < 4; i++) { if (handsData.landmarksVisible[i]) { handIdx = i; break; } }
  if (handIdx === -1) { window.currentHandData = null; window.currentPoseData = null; return; }

  const lmRaw = handsData.landmarks[handIdx];
  if (!lmRaw || lmRaw.length < 21) return;

  // Smoothing (Lerp) logic
  let lm = lmRaw;
  if (window.isSmoothing) {
    if (!lastSmoothHand) {
      lastSmoothHand = JSON.parse(JSON.stringify(lmRaw));
    } else {
      for (let j = 0; j < lmRaw.length; j++) {
        lastSmoothHand[j].x += (lmRaw[j].x - lastSmoothHand[j].x) * SMOOTH_FACTOR;
        lastSmoothHand[j].y += (lmRaw[j].y - lastSmoothHand[j].y) * SMOOTH_FACTOR;
      }
      lm = lastSmoothHand;
    }
  } else {
    lastSmoothHand = null;
  }

  window.currentHandData = lm;

  const now = performance.now();
  if (now - lastSendTime < sendInterval) return;
  lastSendTime = now;

  let poseData = null;
  if (gestureEstimator) {
    try {
      const fpLm = lm.map(pt => [pt.x, pt.y, 0]);
      const result = gestureEstimator.estimate(fpLm, 0); 
      poseData = result.poseData;
      window.currentPoseData = poseData;
    } catch(e) {}
  }

  const finger_keys  = ['thumb','index','middle','ring','pinky'];
  const payload = { palm: { x: round3(lm[0].x), y: round3(lm[0].y) } };
  for (let i = 0; i < 5; i++) {
    const key = finger_keys[i];
    const tipLm = lm[LANDMARKS[key]];
    const entry = { tip: { x: round3(tipLm.x), y: round3(tipLm.y) }, curl: 0, direction: 0 };
    if (poseData && poseData[i]) {
      const [, curlName, dirName] = poseData[i];
      entry.curl = CURL_VAL[curlName] ?? 0;
      entry.direction = directionFromName(dirName);
    }
    
    // CUSTOM THUMB OVERRIDE
    // Fingerpose struggles with the thumb because it calculates angles, but the thumb folds 
    // across the palm. We use a distance heuristic against the pinky base to determine its curl.
    if (key === 'thumb') {
      const palmSize = Math.hypot(lm[0].x - lm[9].x, lm[0].y - lm[9].y);
      const distToPinkyBase = Math.hypot(tipLm.x - lm[17].x, tipLm.y - lm[17].y);
      
      // More permissive thresholds:
      // Combine the distance heuristic with Fingerpose's angle calculation.
      // If either one detects a curl, we prioritize the more flexed state.
      // MUCH less sensitive thresholds to make "Open" the natural state
      // Closed: < 0.75 | Half: 0.75 - 1.05 | Open: > 1.05
      const distCurl = distToPinkyBase < palmSize * 0.75 ? 1 : (distToPinkyBase < palmSize * 1.05 ? 0.5 : 0);
      
      if (distToPinkyBase > palmSize * 1.15) {
        entry.curl = 0; // Thumb is clearly out, force open
      } else {
        entry.curl = Math.max(entry.curl, distCurl);
      }

      // CUSTOM THUMB DIRECTION OVERRIDE
      // Use Thumb IP (3) to Thumb Tip (4) for the angle calculation
      // as the thumb base is more rigid than other fingers. 
      const tIP = lm[3];
      const tTip = lm[4];
      if (tIP && tTip) {
        entry.direction = getDirectionFromPoints(tIP, tTip);
      }
    }
    
    payload[key] = entry;
  }
  
  window.lastPayload = payload; // SHARED STATE FOR P5
  sendJSON(payload);
  updateUI(payload, poseData);
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function directionFromName(name) {
  const map = { 'Vertical Up': 0, 'Diagonal Up Right': 1, 'Horizontal Right': 2, 'Diagonal Down Right': 3, 'Vertical Down': 4, 'Diagonal Down Left': 5, 'Horizontal Left': 6, 'Diagonal Up Left': 7 };
  return map[name.trim()] ?? 0;
}
function updateUI(payload, poseData) {
  if (isOscHidden) return;
  setVal('palm-pos', `${payload.palm.x}, ${payload.palm.y}`);
  const finger_keys = ['thumb','index','middle','ring','pinky'];
  for (const key of finger_keys) {
    const f = payload[key]; if (!f) continue;
    setVal(`${key}-tip`, `${f.tip.x}, ${f.tip.y}`);
    setVal(`${key}-curl`, curlLabel(f.curl));
    setVal(`${key}-dir`, dirLabel(f.direction));
    const bar = document.getElementById(`bar-${key}`);
    if (bar) bar.style.height = `${f.curl * 100}%`;
  }
}
const setVal = (id, text) => { const el = document.getElementById(`val-${id}`); if (el) el.textContent = text; };
const curlLabel = (v) => v === 0 ? '○ Open' : (v === 0.5 ? '◑ Half' : '● Closed');
const dirLabel = (v) => ['↑ Up','↗ DiagUR','→ Right','↘ DiagDR','↓ Down','↙ DiagDL','← Left','↖ DiagUL'][v] ?? '—';
const setStatus = (cls, text) => { statusBadge.className = cls; statusText.textContent = text; };

/**
 * Calculates current direction index (0-7) from two points
 */
function getDirectionFromPoints(p1, p2) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const angle = Math.atan2(dy, dx); 
  let deg = angle * (180 / Math.PI);
  let adjusted = deg + 90; // Rotate so 0 is UP
  if (adjusted < 0) adjusted += 360;
  return Math.floor((adjusted + 22.5) / 45) % 8;
}

const log = (msg) => { logStrip.textContent = msg; };
const round3 = (v) => Math.round(v * 1000) / 1000;
const buildGestureEstimator = () => { if (typeof fp === 'undefined') return null; return new fp.GestureEstimator([]); };

init();
