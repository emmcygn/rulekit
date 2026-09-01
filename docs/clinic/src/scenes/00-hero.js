// Chapter 00 — "Start". The document you cannot run.
//
// A single huge page hangs in the white. The camera drifts forward out of the
// haze toward it, and from a fifth of the way in the page's own words start
// letting go: they peel off the face, spread, and hang in the air as the camera
// slides past. Nothing here is a metaphor for a PDF — it IS a printed page, at
// the scale of a wall.
//
// ── Where the props sit, and why ──────────────────────────────────────────
// Station 0 is the world origin and `cameraT` PARKS the camera on it for the
// whole first half of this chapter (cameraT(0, p) clamps to 0 until p = 0.5),
// then runs it out to roughly (1.75, 0.2, -8.8) by p = 1. So the forward drift
// of the first half has to come from `off` in cameraKeys — which is why 00's
// opening key pulls the camera back to z = +4.6.
//
// The page sits ON the path — (0.9, 0.2, -8.2), which is where the camera ends
// up, not where it starts. It is ~13u out at p = 0 (a third of the way into the
// fog, so it reads as a shape in haze), fills the frame from p ≈ 0.8, and the
// camera goes straight through it in the last few percent: you do not stop at
// the document, you pass through it. The x of 0.9 is what makes that pass clean
// — the flight path drifts to x ≈ 1.6 by then, and a page centred on x = 0
// would show its right EDGE across the middle of the frame instead of covering
// it. Portrait's frustum is half as wide, so update() slides the page to
// z = -7.0 and scales it to 0.72 there.
//
// ── One draw call for every word ──────────────────────────────────────────
// The words are one InstancedMesh sharing one glyph atlas, so which cell of the
// atlas an instance shows has to be a per-instance attribute: `aUvRect` holds
// that word's (x, y, w, h) rect and a two-line patch on the stock MeshBasic
// vertex shader rewrites vMapUv from it. Without that patch every quad would
// show the whole atlas at once.

import * as THREE from 'three';
import { createSwarm } from '../lib/instancedSwarm.js';
import { makePageTexture, makeGlyphAtlas } from '../lib/textures.js';
import { makeContactShadow } from '../lib/contactShadow.js';
import { sub, smoothstep, lerp } from '../lib/easing.js';

const WORDS = ['participants', 'are', 'required', 'to', 'have', 'an', 'eGFR', 'of', 'at', 'least', '30', 'at', 'screening'];

// The document assembly's home, in station-local space. `z` is the landscape
// value; portrait uses PORTRAIT_Z (see update).
const DOC = { x: 0.9, y: 0.2, z: -8.2 };
const PORTRAIT_Z = -7.0;
const SLAB_W = 4.8, SLAB_H = 6.2, SLAB_D = 0.06;

// The printed grid on the page face. Quad aspect matches the atlas cell aspect
// (6px wide by 1.4px tall in makeGlyphAtlas's units) so nothing is stretched.
const COLS = 6;
const QUAD_W = 0.74, QUAD_H = 0.1727;
const COL_GAP = 0.76, ROW_GAP = 0.38;
const TOP_Y = 2.3;
const GLYPH_Z = SLAB_D / 2 + 0.02;
// The printed face sits just proud of the slab's +z plane — far enough not to
// z-fight at this depth range, far enough behind GLYPH_Z that the words still
// float clear of it.
const PAGE_Z = SLAB_D / 2 + 0.004;

// makeGlyphAtlas left-aligns each word 0.15/6 of a cell in from its left edge,
// at a mono advance of ~0.6em on a 6em cell. So a short word sits far left of
// its quad unless we shift the instance back by the difference — this is that
// correction, in quad widths.
function inkOffset(word) {
  const f = Math.min(0.95, word.length * 0.1);
  return QUAD_W * (0.025 + f / 2 - 0.5);
}

const _v = new THREE.Vector3();

export default {
  id: '00-hero',
  // 4 calls in fact — box, printed face, contact shadow, glyph swarm — with two
  // spare so the next prop in this room does not need the number moved.
  budget: { calls: 6, tris: 6000 },

  build(ctx) {
    const g = new THREE.Group();

    // `doc` carries the assembly's placement and the two portrait tweaks update
    // applies. `sheet` is the page's own frame: the slab AND the glyphs live in
    // it, so a word that has not let go yet swings with the page rather than
    // hanging beside it.
    const doc = new THREE.Group();
    doc.position.set(DOC.x, DOC.y, DOC.z);
    const sheet = new THREE.Group();
    doc.add(sheet);

    // The slab is one bone box and ONE printed plane laid on its +z face — not a
    // six-material box. A material array makes three.js emit one render item per
    // BoxGeometry group, so the six-entry version cost six draw calls to show
    // five identical bone faces. Same silhouette, same face, two calls.
    const slab = new THREE.Mesh(new THREE.BoxGeometry(SLAB_W, SLAB_H, SLAB_D), ctx.materials.bone);
    sheet.add(slab);

    const pageTex = makePageTexture({ w: 512, h: 660, lines: 22, seed: 7 });
    const page = new THREE.Mesh(
      new THREE.PlaneGeometry(SLAB_W, SLAB_H),
      new THREE.MeshLambertMaterial({ map: pageTex, color: 0xFFFFFF }),
    );
    page.position.z = PAGE_Z;
    sheet.add(page);

    const shadow = makeContactShadow(ctx.materials, { radius: 3.2, opacity: 0.16 });
    shadow.position.set(0, -3.2, 0);
    doc.add(shadow);
    g.add(doc);

    // The words peeling off the page — one InstancedMesh, one draw call.
    const n = ctx.quality.count(WORDS.length * 6);
    const atlas = makeGlyphAtlas(WORDS, { px: 72 });
    const glyphGeo = new THREE.PlaneGeometry(QUAD_W, QUAD_H);

    const rects = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const r = atlas.uv.get(WORDS[i % WORDS.length]);
      rects[i * 4 + 0] = r.x;
      rects[i * 4 + 1] = r.y;
      rects[i * 4 + 2] = r.w;
      rects[i * 4 + 3] = r.h;
    }
    glyphGeo.setAttribute('aUvRect', new THREE.InstancedBufferAttribute(rects, 4));

    const glyphMat = new THREE.MeshBasicMaterial({ map: atlas.texture, transparent: true, depthWrite: false });
    glyphMat.onBeforeCompile = (shader) => {
      shader.vertexShader = `attribute vec4 aUvRect;\n${shader.vertexShader}`.replace(
        '#include <uv_vertex>',
        '#include <uv_vertex>\n\t#ifdef USE_MAP\n\tvMapUv = aUvRect.xy + uv * aUvRect.zw;\n\t#endif',
      );
    };
    // Without this the patched program would collide with any other MeshBasic
    // material in the cache that happens to share its feature set.
    glyphMat.customProgramCacheKey = () => 'hero-glyph-uv-rect';

    const glyphs = createSwarm({ geometry: glyphGeo, material: glyphMat, count: n });
    sheet.add(glyphs.mesh);

    // Fixed per-instance seeds, generated once so update() allocates nothing:
    // [start x, start y, release order, drift direction].
    const seeds = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const col = i % COLS, row = Math.floor(i / COLS);
      seeds[i * 4 + 0] = (col - (COLS - 1) / 2) * COL_GAP - inkOffset(WORDS[i % WORDS.length]);
      seeds[i * 4 + 1] = TOP_Y - row * ROW_GAP;
      seeds[i * 4 + 2] = ((i * 37) % 100) / 100;
      seeds[i * 4 + 3] = (((i * 61) % 100) / 100 - 0.5) * 2;
    }

    g.userData = { doc, sheet, glyphs, seeds, n };
    return g;
  },

  update(g, p, ctx) {
    const { doc, sheet, glyphs, seeds, n } = g.userData;
    const portrait = !!(ctx && ctx.portrait);

    // Portrait's camera never runs as far down the corridor, so the page comes
    // to meet it. Read here rather than in build(), because the phone can turn
    // long after this room exists.
    doc.position.z = portrait ? PORTRAIT_Z : DOC.z;
    // ...and shrinks, because pulling the portrait camera far enough back to
    // fit a 4.8u page in a 31°-wide frustum would cost more per-frame camera
    // travel over the back half of the chapter than the rig's jump budget
    // allows (tests/cameraRig.test.js, MAX_FRAME_UNITS).
    doc.scale.setScalar(portrait ? 0.72 : 1);

    // 0.00-0.45: the page turns very slightly toward the reader as they close.
    sheet.rotation.y = lerp(0.06, 0.26, smoothstep(sub(p, 0, 0.45)));

    // 0.20-1.00: words release, one after another, and hang in the air. The
    // lateral spread narrows in portrait so nothing leaves the frame.
    const spread = portrait ? 1.0 : 1.6;
    const release = sub(p, 0.2, 1);
    for (let i = 0; i < n; i++) {
      const rel = seeds[i * 4 + 2];
      const dir = seeds[i * 4 + 3];
      const t = smoothstep(sub(release, rel * 0.55, rel * 0.55 + 0.45));
      _v.set(
        seeds[i * 4 + 0] + dir * spread * t,
        seeds[i * 4 + 1] + t * (0.25 + rel * 0.9),
        GLYPH_Z + t * (0.9 + rel * 1.9),
      );
      glyphs.setAt(i, _v, 1, dir * 0.18 * t, 1);
    }
    glyphs.commit();
  },
};
