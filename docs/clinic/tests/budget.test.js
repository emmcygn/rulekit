// The whole-journey budget audit.
//
// Every scene module already declares `budget: { calls, tris }`. A declared
// number nobody checks is a wish, so this file builds all eleven rooms in Node
// and measures them. It works headless because `src/lib/textures.js` returns
// 1x1 DataTexture placeholders when there is no 2D canvas, and three builds
// geometry and materials fine with no WebGL context.
//
// "Draw calls" here means draw-worthy objects: every Mesh, InstancedMesh, Line
// and Points in the built group. That is what the renderer would submit before
// frustum culling takes any of it back, so it is a conservative upper bound —
// which is what a budget wants.
//
// Chrome is free. `createStage` adds three lights and nothing else: no
// backdrop mesh, no post pass, no fullscreen quad. The only extra drawables in
// the scene are the camera rig's debug spheres, and those exist solely behind
// `?debug`. So the frame budget is exactly "three adjacent rooms", and
// `CHROME_CALLS` is the honest 0.

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import MODULES from '../src/scenes/index.js';
import { CHAPTERS } from '../src/core/chapters.js';
import { createMaterials } from '../src/lib/materials.js';
import { createQuality } from '../src/core/quality.js';
import { stationVec } from '../src/core/cameraRig.js';
import { residency, disposeGroup } from '../src/core/sceneManager.js';

// Spec §8, binding.
const FRAME_CALL_BUDGET = 300;
const FRAME_TRI_BUDGET = 500000;
const ROOM_CALL_CEILING = 90;
const UNINSTANCED_MESH_CEILING = 45;
const CHROME_CALLS = 0;

// Every emitted JS chunk, gzipped, summed.
//
// Spec §8 writes this budget as "250KB gzip". Controller ruling: that is 250
// KiB = 256000 bytes, not 250000. The spec's own arithmetic for the figure —
// "three ~150KB + gsap + app" — is loose enough that it cannot be read as a
// decimal count (three alone gzips to 182.6KB), so the intent is the
// quarter-megabyte class, and 256000 is the number that means that.
//
// True size at the time of writing: 251753 bytes, ~4.2KB of headroom. It is
// tight. The one large lever left is that all thirteen modules do
// `import * as THREE from 'three'`, so the three chunk ships unshaken at
// 724.66 kB raw; named imports are the fix if this ever goes over.
//
// The lever that is NOT available: importing `gsap/gsap-core` to drop
// CSSPlugin. It saves 7306 bytes, builds clean, passes every test here, and
// breaks the page in a real browser. See the comment in src/core/scrollDriver.js.
const JS_GZIP_CEILING = 256000;

function countDrawables(group) {
  let calls = 0;
  let tris = 0;
  group.traverse((o) => {
    if (!(o.isMesh || o.isInstancedMesh || o.isLine || o.isPoints)) return;
    calls += 1;
    const g = o.geometry;
    if (!g) return;
    const verts = g.index ? g.index.count : (g.attributes.position ? g.attributes.position.count : 0);
    const per = (o.isLine || o.isPoints) ? 0 : verts / 3;
    tris += per * (o.isInstancedMesh ? o.count : 1);
  });
  return { calls, tris };
}

// The ctx sceneManager.build() actually hands a module — same keys, same
// order. A test ctx richer than the real one would let a scene reach for
// something that does not exist in the browser and still pass here.
function buildAt(id, tier, portrait) {
  const index = CHAPTERS.findIndex((c) => c.id === id);
  const mod = MODULES[id];
  const ctx = {
    THREE,
    quality: createQuality(tier),
    materials: createMaterials(),
    portrait,
    station: stationVec(index),
    chapter: CHAPTERS[index],
  };
  const group = mod.build(ctx);
  return { mod, group, ctx };
}

describe('every scene declares and respects a budget', () => {
  for (const chapter of CHAPTERS) {
    it(`${chapter.id} builds under its declared budget`, () => {
      const mod = MODULES[chapter.id];
      expect(mod.id, `${chapter.id} module id mismatch`).toBe(chapter.id);
      expect(mod.budget, `${chapter.id} has no budget`).toBeDefined();
      expect(mod.budget.calls, `${chapter.id} declares more than the per-room ceiling`)
        .toBeLessThanOrEqual(ROOM_CALL_CEILING);

      const { group, mod: m, ctx } = buildAt(chapter.id, 'high', false);
      const { calls, tris } = countDrawables(group);
      expect(calls, `${chapter.id} draw calls`).toBeLessThanOrEqual(mod.budget.calls);
      expect(tris, `${chapter.id} triangles`).toBeLessThanOrEqual(mod.budget.tris);
      m.update(group, 0.5, ctx);
      disposeGroup(group);
    });
  }
});

describe('any three resident rooms fit the frame budget', () => {
  for (let i = 0; i < CHAPTERS.length; i++) {
    it(`residency around chapter ${i} stays under ${FRAME_CALL_BUDGET} calls and ${FRAME_TRI_BUDGET} tris`, () => {
      let calls = CHROME_CALLS;
      let tris = 0;
      const built = [];
      for (const j of residency(i, CHAPTERS.length)) {
        const { group } = buildAt(CHAPTERS[j].id, 'high', false);
        const c = countDrawables(group);
        calls += c.calls;
        tris += c.tris;
        built.push(group);
      }
      expect(calls).toBeLessThanOrEqual(FRAME_CALL_BUDGET);
      expect(tris).toBeLessThanOrEqual(FRAME_TRI_BUDGET);
      built.forEach(disposeGroup);
    });
  }

  // The number the spec actually cares about is the worst frame anywhere on the
  // scroll, not the eleven separate window totals. Measure it once, in one
  // place, and print it — a regression that stays inside the ceiling still
  // shows up in the run log rather than only in a reviewer's memory.
  it('reports the worst frame on the whole journey', () => {
    const perRoom = CHAPTERS.map((c) => {
      const { group } = buildAt(c.id, 'high', false);
      const m = countDrawables(group);
      disposeGroup(group);
      return { id: c.id, ...m };
    });

    let peak = { calls: -1, tris: -1, at: -1, window: [] };
    for (let i = 0; i < CHAPTERS.length; i++) {
      const win = residency(i, CHAPTERS.length);
      const calls = CHROME_CALLS + win.reduce((s, j) => s + perRoom[j].calls, 0);
      const tris = win.reduce((s, j) => s + perRoom[j].tris, 0);
      if (calls > peak.calls) peak = { calls, tris, at: i, window: win.map((j) => CHAPTERS[j].id) };
    }

    const rows = perRoom.map((r) => `  ${r.id.padEnd(12)} ${String(r.calls).padStart(3)} calls  ${String(r.tris).padStart(6)} tris`);
    console.log(
      `\njourney peak: ${peak.calls} draw calls / ${peak.tris} tris` +
      ` at chapter ${peak.at} (${peak.window.join(' + ')})` +
      `\nceilings: ${FRAME_CALL_BUDGET} calls / ${FRAME_TRI_BUDGET} tris\n` +
      rows.join('\n') + '\n',
    );

    expect(peak.calls).toBeLessThanOrEqual(FRAME_CALL_BUDGET);
    expect(peak.tris).toBeLessThanOrEqual(FRAME_TRI_BUDGET);
  });
});

describe('plural things are instanced, not looped', () => {
  it(`no scene builds more than ${UNINSTANCED_MESH_CEILING} separate meshes`, () => {
    for (const chapter of CHAPTERS) {
      const { group } = buildAt(chapter.id, 'high', false);
      let plainMeshes = 0;
      group.traverse((o) => { if (o.isMesh && !o.isInstancedMesh) plainMeshes++; });
      expect(plainMeshes, `${chapter.id} has ${plainMeshes} un-instanced meshes`)
        .toBeLessThanOrEqual(UNINSTANCED_MESH_CEILING);
      disposeGroup(group);
    }
  });

  it('lower tiers really do thin the swarms', () => {
    for (const chapter of CHAPTERS) {
      const hi = buildAt(chapter.id, 'high', false);
      const lo = buildAt(chapter.id, 'low', false);
      let hiInst = 0, loInst = 0;
      hi.group.traverse((o) => { if (o.isInstancedMesh) hiInst += o.count; });
      lo.group.traverse((o) => { if (o.isInstancedMesh) loInst += o.count; });
      expect(loInst, `${chapter.id} low tier grew`).toBeLessThanOrEqual(hiInst);
      disposeGroup(hi.group);
      disposeGroup(lo.group);
    }
  });

  // `low` is the tier a struggling machine lands on, so it has to be cheaper
  // than `high` on the one axis the GPU actually feels — never more expensive.
  it('the low tier never costs more than the high tier', () => {
    for (const chapter of CHAPTERS) {
      const hi = buildAt(chapter.id, 'high', false);
      const lo = buildAt(chapter.id, 'low', false);
      const h = countDrawables(hi.group);
      const l = countDrawables(lo.group);
      expect(l.calls, `${chapter.id} low tier draws more`).toBeLessThanOrEqual(h.calls);
      expect(l.tris, `${chapter.id} low tier costs more tris`).toBeLessThanOrEqual(h.tris);
      disposeGroup(hi.group);
      disposeGroup(lo.group);
    }
  });
});

// `quality.sample()` steps a struggling machine down on `workMs`, which is CPU
// submit time only. A frame that is slow because the GPU is drinking fill rate
// through big transparent planes never registers there, so it never triggers a
// step-down. Nothing in Node can measure fill rate — but transparent frontal
// area is the thing that produces it, and that is measurable from the built
// geometry. This is a smoke alarm, not a fire extinguisher: it prints the
// ranking every run and fails only on a scene far outside the pack.
describe('overdraw the frame-time monitor cannot see', () => {
  const OVERDRAW_CEILING = 4000; // world units squared of transparent frontal area

  it('no scene stacks an unreasonable amount of transparent area', () => {
    const box = new THREE.Box3();
    const size = new THREE.Vector3();
    const rows = [];

    for (const chapter of CHAPTERS) {
      const { group } = buildAt(chapter.id, 'high', false);
      group.updateMatrixWorld(true);
      let area = 0;
      group.traverse((o) => {
        if (!o.isMesh || !o.geometry) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        if (!mats.some((m) => m && (m.transparent || m.opacity < 1))) return;
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        box.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
        box.getSize(size);
        // Largest of the three axis-aligned faces: the worst case a camera can
        // be looking at, times however many copies an InstancedMesh draws.
        const face = Math.max(size.x * size.y, size.x * size.z, size.y * size.z);
        area += face * (o.isInstancedMesh ? o.count : 1);
      });
      rows.push({ id: chapter.id, area });
      disposeGroup(group);
    }

    rows.sort((a, b) => b.area - a.area);
    console.log(
      '\ntransparent frontal area (world units^2, worst-case facing):\n' +
      rows.map((r) => `  ${r.id.padEnd(12)} ${r.area.toFixed(1)}`).join('\n') + '\n',
    );

    for (const r of rows) {
      expect(r.area, `${r.id} transparent area`).toBeLessThanOrEqual(OVERDRAW_CEILING);
    }
  });
});

describe('portrait framing is authored, not letterboxed', () => {
  it('every scene builds in portrait without throwing', () => {
    for (const chapter of CHAPTERS) {
      const { group, mod, ctx } = buildAt(chapter.id, 'medium', true);
      expect(() => mod.update(group, 0, ctx)).not.toThrow();
      expect(() => mod.update(group, 1, ctx)).not.toThrow();
      disposeGroup(group);
    }
  });
});

// A post-build guard, not a build. `npm run build` writes dist/; this reads
// whatever is there. With no dist/ the check is skipped rather than silently
// passing on nothing.
describe('the JS payload fits the gzip ceiling', () => {
  const dir = join(import.meta.dirname, '..', 'dist', 'assets');
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.js')) : [];

  it.skipIf(files.length === 0)(`every emitted chunk gzips to <= ${JS_GZIP_CEILING} bytes total`, () => {
    const rows = files
      .map((f) => ({ f, bytes: gzipSync(readFileSync(join(dir, f))).length }))
      .sort((a, b) => b.bytes - a.bytes);
    const total = rows.reduce((s, r) => s + r.bytes, 0);
    console.log(
      '\nJS gzip:\n' + rows.map((r) => `  ${String(r.bytes).padStart(7)}  ${r.f}`).join('\n') +
      `\n  ${String(total).padStart(7)}  TOTAL (ceiling ${JS_GZIP_CEILING})\n`,
    );
    expect(total).toBeLessThanOrEqual(JS_GZIP_CEILING);
  });
});
