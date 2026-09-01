import * as THREE from 'three';

const MONO = '"Spline Sans Mono", ui-monospace, Menlo, monospace';
const DISP = '"Martian Mono", ui-monospace, Menlo, monospace';

function make2d(w, h) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  return ctx ? { canvas: c, ctx } : null;
}

export const HEADLESS = make2d(1, 1) === null;

const cache = new Map();
function memo(key, build) {
  if (cache.has(key)) return cache.get(key);
  const v = build();
  cache.set(key, v);
  return v;
}

// Every texture out of this module lives in the cache below and outlives any
// one room, so it is marked shared: the scene manager's disposeGroup skips
// anything carrying that flag, even when the material holding it is a
// room-owned clone. Only disposeTextures() — page teardown — frees these.
function placeholder(aspect = 1) {
  const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
  t.needsUpdate = true;
  t.userData.aspect = aspect;
  t.userData.shared = true;
  return t;
}

function finish(canvas, aspect) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.userData.aspect = aspect;
  t.userData.shared = true;
  return t;
}

export function makeTextTexture(text, { px = 96, weight = 600, color = '#1A1D21', family = 'mono' } = {}) {
  return memo(`text|${text}|${px}|${weight}|${color}|${family}`, () => {
    const font = `${weight} ${px}px ${family === 'disp' ? DISP : MONO}`;
    const probe = make2d(8, 8);
    if (!probe) return placeholder(Math.max(1, text.length * 0.55));
    probe.ctx.font = font;
    const w = Math.max(8, Math.ceil(probe.ctx.measureText(text).width) + px * 0.3);
    const h = Math.ceil(px * 1.35);
    const c = make2d(w, h);
    c.ctx.font = font;
    c.ctx.fillStyle = color;
    c.ctx.textBaseline = 'middle';
    c.ctx.fillText(text, px * 0.15, h / 2);
    return finish(c.canvas, w / h);
  });
}

export function makeGlyphAtlas(words, { px = 96 } = {}) {
  return memo(`atlas|${px}|${words.join(' ')}`, () => {
    const cols = Math.ceil(Math.sqrt(words.length));
    const rows = Math.ceil(words.length / cols);
    const cw = px * 6, ch = px * 1.4;
    const uv = new Map();
    words.forEach((word, i) => {
      const cx = i % cols, cy = Math.floor(i / cols);
      uv.set(word, { x: cx / cols, y: 1 - (cy + 1) / rows, w: 1 / cols, h: 1 / rows });
    });
    const c = make2d(cw * cols, ch * rows);
    if (!c) return { texture: placeholder(), uv, cols, rows };
    c.ctx.font = `600 ${px}px ${MONO}`;
    c.ctx.fillStyle = '#1A1D21';
    c.ctx.textBaseline = 'middle';
    words.forEach((word, i) => {
      const cx = i % cols, cy = Math.floor(i / cols);
      c.ctx.fillText(word, cx * cw + px * 0.15, cy * ch + ch / 2, cw - px * 0.3);
    });
    return { texture: finish(c.canvas, (cw * cols) / (ch * rows)), uv, cols, rows };
  });
}

export function makeHatchTexture({ size = 64, color = '#858D95', bg = '#FFFFFF' } = {}) {
  return memo(`hatch|${size}|${color}|${bg}`, () => {
    const c = make2d(size, size);
    if (!c) return placeholder();
    c.ctx.fillStyle = bg;
    c.ctx.fillRect(0, 0, size, size);
    c.ctx.strokeStyle = color;
    c.ctx.lineWidth = size / 20;
    for (let i = -size; i < size * 2; i += size / 6) {
      c.ctx.beginPath(); c.ctx.moveTo(i, 0); c.ctx.lineTo(i + size, size); c.ctx.stroke();
    }
    const t = finish(c.canvas, 1);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  });
}

export function makePageTexture({ w = 512, h = 660, lines = 22, seed = 1 } = {}) {
  return memo(`page|${w}|${h}|${lines}|${seed}`, () => {
    const c = make2d(w, h);
    if (!c) return placeholder(w / h);
    c.ctx.fillStyle = '#FFFFFF';
    c.ctx.fillRect(0, 0, w, h);
    let s = seed;
    const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const m = w * 0.12;
    c.ctx.fillStyle = '#C8D0D8';
    for (let i = 0; i < lines; i++) {
      const y = h * 0.14 + i * ((h * 0.78) / lines);
      c.ctx.fillRect(m, y, (w - 2 * m) * (0.55 + rnd() * 0.45), Math.max(2, h / 220));
    }
    c.ctx.fillStyle = '#858D95';
    c.ctx.font = `500 ${Math.round(h / 46)}px ${MONO}`;
    c.ctx.fillText('PROTOCOL v3.0 / SECTION 5.2', m, h * 0.085);
    return finish(c.canvas, w / h);
  });
}

export function makeShadowTexture({ size = 256 } = {}) {
  return memo(`shadow|${size}`, () => {
    const c = make2d(size, size);
    if (!c) return placeholder();
    const g = c.ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(26,29,33,0.5)');
    g.addColorStop(0.55, 'rgba(26,29,33,0.16)');
    g.addColorStop(1, 'rgba(26,29,33,0)');
    c.ctx.fillStyle = g;
    c.ctx.fillRect(0, 0, size, size);
    return finish(c.canvas, 1);
  });
}

export function disposeTextures() {
  for (const v of cache.values()) {
    if (v && v.isTexture) v.dispose();
    else if (v && v.texture) v.texture.dispose();
  }
  cache.clear();
}
