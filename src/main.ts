type Vec2 = { x: number; y: number };

type LoopResult = {
  center: Vec2;
  endIndex: number;
};

type AbsorbState = {
  startTime: number;
  duration: number;
  center: Vec2;
  from: Vec2[];
};

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d');
if (!ctx) {
  throw new Error('Canvas 2D context is not available.');
}

let width = 0;
let height = 0;
const dpr = Math.max(1, window.devicePixelRatio || 1);

const MAX_LENGTH = 1400;
const MIN_STEP = 3;
const LOOP_HIT_RADIUS = 20;
const LOOP_MIN_POINTS = 14;
const ABSORB_DURATION = 800;
const GAME_DURATION = 60000;

let gameStart = performance.now();
let ended = false;

let drawing = false;
let points: Vec2[] = [];
let totalLength = 0;
let absorb: AbsorbState | null = null;

function resize() {
  width = window.innerWidth;
  height = window.innerHeight;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function distance(a: Vec2, b: Vec2) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

function lineColorByLength(ratio: number) {
  const hue = lerp(180, 5, Math.min(1, ratio));
  return `hsl(${hue}, 90%, 60%)`;
}

function pointerPos(event: PointerEvent): Vec2 {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function addPoint(p: Vec2) {
  if (points.length === 0) {
    points.push(p);
    return;
  }
  const prev = points[points.length - 1];
  const seg = distance(prev, p);

  if (seg < MIN_STEP) return;
  const remain = MAX_LENGTH - totalLength;
  if (remain <= 0) return;

  if (seg <= remain) {
    points.push(p);
    totalLength += seg;
  } else {
    const t = remain / seg;
    points.push({ x: lerp(prev.x, p.x, t), y: lerp(prev.y, p.y, t) });
    totalLength = MAX_LENGTH;
    drawing = false;
  }
}

function detectClosedLoop(): LoopResult | null {
  if (points.length < LOOP_MIN_POINTS) return null;
  const tip = points[points.length - 1];

  for (let i = 0; i < points.length - LOOP_MIN_POINTS; i++) {
    const d = distance(tip, points[i]);
    if (d <= LOOP_HIT_RADIUS) {
      const loopPoints = points.slice(i, points.length);
      let cx = 0;
      let cy = 0;
      for (const p of loopPoints) {
        cx += p.x;
        cy += p.y;
      }
      const inv = 1 / loopPoints.length;
      return {
        center: { x: cx * inv, y: cy * inv },
        endIndex: i,
      };
    }
  }
  return null;
}

function smoothLargeJitter(path: Vec2[]) {
  if (path.length < 3) return;
  const smoothed = path.map((p) => ({ ...p }));
  const threshold = 18;
  for (let i = 1; i < path.length - 1; i++) {
    const a = path[i - 1];
    const b = path[i];
    const c = path[i + 1];

    const mid = { x: (a.x + c.x) * 0.5, y: (a.y + c.y) * 0.5 };
    const jitter = distance(b, mid);
    if (jitter > threshold) {
      smoothed[i].x = lerp(b.x, mid.x, 0.65);
      smoothed[i].y = lerp(b.y, mid.y, 0.65);
    }
  }

  points = smoothed;
}

function beginAbsorb(center: Vec2) {
  absorb = {
    startTime: performance.now(),
    duration: ABSORB_DURATION,
    center,
    from: points.map((p) => ({ ...p })),
  };
  drawing = false;
}

function updateAbsorb(now: number) {
  if (!absorb) return;
  const t = Math.min(1, (now - absorb.startTime) / absorb.duration);
  const e = easeOutCubic(t);

  for (let i = 0; i < points.length; i++) {
    const src = absorb.from[i];
    points[i].x = lerp(src.x, absorb.center.x, e);
    points[i].y = lerp(src.y, absorb.center.y, e);
  }

  if (t >= 1) {
    smoothLargeJitter(points);
    absorb = null;
  }
}

function drawPath() {
  if (points.length < 2) return;

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 4;
  ctx.strokeStyle = lineColorByLength(totalLength / MAX_LENGTH);
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();
}

function drawTimer(now: number) {
  const leftMs = Math.max(0, GAME_DURATION - (now - gameStart));
  const sec = Math.ceil(leftMs / 1000);
  ctx.fillStyle = '#ffffff';
  ctx.font = '16px sans-serif';
  ctx.fillText(`${sec}s`, 12, 24);
}

function frame(now: number) {
  if (!ended && now - gameStart >= GAME_DURATION) {
    ended = true;
    drawing = false;
  }

  updateAbsorb(now);

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);

  drawPath();
  drawTimer(now);

  if (ended) {
    ctx.fillStyle = '#fff';
    ctx.font = '28px sans-serif';
    ctx.fillText('Finished', width * 0.5 - 54, height * 0.5);
  }

  requestAnimationFrame(frame);
}

canvas.addEventListener('pointerdown', (event) => {
  if (ended || absorb) return;
  points = [];
  totalLength = 0;
  drawing = true;
  canvas.setPointerCapture(event.pointerId);
  addPoint(pointerPos(event));
});

canvas.addEventListener('pointermove', (event) => {
  if (!drawing || ended || absorb) return;
  addPoint(pointerPos(event));

  const loop = detectClosedLoop();
  if (loop) {
    points = points.slice(loop.endIndex);
    beginAbsorb(loop.center);
  }
});

const endDraw = () => {
  drawing = false;
};

canvas.addEventListener('pointerup', endDraw);
canvas.addEventListener('pointercancel', endDraw);

window.addEventListener('resize', resize);

resize();
requestAnimationFrame(frame);
