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

type StructureConnection = {
  structureIndex: number;
  segmentIndex: number;
  t: number;
  distanceAlong: number;
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
const MAX_LENGTH = VALIDATION_MODE ? 360 : 1400;
const MIN_STEP = 3;
const LOOP_HIT_RADIUS = VALIDATION_MODE ? 30 : 20;
const LOOP_MIN_POINTS = VALIDATION_MODE ? 2 : 6;
const ABSORB_DURATION = 800;
const MIN_STRUCTURE_SPAN = 20;

let drawing = false;
let inputPoints: Vec2[] = [];
let inputLength = 0;
let strokeStartConnection: StructureConnection | null = null;
let strokeAutoStoppedAtMaxLength = false;
const structures: LineStructure[] = [];
const persistedStrokes: LineStructure[] = [];
let absorb: AbsorbState | null = null;
let closureFlashUntil = 0;

type ClosureEval =
  | { ok: true; loop: LoopResult; startConnection: StructureConnection; endConnection: StructureConnection }
  | { ok: false; reason: string };

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

function nearestStructureConnection(p: Vec2): StructureConnection | null {
  let best: StructureConnection | null = null;
  let bestDistance = LOOP_HIT_RADIUS;

  for (let s = 0; s < structures.length; s++) {
    const points = structures[s].points;
    let cumulative = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      const abx = b.x - a.x;
      const aby = b.y - a.y;
      const segSq = abx * abx + aby * aby;
      if (segSq === 0) continue;
      const apx = p.x - a.x;
      const apy = p.y - a.y;
      const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / segSq));
      const projected = {
        x: a.x + abx * t,
        y: a.y + aby * t,
      };
      const d = distance(p, projected);
      if (d <= bestDistance) {
        bestDistance = d;
        best = {
          structureIndex: s,
          segmentIndex: i,
          t,
          distanceAlong: cumulative + Math.hypot(abx, aby) * t,
          point: projected,
        };
      }
      cumulative += Math.hypot(abx, aby);
    }
  }

  return best;
}

function buildStructureBoundaryPath(start: StructureConnection, end: StructureConnection): Vec2[] {
  const structure = structures[start.structureIndex];
  const points = structure.points;
  if (points.length < 2) return [];
  const boundary: Vec2[] = [{ ...start.point }];

  if (start.segmentIndex < end.segmentIndex || (start.segmentIndex === end.segmentIndex && start.t <= end.t)) {
    for (let i = start.segmentIndex + 1; i <= end.segmentIndex; i++) {
      boundary.push({ ...points[i] });
    }
  } else {
    for (let i = start.segmentIndex; i >= end.segmentIndex + 1; i--) {
      boundary.push({ ...points[i] });
    }
  }

  const last = boundary[boundary.length - 1];
  if (!last || distance(last, end.point) > 0.5) {
    boundary.push({ ...end.point });
  }

  return boundary;
}

function buildSegmentClosureLoop(startConnection: StructureConnection, endConnection: StructureConnection): LoopResult | null {
  const normalizedInput = inputPoints.map((p) => ({ ...p }));
  if (normalizedInput.length < 2) return null;

  normalizedInput[0] = { ...startConnection.point };
  normalizedInput[normalizedInput.length - 1] = { ...endConnection.point };

  const segment = buildStructureBoundaryPath(endConnection, startConnection);
  if (segment.length < 2) return null;

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

function evaluateSegmentClosure(): ClosureEval {
  if (structures.length === 0) return { ok: false, reason: 'No structures are available.' };
  if (inputPoints.length < 2) return { ok: false, reason: `Stroke has only ${inputPoints.length} point(s); need at least 2.` };
  const startConnection = strokeStartConnection ?? nearestStructureConnection(inputPoints[0]);
  if (!startConnection) return { ok: false, reason: 'Stroke does not begin from a nearby wall segment.' };
  strokeStartConnection = startConnection;
  const tip = inputPoints[inputPoints.length - 1];
  const endConnection = nearestStructureConnection(tip);
  if (!endConnection) return { ok: false, reason: 'Stroke tip is not touching a nearby wall segment.' };
  if (endConnection.structureIndex !== startConnection.structureIndex) {
    return { ok: false, reason: 'Stroke must close back into the same wall structure segment.' };
  }
  const span = Math.abs(endConnection.distanceAlong - startConnection.distanceAlong);
  if (span < MIN_STRUCTURE_SPAN) {
    return { ok: false, reason: `Wall span (${span.toFixed(2)}px) is too short to define a meaningful closure.` };
  }
  const loop = buildSegmentClosureLoop(startConnection, endConnection);
  if (!loop) return { ok: false, reason: 'Failed to build wall-segment closure loop.' };
  return { ok: true, loop, startConnection, endConnection };
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
  closureFlashUntil = performance.now() + 220;
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

function drawConnectionMarker(point: Vec2, color: string, radius: number) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
  ctx.fill();
}

function clearInputStroke() {
  inputPoints = [];
  inputLength = 0;
  strokeStartConnection = null;
  strokeAutoStoppedAtMaxLength = false;
}

function persistInputStroke() {
  if (inputPoints.length < 2) return;
  persistedStrokes.push({
    points: inputPoints.map((point) => ({ ...point })),
    length: inputLength,
  });
}

function logClosureFailure(context: string, reason: string) {
  if (!VALIDATION_MODE) return;
  console.log(`[validation] closure not triggered during ${context}: ${reason}`);
}

function tryFinalizeClosure(context: string, logFailures = true): boolean {
  const evaluation = evaluateSegmentClosure();
  if (!evaluation.ok) {
    if (logFailures) {
      logClosureFailure(context, evaluation.reason);
    }
    return false;
  }

  if (VALIDATION_MODE) {
    console.log(
      `[validation] closure reached wall segment ${evaluation.endConnection.segmentIndex}; absorption triggered immediately (${context}).`,
    );
  }
  drawing = false;
  beginAbsorb(evaluation.loop.center, evaluation.loop.path);
  clearInputStroke();
  return true;
}

function finalizeStrokeLikePointerUp(context: string) {
  if (tryFinalizeClosure(context, true)) return;
  drawing = false;
  persistInputStroke();
  if (VALIDATION_MODE) {
    console.log(`[validation] persisted stroke via ${context} finalization. points=${inputPoints.length}, length=${inputLength.toFixed(2)}`);
  }
  clearInputStroke();
}

function frame(now: number) {
  updateAbsorb(now);

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);

  for (const structure of structures) {
    drawPath(structure.points, structure.length);
  }

  if (drawing && strokeStartConnection) {
    drawConnectionMarker(strokeStartConnection.point, '#00ff7b', 8);
  }

  for (const stroke of persistedStrokes) {
    drawPath(stroke.points, stroke.length);
  }
  if (absorb) {
    if (now <= closureFlashUntil) {
      const fade = (closureFlashUntil - now) / 220;
      ctx.fillStyle = `rgba(70, 220, 255, ${Math.max(0.18, fade * 0.45)})`;
      ctx.beginPath();
      ctx.moveTo(absorb.path[0].x, absorb.path[0].y);
      for (let i = 1; i < absorb.path.length; i++) {
        ctx.lineTo(absorb.path[i].x, absorb.path[i].y);
      }
      ctx.closePath();
      ctx.fill();
    }
    drawPath(absorb.path, absorb.length);
  }
  drawPath(inputPoints, inputLength);

  requestAnimationFrame(frame);
}

canvas.addEventListener('pointerdown', (event) => {
  if (absorb) return;
  clearInputStroke();
  const p = pointerPos(event);

  drawing = true;
  strokeAutoStoppedAtMaxLength = false;
  canvas.setPointerCapture(event.pointerId);
  addPoint(p);
});

canvas.addEventListener('pointermove', (event) => {
  if (!drawing || absorb) return;
  addPoint(pointerPos(event));

  if (tryFinalizeClosure('pointermove', false)) {
    return;
  }

  if (!drawing && strokeAutoStoppedAtMaxLength) {
    if (VALIDATION_MODE) {
      console.log('[validation] stroke auto-stopped at max length; finalizing with pointerup-equivalent path persistence.');
    }
    finalizeStrokeLikePointerUp('auto-stop');
  }
});

const endDraw = (event: PointerEvent) => {
  if (canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
  if (!drawing) {
    if (strokeAutoStoppedAtMaxLength) {
      if (VALIDATION_MODE) {
        console.log('[validation] endDraw saw already auto-stopped stroke; finalizing with pointerup-equivalent behavior.');
      }
      finalizeStrokeLikePointerUp('auto-stop/endDraw');
    }
    return;
  }
  finalizeStrokeLikePointerUp('pointerup');
};

canvas.addEventListener('pointerup', endDraw);
canvas.addEventListener('pointercancel', endDraw);

window.addEventListener('resize', resize);

resize();
requestAnimationFrame(frame);
