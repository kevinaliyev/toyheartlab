/**
 * Flowing brush-script letterforms for "toyheart".
 * Coordinates are in normalized [-1, 1] space (roughly x: [-0.76, 0.76], y: [-0.22, 0.24]).
 * Each stroke is an array of [x, y] control points; the brush lifts between strokes.
 */

const LETTER_STROKES = [
  // 't'
  [[-0.74, -0.10], [-0.73, 0.08], [-0.72, 0.22], [-0.67, 0.23]],
  [[-0.78, 0.10], [-0.66, 0.11]],
  // 'o'
  [[-0.55, 0.08], [-0.60, 0.04], [-0.61, -0.05], [-0.55, -0.10], [-0.49, -0.05], [-0.49, 0.04], [-0.55, 0.08]],
  // 'y'
  [[-0.43, 0.08], [-0.41, -0.04], [-0.36, -0.08], [-0.32, 0.08]],
  [[-0.32, 0.08], [-0.34, -0.14], [-0.38, -0.24], [-0.44, -0.23]],
  // 'h'
  [[-0.24, -0.10], [-0.23, 0.10], [-0.22, 0.23]],
  [[-0.23, 0.01], [-0.18, 0.08], [-0.13, 0.05], [-0.12, -0.10]],
  // 'e'
  [[-0.06, -0.01], [0.04, 0.01], [0.05, 0.07], [-0.01, 0.09], [-0.06, 0.04], [-0.06, -0.06], [0.00, -0.10], [0.06, -0.07]],
  // 'a'
  [[0.21, 0.06], [0.15, 0.09], [0.10, 0.04], [0.10, -0.06], [0.16, -0.10], [0.21, -0.03], [0.21, 0.08], [0.23, -0.10]],
  // 'r'
  [[0.29, -0.10], [0.30, 0.08]],
  [[0.30, 0.02], [0.34, 0.08], [0.39, 0.07]],
  // 't'
  [[0.48, -0.10], [0.49, 0.08], [0.50, 0.22], [0.55, 0.23]],
  [[0.44, 0.10], [0.56, 0.11]],
];

// Tiny heart shaped period at the end of "toyheart" (roughly period-sized around x=0.64, y=-0.075)
const TINY_HEART_PTS = [
  [0.64, -0.102],
  [0.615, -0.078],
  [0.610, -0.056],
  [0.625, -0.046],
  [0.64, -0.064],
  [0.655, -0.046],
  [0.670, -0.056],
  [0.665, -0.078],
  [0.64, -0.102],
];

// Non-linear stroke orders so brushes paint different parts of "toyheart" simultaneously
const BRUSH_ORDERS = [
  // Brush 0: Center-out ("h e a r t" then "t o y")
  [5, 6, 7, 8, 9, 10, 11, 12, 0, 1, 2, 3, 4],
  // Brush 1: Outside-in ("t o y" + "t r a" + "h e")
  [0, 1, 11, 12, 2, 9, 10, 3, 4, 8, 7, 5, 6],
  // Brush 2: Crossbars, loops & ascenders first
  [1, 12, 2, 7, 8, 4, 6, 0, 11, 3, 5, 9, 10],
];

// Precompute cumulative arc-length segments for smooth uniform traversal
const STROKE_SEGMENTS = LETTER_STROKES.map((pts) => {
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - pts[i - 1][0];
    const dy = pts[i][1] - pts[i - 1][1];
    len += Math.hypot(dx, dy);
  }
  return { pts, len: Math.max(len, 0.01) };
});

const TOTAL_LEN = STROKE_SEGMENTS.reduce((sum, s) => sum + s.len + 0.08, 0); // +0.08 lift gap

function samplePolyline(pts, u) {
  const n = pts.length - 1;
  const scaled = Math.max(0, Math.min(n - 1e-5, u * n));
  const i = Math.floor(scaled);
  const f = scaled - i;
  // Smoothstep easing within segment for organic brush feel
  const t = f * f * (3 - 2 * f);
  return [
    pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t,
    pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t,
  ];
}

function sampleTinyHeartPiece(u, brushIndex, brushCount) {
  const count = Math.max(1, Math.round(brushCount));
  const pieceStart = (brushIndex % count) / count;
  const pieceEnd = ((brushIndex % count) + 1) / count;
  const tGlobal = pieceStart + u * (pieceEnd - pieceStart);
  return samplePolyline(TINY_HEART_PTS, tGlobal);
}

const HEART_PIECE_LEN = 0.22;

function evalAtDistance(dist, brushIndex, seed, brushCount) {
  const order = BRUSH_ORDERS[brushIndex % BRUSH_ORDERS.length];
  const passLen = TOTAL_LEN + HEART_PIECE_LEN + 0.08;
  const pass = Math.floor(dist / passLen);
  const d = ((dist % passLen) + passLen) % passLen;

  // Subtle per-brush & per-pass micro-offset so overlapping washes stay cohesive
  const angle = (brushIndex * 1.15 + pass * 0.7 + seed) * 0.4;
  const offsetX = Math.sin(angle * 2.1 + brushIndex) * 0.008;
  const offsetY = Math.cos(angle * 1.7 + pass) * 0.010;
  const scale = 1.0;

  let cursor = 0;
  for (let idx = 0; idx < order.length; idx++) {
    const seg = STROKE_SEGMENTS[order[idx]];
    if (d <= cursor + seg.len) {
      const u = (d - cursor) / seg.len;
      const [x, y] = samplePolyline(seg.pts, u);
      const edgeFade = Math.min(u / 0.12, (1 - u) / 0.12, 1.0);
      return {
        x: x * scale + offsetX,
        y: y * scale + offsetY,
        lift: Math.max(0, edgeFade),
      };
    }
    cursor += seg.len;
    if (d <= cursor + 0.08) {
      const [x, y] = seg.pts[seg.pts.length - 1];
      return { x: x * scale + offsetX, y: y * scale + offsetY, lift: 0 };
    }
    cursor += 0.08;
  }

  // At the end of each pass, each brush paints its piece of the tiny heart period
  if (d <= cursor + HEART_PIECE_LEN) {
    const u = (d - cursor) / HEART_PIECE_LEN;
    const [x, y] = sampleTinyHeartPiece(u, brushIndex, brushCount);
    const edgeFade = Math.min(u / 0.15, (1 - u) / 0.15, 1.0);
    return {
      x: x * scale + offsetX * 0.5,
      y: y * scale + offsetY * 0.5,
      lift: Math.max(0, edgeFade),
    };
  }

  const [hx, hy] = sampleTinyHeartPiece(1, brushIndex, brushCount);
  return { x: hx * scale + offsetX * 0.5, y: hy * scale + offsetY * 0.5, lift: 0 };
}

/**
 * Samples brush position, previous position, and lift [0..1] along the "toyheart" pattern.
 */
export function sampleToyheartBrush(time, brushIndex, seed, dt = 0.025, brushCount = 3) {
  // Stagger each brush along the word so they paint different letters simultaneously
  const phase = brushIndex * (TOTAL_LEN / 3.2) + seed * 0.5;
  const speedScale = 0.42;
  const dist = time * speedScale + phase;
  const prevDist = (time - dt) * speedScale + phase;

  const curr = evalAtDistance(dist, brushIndex, seed, brushCount);
  const prev = evalAtDistance(prevDist, brushIndex, seed, brushCount);

  return {
    pos: [curr.x, curr.y],
    prev: [prev.x, prev.y],
    lift: curr.lift,
  };
}
