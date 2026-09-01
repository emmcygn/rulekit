// Chapter 01 — "The clinical side". One rule, five readings, and the bill.
//
// Five translucent copies of the same eligibility rule float in a row. They
// start stacked, so they look like one card; as they fan apart the numbers stop
// agreeing — 30 / 30 / over 30 / 30-ish / 40. Behind and below them the cost
// chart rises: two matte bars at the Tufts Phase II and Phase III medians, and
// a hatched band across both at the share judged avoidable.
//
// The bar HEIGHTS are proportional to the medians so the shape is honest; the
// figures themselves and the source line live in the HTML panel, never baked
// into the GL scene, because a number you cannot cite is decoration.
//
// ── Where the props sit, and why ──────────────────────────────────────────
// The camera runs local z ≈ +8.8 → -8.9 through this room, passing the station
// at p = 0.5, so anything at z ≈ 0 is something the camera flies through. The
// cards therefore sit at z -2.6…-4.4 and ride high at y ≈ 1.75, and the camera
// sweeps under them around p = 0.65-0.75 — and then they sweep on past it, so
// the shot is clear for the chart. The chart is pushed out to z = -11.6 and
// offset to +x, clear of the path all the way into chapter 02, where this room
// is still resident for one more station.
//
// Portrait's horizontal frustum is ~31° against landscape's ~74°, so the fan
// and the chart are both narrowed at update time (never at build time — the
// phone can turn after the room exists).

import * as THREE from 'three';
import { makeTextTexture } from '../lib/textures.js';
import { makeContactShadow } from '../lib/contactShadow.js';
import { sub, smoothstep, lerp } from '../lib/easing.js';

// The five readings of one law, and the number each one ended up with.
const COPIES = [
  { tag: 'the protocol',        num: '30' },
  { tag: 'screening sheet',     num: '30' },
  { tag: "nurse's checklist",   num: 'over 30' },
  { tag: 'training slides',     num: '30-ish' },
  { tag: 'next draft',          num: '40' },
];

const PHASE_II = 141, PHASE_III = 535, AVOIDABLE = 0.45;
const UNITS_PER_100K = 0.9;

const CARD_Y = 1.75;
const CARD_Z = -2.6, CARD_DZ = -0.45;
const CHART = { x: 1.8, y: -3.4, z: -11.6 };
const BAR_W = 0.8, BAR_GAP = 0.9;

function labelPlane(text, height, color) {
  const tex = makeTextTexture(text, { px: 72, color });
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
  return new THREE.Mesh(new THREE.PlaneGeometry(height * (tex.userData.aspect || 4), height), mat);
}

export default {
  id: '01-clinical',
  budget: { calls: 26, tris: 4000 },

  build(ctx) {
    const g = new THREE.Group();

    // Five translucent copies of the same rule. One plane geometry and one
    // border loop, five faces: both are this room's own, so both are freed with
    // the room. The glass face alone is invisible against a white ground, so
    // each copy also carries a rule-grey outline — an outline, not a tint,
    // because colour in this piece never encodes status.
    const cards = [];
    const cardGeo = new THREE.PlaneGeometry(2.6, 1.1);
    const edgeGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-1.3, -0.55, 0), new THREE.Vector3(1.3, -0.55, 0),
      new THREE.Vector3(1.3, 0.55, 0), new THREE.Vector3(-1.3, 0.55, 0),
      new THREE.Vector3(-1.3, -0.55, 0),
    ]);
    COPIES.forEach((copy, i) => {
      const card = new THREE.Group();
      card.add(new THREE.Mesh(cardGeo, ctx.materials.glass));
      card.add(new THREE.Line(edgeGeo, ctx.materials.line));
      const tag = labelPlane(copy.tag, 0.15, '#585F66');
      tag.position.set(-0.18, 0.33, 0.01);
      const num = labelPlane(copy.num, 0.34, '#1A1D21');
      num.position.set(-0.18, -0.08, 0.01);
      card.add(tag, num);
      card.position.set(0, CARD_Y, CARD_Z + i * CARD_DZ);
      g.add(card);
      cards.push(card);
    });

    // The cost chart, behind and below them: two matte bars and a hatched
    // avoidable band. The bars are unit boxes scaled on y at update time, so
    // one geometry covers both and growth costs nothing.
    const chart = new THREE.Group();
    chart.position.set(CHART.x, CHART.y, CHART.z);

    const barGeo = new THREE.BoxGeometry(BAR_W, 1, BAR_W);
    const barII = new THREE.Mesh(barGeo, ctx.materials.bone);
    const barIII = new THREE.Mesh(barGeo, ctx.materials.bone);
    barII.position.x = -BAR_GAP;
    barIII.position.x = BAR_GAP;
    chart.add(barII, barIII);

    // Hatched, not coloured: the avoidable share is a judgement, and a status
    // mark in this piece is solid, outline or hatched — never a colour.
    const band = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.14, BAR_W + 0.12), ctx.materials.hatch);
    chart.add(band);

    const floor = makeContactShadow(ctx.materials, { radius: 2.4, opacity: 0.14 });
    chart.add(floor);
    g.add(chart);

    g.userData = {
      cards, chart, barII, barIII, band,
      hII: (PHASE_II / 100) * UNITS_PER_100K,
      hIII: (PHASE_III / 100) * UNITS_PER_100K,
    };
    return g;
  },

  update(g, p, ctx) {
    const { cards, chart, barII, barIII, band, hII, hIII } = g.userData;
    const portrait = !!(ctx && ctx.portrait);

    // 0.00-0.45: the copies fan apart and their numbers separate.
    //
    // Landscape fans them sideways, which is what the beat wants — five copies
    // in a row, five different numbers. Portrait cannot: five 2.6u cards need
    // 8u of width and a 31°-wide frustum gives under 4u at this range. So
    // portrait fans them DOWN instead, using the 62° of vertical it does have.
    // Same five copies, same disagreement, turned through 90°.
    const drift = smoothstep(sub(p, 0, 0.45));
    // 0.50-0.75: having disagreed, the copies sweep past the camera and clear
    // the frame for the chart. Without this the portrait stack, which the flight
    // path goes straight through, would still be filling the shot at p = 0.8.
    const pass = smoothstep(sub(p, 0.5, 0.75)) * 8;
    const scale = portrait ? 0.72 : 1;
    for (let i = 0; i < cards.length; i++) {
      const c = cards[i];
      const k = i - 2;
      if (portrait) {
        c.position.x = lerp(0, k * 0.22, drift);
        c.position.y = lerp(CARD_Y, CARD_Y - 0.15 - k * 1.15, drift);
      } else {
        c.position.x = lerp(k * 0.5, k * 1.3, drift);
        c.position.y = CARD_Y + Math.sin(i * 1.7) * 0.25 * drift;
      }
      c.position.z = CARD_Z + i * CARD_DZ + pass;
      c.rotation.y = lerp(0, -k * 0.16, drift);
      c.scale.setScalar(scale);
    }

    chart.scale.setScalar(portrait ? 0.9 : 1);

    // 0.44-0.68: the bars rise out of the floor.
    const grow = smoothstep(sub(p, 0.44, 0.68));
    barII.scale.y = Math.max(0.001, hII * grow);
    barII.position.y = barII.scale.y / 2;
    barIII.scale.y = Math.max(0.001, hIII * grow);
    barIII.position.y = barIII.scale.y / 2;

    // 0.60-0.82: the avoidable band opens out from the centre and settles
    // across both bars at 45% of the taller one. It has to be DONE by 0.82,
    // which is where the camera key holds the whole chart in frame — past that
    // the rig starts swinging toward station 2 (HANDOFF_START = 0.88) and the
    // top of the taller bar is already leaving the top of the shot.
    const bandT = smoothstep(sub(p, 0.60, 0.82));
    band.position.y = hIII * AVOIDABLE * bandT;
    band.scale.x = Math.max(0.001, bandT);
  },
};
