// Copied eligibility criteria, then median direct amendment implementation costs.
// Bar heights encode dollars only. The share of amendments judged avoidable is
// separate source context in the panel, not a share of either cost bar.
import * as THREE from 'three';
import { makeTextTexture } from '../lib/textures.js';
import { makeContactShadow } from '../lib/contactShadow.js';
import { cloneOwned } from '../lib/materials.js';
import { sub, smoothstep, lerp } from '../lib/easing.js';
const COPIES = [
  { tag: 'Protocol',            num: 'at least 30' },
  { tag: 'Screening sheet',     num: 'at least 30' },
  { tag: 'Site checklist',      num: 'over 30' },
  { tag: 'Training slides',     num: '30' },
  { tag: 'Amendment draft',     num: 'at least 40' },
];

const PHASE_II = 141, PHASE_III = 535;
const UNITS_PER_100K = 0.9;

const CARD_Y = 1.75;
const CARD_Z = -2.6, CARD_DZ = -0.45;
const CHART = { x: 0.5, y: -2.4, z: -13.6 };
const BAR_W = 1.25, BAR_GAP = 1.12;
const PORTRAIT_CHART = 0.74;

function labelPlane(text, height, color) {
  const tex = makeTextTexture(text, { px: 72, color });
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
  return new THREE.Mesh(new THREE.PlaneGeometry(height * (tex.userData.aspect || 4), height), mat);
}

export default {
  id: '01-clinical',
  budget: { calls: 28, tris: 80 },

  build(ctx) {
    const g = new THREE.Group();
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
    const chart = new THREE.Group();
    chart.position.set(CHART.x, CHART.y, CHART.z);

    const hII = (PHASE_II / 100) * UNITS_PER_100K;
    const hIII = (PHASE_III / 100) * UNITS_PER_100K;
    const barGeo = new THREE.BoxGeometry(BAR_W, 1, BAR_W);
    const barMaterial = cloneOwned(ctx.materials.bone);
    barMaterial.color.setHex(0x626F7C);
    const barII = new THREE.Mesh(barGeo, barMaterial);
    const barIII = new THREE.Mesh(barGeo, barMaterial);
    barII.position.x = -BAR_GAP;
    barIII.position.x = BAR_GAP;
    chart.add(barII, barIII);
    const base = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-BAR_GAP - BAR_W, 0, BAR_W / 2),
        new THREE.Vector3(BAR_GAP + BAR_W, 0, BAR_W / 2),
      ]),
      ctx.materials.line,
    );
    chart.add(base);
    const labII = labelPlane('Phase II', 0.3, '#585F66');
    labII.position.set(-BAR_GAP, -0.34, BAR_W / 2 + 0.02);
    labII.material.opacity = 0;
    const labIII = labelPlane('Phase III', 0.3, '#585F66');
    labIII.position.set(BAR_GAP, -0.34, BAR_W / 2 + 0.02);
    labIII.material.opacity = 0;
    const costII = labelPlane('$141K', 0.30, '#FFFFFF');
    const costIII = labelPlane('$535K', 0.30, '#FFFFFF');
    costII.position.set(-BAR_GAP, hII - 0.35, BAR_W / 2 + 0.02);
    costIII.position.set(BAR_GAP, hIII - 0.35, BAR_W / 2 + 0.02);
    chart.add(labII, labIII, costII, costIII);

    const floor = makeContactShadow(ctx.materials, { radius: 2.9, opacity: 0.16 });
    chart.add(floor);
    g.add(chart);

    g.userData = { cards, chart, barII, barIII, labII, labIII, costII, costIII, hII, hIII };
    return g;
  },

  update(g, p, ctx) {
    const { cards, chart, barII, barIII, labII, labIII, costII, costIII, hII, hIII } = g.userData;
    const portrait = !!(ctx && ctx.portrait);
    const drift = smoothstep(sub(p, 0, 0.31));
    const clear = smoothstep(sub(p, 0.28, 0.52));
    const scale = (portrait ? 0.72 : 1) * (1 - 0.67 * clear);
    for (let i = 0; i < cards.length; i++) {
      const c = cards[i];
      const k = i - 2;
      if (portrait) {
        c.position.x = lerp(0, k * 0.22, drift);
        c.position.y = lerp(CARD_Y, CARD_Y - 0.15 - k * 1.15, drift) + clear * 3.2;
      } else {
        c.position.x = lerp(k * 0.5, k * 1.3, drift);
        c.position.y = CARD_Y + Math.sin(i * 1.7) * 0.25 * drift + clear * 3.2;
      }
      c.position.z = CARD_Z + i * CARD_DZ + clear * 9;
      c.rotation.y = lerp(0, -k * 0.16, drift);
      c.scale.setScalar(scale);
    }

    chart.scale.setScalar(portrait ? PORTRAIT_CHART : 0.95);
    const grow = smoothstep(sub(p, 0.34, 0.58));
    barII.scale.y = Math.max(0.001, hII * grow);
    barII.position.y = barII.scale.y / 2;
    barIII.scale.y = Math.max(0.001, hIII * grow);
    barIII.position.y = barIII.scale.y / 2;
    labII.material.opacity = grow;
    labIII.material.opacity = grow;
    costII.material.opacity = grow;
    costIII.material.opacity = grow;
  },
};
