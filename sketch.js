/**
 * sketch.js - HandsfreeOSC P5 Visualizer
 * Futuristic minimal hand rendering
 */

const sketch = (p) => {
  let w, h;
  let capture;
  const FINGER_KEYS = ['thumb', 'index', 'middle', 'ring', 'pinky'];
  
  // Direction enum index -> Angle (radians)
  const ANGLE_MAP = [
    -Math.PI / 2,     // 0: Up
    -Math.PI / 4,     // 1: DiagUpRight
    0,                // 2: Right
    Math.PI / 4,      // 3: DiagDownRight
    Math.PI / 2,      // 4: Down
    3 * Math.PI / 4,  // 5: DiagDownLeft
    Math.PI,          // 6: Left
    -3 * Math.PI / 4  // 7: DiagUpLeft
  ];

  p.setup = () => {
    const wrap = document.getElementById('camera-wrap');
    const rect = wrap.getBoundingClientRect();
    w = rect.width || 800;
    h = rect.height || 600;
    
    let cnv = p.createCanvas(w, h);
    cnv.parent('p5-wrap');
    p.pixelDensity(1);
    
    // Create manual capture for background video
    capture = p.createCapture(p.VIDEO);
    capture.size(640, 480);
    capture.hide(); // Hide raw DOM element, we draw it manually
    
    p.clear();
  };
  p.windowResized = () => {
    const wrap = document.getElementById('camera-wrap');
    if (wrap) {
      const rect = wrap.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      p.resizeCanvas(w, h);
    }
  };

  p.triggerResize = () => {
    // Delay slightly to wait for CSS transitions
    setTimeout(() => p.windowResized(), 50);
  };

  p.updateCaptureSize = (nw, nh) => {
    if (capture) {
      capture.remove();
    }
    capture = p.createCapture(p.VIDEO);
    capture.size(nw, nh);
    capture.hide();
  };

  p.toScreen = (pt) => {
    // MediaPipe hands landmarks are normalized [0, 1]
    // We used to mirror here, but if Handsfree mirrors the video, we should match it
    return p.createVector((1 - pt.x) * w, pt.y * h);
  };

  p.draw = () => {
    p.clear();

    // ── DRAW BACKGROUND VIDEO ────────────────────────
    if (capture) {
      p.push();
      // Mirror the video drawing
      p.translate(w, 0);
      p.scale(-1, 1);
      
      // Draw video to fill the canvas
      p.image(capture, 0, 0, w, h);
      
      // Add darkening layer to make tracking stand out (more transparent now)
      p.fill(0, 0, 0, 190); 
      p.rect(0, 0, w, h);
      p.pop();
    }

    // ── DEBUG & Status ───────────────────────────────
    p.noStroke();
    p.fill(0, 255, 0, 150);
    p.circle(15, 15, 8 + Math.sin(p.frameCount * 0.1) * 3);
    
    p.fill(255, 255, 255, 200);
    p.textFont('monospace');
    p.textSize(10);
    p.textAlign(p.LEFT, p.TOP);

    
    p.fill(255, 255, 255, 150);
    p.textSize(12);
    p.textAlign(p.LEFT, p.BOTTOM);
    const trackingStr = window.trackingFps ? `TRACKING: ${window.trackingFps} FPS` : 'TRACKING: --';
    const engineStr = `ENGINE: ${Math.round(p.frameRate())} FPS`;
    p.text(`${trackingStr}  |  ${engineStr}`, 15, h - 15);

    if (!window.isTracking) {
      p.push();
      p.textAlign(p.CENTER, p.CENTER);
      p.textFont('sans-serif');
      
      // Floating animation
      const bob = Math.sin(p.frameCount * 0.05) * 10;
      
      p.textSize(48);
      p.text('🖐', w / 2, h / 2 - 20 + bob);
      
      p.textSize(16);
      p.fill(255, 255, 255, 150);
      p.text('Press Start to activate hand tracking', w / 2, h / 2 + 40);
      p.pop();
    }

    if (!window.isTracking || !window.currentHandData) return;

    const lm = window.currentHandData;
    const pose = window.currentPoseData;

    p.push();

    // 1. Draw Connectivity (Skeleton Lines)
    p.stroke(255, 255, 255, 80);
    p.strokeWeight(1.5);
    if (window.HAND_CONNECTIONS) {
      for (const [s, e] of window.HAND_CONNECTIONS) {
        if (lm[s] && lm[e]) {
          const pt1 = p.toScreen(lm[s]);
          const pt2 = p.toScreen(lm[e]);
          p.line(pt1.x, pt1.y, pt2.x, pt2.y);
        }
      }
    }

    // 2. Draw Joints
    p.noStroke();
    for (let i = 0; i < lm.length; i++) {
      if (Object.values(window.LANDMARKS).includes(i) && i !== 0) continue;
      const pt = p.toScreen(lm[i]);
      p.fill(255, 255, 255, 180);
      p.circle(pt.x, pt.y, 5);
    }

    // 3. Draw Tips (based on payload)
    for (let i = 0; i < 5; i++) {
      const key = FINGER_KEYS[i];
      const tipIdx = window.LANDMARKS[key];
      const pt = p.toScreen(lm[tipIdx]);

      // NEW: Read from shared state for perfect sync
      const fData = window.lastPayload ? window.lastPayload[key] : null;
      const curl = fData ? fData.curl : 0;
      const dirIdx = fData ? fData.direction : -1;

      let col;
      if (curl === 0) col = p.color(255, 255, 255);       
      else if (curl === 0.5) col = p.color(168, 85, 247); 
      else col = p.color(239, 68, 68);                    

      p.noStroke();
      p.fill(col);
      p.circle(pt.x, pt.y, 14);
      p.fill(10, 10, 20);
      p.circle(pt.x, pt.y, 6);

      if (dirIdx !== -1) {
        p.push();
        const baseAngle = ANGLE_MAP[dirIdx];
        const mirroredAngle = Math.PI - baseAngle;
        const dist = 30;
        p.translate(pt.x + Math.cos(mirroredAngle) * dist, pt.y + Math.sin(mirroredAngle) * dist);
        p.rotate(mirroredAngle);
        p.stroke(col);
        p.strokeWeight(2);
        p.noFill();
        p.line(-8, 0, 8, 0); 
        p.line(2, -5, 8, 0); 
        p.line(2, 5, 8, 0);
        p.pop();
      }
    }
    p.pop();
  };

  /**
   * Calculates current direction index (0-7) from two points
   */
  p.getDirectionFromPoints = (p1, p2) => {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const angle = Math.atan2(dy, dx); 
    let deg = angle * (180 / Math.PI);
    let adjusted = deg + 90; // Rotate so 0 is UP
    if (adjusted < 0) adjusted += 360;
    return Math.floor((adjusted + 22.5) / 45) % 8;
  };
};

window.p5Instance = new p5(sketch);
