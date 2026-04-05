type Vec2 = { x: number; y: number };

type LoopResult = {
  center: Vec2;
  path: Vec2[];
};

type AbsorbState = {
  startTime: number;
  duration: number;
  center: Vec2;
  path: Vec2[];
  from: Vec2[];
  length: number;
};

type LineStructure = {
  points: Vec2[];
  length: number;
};

type StructureAnchor = {
  structureIndex: number;
  pointIndex: number;
  point: Vec2;
};

const canvas = document.getElementById('game') as HTMLCanvasElement;
const maybeCtx = canvas.getContext('2d');
if (!maybeCtx) {
  throw new Error('Canvas 2D context is not available.');
}
const ctx: CanvasRenderingContext2D = maybeCtx;

let width = 0;
let height = 0;
const dpr = Math.max(1, window.devicePixelRatio || 1);

const VALIDATION_MODE = true;
const MAX_LENGTH = VALIDATION_MODE ? 1_000_000 : 1400;
const MIN_STEP = 3;
const LOOP_HIT_RADIUS = VALIDATION_MODE ? 30 : 20;
const LOOP_MIN_POINTS = VALIDATION_MODE ? 2 : 6;
const ABSORB_DURATION = 800;

let drawing = false;
let inputPoints: Vec2[] = [];
let inputLength = 0;
let strokeStartAnchor: StructureAnchor | null = null;
let strokeAutoStoppedAtMaxLength = false;
const structures: LineStructure[] = [];
const persistedStrokes: LineStructure[] = [];
let absorb: AbsorbState | null = null;
let closureStartAnchorIndex = -1;
let closureEndAnchorIndex = -1;

function resize() {
  width = window.innerWidth;
  height = window.innerHeight;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  createValidationStructure();
}

function distance(a: Vec2, b: Vec2) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function pathLength(path: Vec2[]) {
  let sum = 0;
  for (let i = 1; i < path.length; i++) {
    sum += distance(path[i - 1], path[i]);
  }
  return sum;
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

function createValidationStructure() {
  const center = { x: width * 0.5, y: height * 0.52 };
  const radius = Math.min(width, height) * 0.2;
  const gap = Math.PI * 0.2;
  const startAngle = -Math.PI / 2 + gap * 0.5;
  const endAngle = startAngle + (Math.PI * 2 - gap);
  const steps = 52;
  const points: Vec2[] = [];

  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const angle = lerp(startAngle, endAngle, t);
    points.push({
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
    });
  }

  structures.length = 0;
  structures.push({
    points,
    length: pathLength(points),
  });

  closureStartAnchorIndex = 0;
  closureEndAnchorIndex = points.length - 1;
}

function pointerPos(event: PointerEvent): Vec2 {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function addPoint(p: Vec2) {
  if (inputPoints.length === 0) {
    inputPoints.push(p);
    return;
  }
  const prev = inputPoints[inputPoints.length - 1];
  const seg = distance(prev, p);

  if (seg < MIN_STEP) return;
  const remain = MAX_LENGTH - inputLength;
  if (remain <= 0) {
    strokeAutoStoppedAtMaxLength = true;
    drawing = false;
    return;
  }

  if (seg <= remain) {
    inputPoints.push(p);
    inputLength += seg;
  } else {
    const t = remain / seg;
    inputPoints.push({ x: lerp(prev.x, p.x, t), y: lerp(prev.y, p.y, t) });
    inputLength = MAX_LENGTH;
    strokeAutoStoppedAtMaxLength = true;
    drawing = false;
  }
}

function nearestStructureAnchor(p: Vec2): StructureAnchor | null {
  let best: StructureAnchor | null = null;
  let bestDistance = LOOP_HIT_RADIUS;

  for (let s = 0; s < structures.length; s++) {
    const points = structures[s].points;
    for (let i = 0; i < points.length; i++) {
      const d = distance(p, points[i]);
      if (d <= bestDistance) {
        bestDistance = d;
        best = { structureIndex: s, pointIndex: i, point: points[i] };
      }
    }
  }

  return best;
}

function buildEndpointClosureLoop(startAnchor: StructureAnchor, endAnchor: StructureAnchor): LoopResult | null {
  const normalizedInput = inputPoints.map((p) => ({ ...p }));
  if (normalizedInput.length < 2) return null;

  normalizedInput[0] = { ...startAnchor.point };
  normalizedInput[normalizedInput.length - 1] = { ...endAnchor.point };

  const structure = structures[endAnchor.structureIndex];
  const from = endAnchor.pointIndex;
  const to = startAnchor.pointIndex;
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const segment = structure.points.slice(lo, hi + 1);
  if (segment.length < 2) return null;
  if (from > to) segment.reverse();

  const loopPath = normalizedInput.concat(segment.slice(1));
  if (loopPath.length < LOOP_MIN_POINTS) return null;

  let cx = 0;
  let cy = 0;
  for (const p of loopPath) {
    cx += p.x;
    cy += p.y;
  }

  return {
    center: { x: cx / loopPath.length, y: cy / loopPath.length },
    path: loopPath,
  };
}

function detectClosedLoopWithStructures(): LoopResult | null {
  if (!strokeStartAnchor || inputPoints.length < 2 || structures.length === 0) return null;
  if (strokeStartAnchor.structureIndex !== 0) return null;
  if (strokeStartAnchor.pointIndex !== closureStartAnchorIndex && strokeStartAnchor.pointIndex !== closureEndAnchorIndex) return null;

  const tip = inputPoints[inputPoints.length - 1];
  const tipAnchor = nearestStructureAnchor(tip);
  if (!tipAnchor || tipAnchor.structureIndex !== 0) return null;

  const startedAtFirst = strokeStartAnchor.pointIndex === closureStartAnchorIndex;
  const expectedEnd = startedAtFirst ? closureEndAnchorIndex : closureStartAnchorIndex;
  if (tipAnchor.pointIndex !== expectedEnd) return null;

  if (VALIDATION_MODE) {
    return buildEndpointClosureLoop(strokeStartAnchor, tipAnchor);
  }

  return buildEndpointClosureLoop(strokeStartAnchor, tipAnchor);
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
  for (let i = 0; i < path.length; i++) {
    path[i].x = smoothed[i].x;
    path[i].y = smoothed[i].y;
  }
}

function beginAbsorb(center: Vec2, path: Vec2[]) {
  absorb = {
    startTime: performance.now(),
    duration: ABSORB_DURATION,
    center,
    path,
    from: path.map((p) => ({ ...p })),
    length: pathLength(path),
  };
  drawing = false;
}

function updateAbsorb(now: number) {
  if (!absorb) return;
  const t = Math.min(1, (now - absorb.startTime) / absorb.duration);
  const e = easeOutCubic(t);

  for (let i = 0; i < absorb.path.length; i++) {
    const src = absorb.from[i];
    absorb.path[i].x = lerp(src.x, absorb.center.x, e);
    absorb.path[i].y = lerp(src.y, absorb.center.y, e);
  }

  if (t >= 1) {
    smoothLargeJitter(absorb.path);
    absorb = null;
  }
}

function drawPath(path: Vec2[], length: number) {
  if (path.length < 2) return;

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 4;
  ctx.strokeStyle = lineColorByLength(length / MAX_LENGTH);
  ctx.beginPath();
  ctx.moveTo(path[0].x, path[0].y);
  for (let i = 1; i < path.length; i++) {
    ctx.lineTo(path[i].x, path[i].y);
  }
  ctx.stroke();
}

function clearInputStroke() {
  inputPoints = [];
  inputLength = 0;
  strokeAutoStoppedAtMaxLength = false;
}

function persistInputStroke() {
  if (inputPoints.length < 2) return;
  persistedStrokes.push({
    points: inputPoints.map((point) => ({ ...point })),
    length: inputLength,
  });
}

function frame(now: number) {
  updateAbsorb(now);

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);

  for (const structure of structures) {
    drawPath(structure.points, structure.length);
  }
  for (const stroke of persistedStrokes) {
    drawPath(stroke.points, stroke.length);
  }
  if (absorb) {
    drawPath(absorb.path, absorb.length);
  }
  drawPath(inputPoints, inputLength);

  requestAnimationFrame(frame);
}

canvas.addEventListener('pointerdown', (event) => {
  if (absorb) return;
  clearInputStroke();
  const p = pointerPos(event);
  const anchor = nearestStructureAnchor(p);
  const isClosureEndpoint = Boolean(
    anchor &&
      anchor.structureIndex === 0 &&
      (anchor.pointIndex === closureStartAnchorIndex || anchor.pointIndex === closureEndAnchorIndex),
  );
  strokeStartAnchor = isClosureEndpoint ? anchor : null;

  drawing = true;
  strokeAutoStoppedAtMaxLength = false;
  canvas.setPointerCapture(event.pointerId);
  addPoint(p);
});

canvas.addEventListener('pointermove', (event) => {
  if (!drawing || absorb) return;
  addPoint(pointerPos(event));

  const structureLoop = detectClosedLoopWithStructures();
  if (structureLoop) {
    drawing = false;
    beginAbsorb(structureLoop.center, structureLoop.path);
    clearInputStroke();
    return;
  }

  if (!drawing && strokeAutoStoppedAtMaxLength) {
    persistInputStroke();
    clearInputStroke();
  }
});

const endDraw = (event: PointerEvent) => {
  if (canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
  if (!drawing) {
    if (strokeAutoStoppedAtMaxLength) {
      persistInputStroke();
      clearInputStroke();
    }
    return;
  }

  const structureLoop = detectClosedLoopWithStructures();
  if (structureLoop) {
    drawing = false;
    beginAbsorb(structureLoop.center, structureLoop.path);
    clearInputStroke();
    return;
  }

  drawing = false;
  persistInputStroke();
  clearInputStroke();
};

canvas.addEventListener('pointerup', endDraw);
canvas.addEventListener('pointercancel', endDraw);

window.addEventListener('resize', resize);

resize();
requestAnimationFrame(frame);
