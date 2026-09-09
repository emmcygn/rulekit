// Historical R&D context, followed by protocol wording and criterion results.
// Geometry is station-local. Fixed text textures and owned fading materials
// follow the scene-manager lifecycle; orientation is handled in update().
import * as THREE from 'three';
import { createSwarm } from '../lib/instancedSwarm.js';
import { makePageTexture, makeGlyphAtlas, makeTextTexture } from '../lib/textures.js';
import { makeContactShadow } from '../lib/contactShadow.js';
import { cloneOwned } from '../lib/materials.js';
import { sub, smoothstep, lerp } from '../lib/easing.js';

const WORDS = ['participants', 'are', 'required', 'to', 'have', 'an', 'eGFR', 'of', 'at', 'least', '30', 'at', 'screening'];
const CHECKS = ['Age: at least 18', 'eGFR: at least 30', 'Medication exclusion'];
const EROOM_CAP = 'R&D spend per approval';
const CLIMB_CAP = 'Illustrative trend';
const DOC = { x: 0.9, y: 0.2, z: -8.2 };
const PORTRAIT_Z = -7.0;
const PORTRAIT_DOC_SCALE = 0.72;
const SLAB_W = 4.8, SLAB_H = 6.2, SLAB_D = 0.06;
const PAGE_RISE = 12.4;
const BURN_COLS = 7;
// A schematic, not sampled historical data. The metric and source are in the panel.
const BURN_PROFILE = [0.16, 0.26, 0.38, 0.52, 0.68, 0.84, 1.00];
const BURN_W = 4.2, BURN_H = 4.0, BURN_RECEDE_Z = 3.2;
const BURN = {
  L: { x: 2.0, y: -2.0, z: -3.5, scale: 1 },
  P: { x: 0.5, y: 0.75, z: -3.5, scale: 0.78 },
};
const CAP_SCALE_P = 1.25;
const CAP_NAME_Y = 0.56, CAP_NAME_H = 0.28;
const CAP_SUB_Y = 0.20, CAP_SUB_H = 0.20;

const COLS = 6;
const QUAD_W = 0.74, QUAD_H = 0.1727;
const COL_GAP = 0.76, ROW_GAP = 0.38;
const TOP_Y = 2.3;
const GLYPH_Z = SLAB_D / 2 + 0.02;
const PAGE_Z = SLAB_D / 2 + 0.004;
const CARD_W = 3.2, CARD_H = 1.9;
const ROW_Y = [0.22, -0.10, -0.42];   // the three check rows
const MARK_X = -1.26;                  // the mark's column, left inset
const TEXT_X = -1.03;                  // where each check line starts
const MARK = 0.20;                     // ■ □ ▨ are this square
const LINE_H = 0.19;
const CARD_Z = 0.02;                   // text and marks stand proud of the card
const LAYOUT = {
  L: {
    home: [0.20, 0.55, 1.72],
    drift: [2.05, 0, -0.80],         // leads the camera, and follows its aim
    hold: [0.60, -0.22, -4.10],
    release: [2.60, 15.29, -11.44],
    scale: 1,
  },
  P: {
    home: [-0.05, 2.45, 1.30],
    drift: [1.20, 0, -0.90],
    hold: [1.06, -0.49, -5.48],
    release: [2.99, 13.64, -8.73],
    scale: 0.72,
  },
};
const BURN_OUT = [0.22, 0.40];
const PAGE_IN = [0.18, 0.32];
const PEEL = [0.32, 0.46];
const CONVERGE = [0.38, 0.55];
const CARD_IN = [0.42, 0.55];
const LINES_IN = [0.47, 0.59];
const MARKS_IN = [0.55, 0.62];
const DRIFT = [0.42, 0.66];
const HOLD = [0.66, 0.88];
const RELEASE = [0.88, 1.00];
function inkOffset(word) {
  const f = Math.min(0.95, word.length * 0.1);
  return QUAD_W * (0.025 + f / 2 - 0.5);
}

const _v = new THREE.Vector3();
function label(text, h, color, px) {
  const tex = makeTextTexture(text, { px, color });
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(h * (tex.userData.aspect || 4), h),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 }),
  );
  return mesh;
}

export default {
  id: '00-hero',
  budget: { calls: 19, tris: 400 },

  build(ctx) {
    const g = new THREE.Group();
    const M = ctx.materials;
    const doc = new THREE.Group();
    doc.position.set(DOC.x, DOC.y, DOC.z);
    const sheet = new THREE.Group();
    doc.add(sheet);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(SLAB_W, SLAB_H, SLAB_D), M.bone);
    sheet.add(slab);

    const pageTex = makePageTexture({ w: 512, h: 660, lines: 22, seed: 7 });
    const page = new THREE.Mesh(
      new THREE.PlaneGeometry(SLAB_W, SLAB_H),
      new THREE.MeshLambertMaterial({ map: pageTex, color: 0xFFFFFF }),
    );
    page.position.z = PAGE_Z;
    sheet.add(page);

    const shadow = makeContactShadow(M, { radius: 3.2, opacity: 0.16 });
    shadow.position.set(0, -3.2, 0);
    doc.add(shadow);
    g.add(doc);
    // Seven continuous columns read as a trend; the earlier cube pile obscured it.
    const burn = new THREE.Group();
    g.add(burn);
    const burnM = cloneOwned(M.bone);
    burnM.color.setHex(0x78838F);
    burnM.transparent = true;
    const pitch = BURN_W / BURN_COLS;
    const blocks = new THREE.InstancedMesh(
      new THREE.BoxGeometry(pitch * 0.66, 1, pitch * 0.66), burnM, BURN_COLS,
    );
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < BURN_COLS; i++) {
      const h = BURN_H * BURN_PROFILE[i];
      matrix.makeScale(1, h, 1).setPosition((i - (BURN_COLS - 1) / 2) * pitch, h / 2, 0);
      blocks.setMatrixAt(i, matrix);
    }
    blocks.instanceMatrix.needsUpdate = true;
    burn.add(blocks);
    const baselineMat = cloneOwned(M.line);
    baselineMat.transparent = true;
    const baseline = new THREE.Line(new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-BURN_W / 2 - 0.16, 0, pitch / 2),
      new THREE.Vector3(BURN_W / 2 + 0.16, 0, pitch / 2),
    ]), baselineMat);
    burn.add(baseline);
    const caps = new THREE.Group();
    caps.position.y = BURN_H;
    burn.add(caps);

    const eroomCap = label(EROOM_CAP, CAP_NAME_H, '#1A1D21', 64);
    eroomCap.position.y = CAP_NAME_Y;
    caps.add(eroomCap);

    const climbCap = label(CLIMB_CAP, CAP_SUB_H, '#5A6169', 64);
    climbCap.position.y = CAP_SUB_Y;
    caps.add(climbCap);
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
    glyphMat.customProgramCacheKey = () => 'hero-glyph-uv-rect';

    const glyphs = createSwarm({ geometry: glyphGeo, material: glyphMat, count: n });
    sheet.add(glyphs.mesh);
    const seeds = new Float32Array(n * 4);
    const dest = new Float32Array(n * 2);
    const perRow = Math.max(1, Math.ceil(n / 3));
    for (let i = 0; i < n; i++) {
      const col = i % COLS, row = Math.floor(i / COLS);
      seeds[i * 4 + 0] = (col - (COLS - 1) / 2) * COL_GAP - inkOffset(WORDS[i % WORDS.length]);
      seeds[i * 4 + 1] = TOP_Y - row * ROW_GAP;
      seeds[i * 4 + 2] = ((i * 37) % 100) / 100;
      seeds[i * 4 + 3] = (((i * 61) % 100) / 100 - 0.5) * 2;

      const line = i % 3;
      const slot = Math.floor(i / 3) / Math.max(1, perRow - 1);
      dest[i * 2 + 0] = TEXT_X + 0.06 + slot * 1.86;
      dest[i * 2 + 1] = ROW_Y[line] + (seeds[i * 4 + 3]) * 0.03;
    }
    const plate = new THREE.Group();
    plate.visible = false;
    sheet.add(plate);
    const card = new THREE.Group();
    plate.add(card);
    const cardM = cloneOwned(M.bone);
    cardM.color.setHex(0xFFFFFF);
    const cardGeo = new THREE.PlaneGeometry(CARD_W, CARD_H);
    const cardMesh = new THREE.Mesh(cardGeo, cardM);
    card.add(cardMesh);
    const lineM = cloneOwned(M.line);
    lineM.color.setHex(0x1A1D21);
    const cardEdge = new THREE.LineSegments(new THREE.EdgesGeometry(cardGeo), lineM);
    cardEdge.position.z = 0.004;   // off the plane, so the border cannot z-fight it
    cardMesh.add(cardEdge);

    const lines = CHECKS.map((text, i) => {
      const m = label(text, LINE_H, '#1A1D21', 64);
      m.position.set(TEXT_X + m.geometry.parameters.width / 2, ROW_Y[i], CARD_Z);
      card.add(m);
      return m;
    });
    const marks = new THREE.Group();
    marks.visible = false;
    plate.add(marks);

    const markGeo = new THREE.PlaneGeometry(MARK, MARK);
    const markEdge = new THREE.EdgesGeometry(markGeo);
    const bodies = [
      new THREE.Mesh(markGeo, M.ink),     // ■ pass    — the ink IS the mark
      new THREE.Mesh(markGeo, M.bone),    // □ fail    — paper body, ink border
      new THREE.Mesh(markGeo, M.hatch),   // ▨ unknown — hatch body, ink border
    ];
    for (let i = 0; i < 3; i++) {
      const body = bodies[i];
      body.position.set(MARK_X, ROW_Y[i], CARD_Z);
      if (i > 0) {
        const border = new THREE.LineSegments(markEdge, lineM);
        border.position.z = 0.004;
        body.add(border);          // a child, so it scales with the mark exactly
      }
      marks.add(body);
    }

    g.userData = {
      doc, sheet, glyphs, seeds, dest, n, plate, card, cardMesh, lines, marks, bodies,
      burn, blocks, burnM, baselineMat, caps, eroomCap, climbCap,
    };
    return g;
  },

  update(g, p, ctx) {
    const u = g.userData;
    const { doc, sheet, glyphs, seeds, dest, n } = u;
    const portrait = !!(ctx && ctx.portrait);
    const A = portrait ? LAYOUT.P : LAYOUT.L;
    const B = portrait ? BURN.P : BURN.L;
    const burnOut = smoothstep(sub(p, BURN_OUT[0], BURN_OUT[1]));
    const burn = u.burn;
    burn.visible = burnOut < 0.999;
    if (burn.visible) {
      burn.position.set(B.x, B.y, B.z - BURN_RECEDE_Z * burnOut);
      burn.scale.setScalar(B.scale * (1 - 0.16 * burnOut));
      const alpha = 1 - burnOut;
      u.burnM.opacity = alpha;
      u.baselineMat.opacity = alpha;
      u.caps.scale.setScalar(portrait ? CAP_SCALE_P : 1);
      const capAlpha = alpha * alpha;
      u.eroomCap.material.opacity = capAlpha;
      u.climbCap.material.opacity = capAlpha;
    }

    doc.position.z = portrait ? PORTRAIT_Z : DOC.z;
    doc.position.y = DOC.y - PAGE_RISE * (1 - smoothstep(sub(p, PAGE_IN[0], PAGE_IN[1])));
    doc.scale.setScalar(portrait ? PORTRAIT_DOC_SCALE : 1);
    sheet.rotation.y = lerp(0.06, 0.26, smoothstep(sub(p, 0, 0.45)));
    const driftT = smoothstep(sub(p, DRIFT[0], DRIFT[1]));
    const holdT = smoothstep(sub(p, HOLD[0], HOLD[1]));
    const relT = smoothstep(sub(p, RELEASE[0], RELEASE[1]));
    const cardIn = smoothstep(sub(p, CARD_IN[0], CARD_IN[1]));
    const marksIn = smoothstep(sub(p, MARKS_IN[0], MARKS_IN[1]));

    const plate = u.plate;
    plate.position.set(
      A.home[0] + A.drift[0] * driftT + A.hold[0] * holdT + A.release[0] * relT,
      A.home[1] + A.drift[1] * driftT + A.hold[1] * holdT + A.release[1] * relT,
      A.home[2] + A.drift[2] * driftT + A.hold[2] * holdT + A.release[2] * relT,
    );
    plate.scale.setScalar(A.scale);
    plate.visible = cardIn > 0.001 && relT < 0.50;
    if (plate.visible) {
      u.card.scale.setScalar(Math.max(0.0001, cardIn));

      const lineIn = smoothstep(sub(p, LINES_IN[0], LINES_IN[1]));
      for (let i = 0; i < u.lines.length; i++) u.lines[i].material.opacity = lineIn;
      u.marks.visible = marksIn > 0.004;
      if (u.marks.visible) {
        for (let i = 0; i < u.bodies.length; i++) u.bodies[i].scale.setScalar(marksIn);
      }
    }
    const spread = portrait ? 1.0 : 1.6;
    const px = plate.position.x, py = plate.position.y, pz = plate.position.z;
    const ps = A.scale;
    for (let i = 0; i < n; i++) {
      const rel = seeds[i * 4 + 2];
      const dir = seeds[i * 4 + 3];
      const sx = seeds[i * 4 + 0];
      const sy = seeds[i * 4 + 1];

      const peel = smoothstep(sub(p, PEEL[0] + rel * 0.14, PEEL[1] + rel * 0.14));
      const conv = smoothstep(sub(p, CONVERGE[0] + rel * 0.10, CONVERGE[1] + rel * 0.10));

      const fx = sx + dir * spread;
      const fy = sy + (0.25 + rel * 0.9);
      const fz = GLYPH_Z + (0.9 + rel * 1.9);

      _v.set(
        lerp(lerp(sx, fx, peel), px + dest[i * 2 + 0] * ps, conv),
        lerp(lerp(sy, fy, peel), py + dest[i * 2 + 1] * ps, conv),
        lerp(lerp(GLYPH_Z, fz, peel), pz + (CARD_Z + 0.05) * ps, conv),
      );
      const shrink = lerp(1, 0.62 * ps, conv) * (1 - smoothstep(sub(conv, 0.68, 1)));
      glyphs.setAt(i, _v, shrink, dir * 0.18 * peel * (1 - conv), 1);
    }
    glyphs.commit();
  },
};
