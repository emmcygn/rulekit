// The scene manager is the memory ceiling for the whole piece: eleven rooms
// exist on paper, at most three exist in GPU memory. These tests pin the three
// things that can go wrong — building too much, disposing something shared, and
// leaking across a full scroll.

import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { residency, disposeGroup, createSceneManager } from '../src/core/sceneManager.js';
import { createMaterials, cloneOwned } from '../src/lib/materials.js';
import { makeContactShadow } from '../src/lib/contactShadow.js';
import { makeTextTexture, makeShadowTexture } from '../src/lib/textures.js';
import { createQuality } from '../src/core/quality.js';
import { CHAPTERS } from '../src/core/chapters.js';
import MODULES from '../src/scenes/index.js';

describe('residency', () => {
  it('keeps the current room plus one on each side', () => {
    expect(residency(5, 11)).toEqual([4, 5, 6]);
  });
  it('clips at both ends', () => {
    expect(residency(0, 11)).toEqual([0, 1]);
    expect(residency(10, 11)).toEqual([9, 10]);
  });
  it('never asks for more than three rooms at any station', () => {
    for (let i = 0; i < CHAPTERS.length; i++) {
      expect(residency(i, CHAPTERS.length).length).toBeLessThanOrEqual(3);
    }
  });
});

describe('disposeGroup', () => {
  it('disposes owned geometry and materials but never shared ones', () => {
    const shared = new THREE.MeshBasicMaterial();
    shared.userData.shared = true;
    const owned = new THREE.MeshBasicMaterial({ map: new THREE.DataTexture(new Uint8Array(4), 1, 1) });
    const g = new THREE.Group();
    const a = new THREE.Mesh(new THREE.BoxGeometry(), shared);
    const b = new THREE.Mesh(new THREE.BoxGeometry(), owned);
    g.add(a, b);
    const sharedSpy = vi.spyOn(shared, 'dispose');
    const ownedSpy = vi.spyOn(owned, 'dispose');
    const geoSpy = vi.spyOn(a.geometry, 'dispose');
    const texSpy = vi.spyOn(owned.map, 'dispose');
    disposeGroup(g);
    expect(sharedSpy).not.toHaveBeenCalled();
    expect(ownedSpy).toHaveBeenCalled();
    expect(geoSpy).toHaveBeenCalled();
    expect(texSpy).toHaveBeenCalled();
  });

  it('leaves geometry marked userData.shared alone — the contact shadow plane is one plane forever', () => {
    const mats = createMaterials();
    const shadow = makeContactShadow(mats, { radius: 2 });
    const g = new THREE.Group();
    g.add(shadow);
    const geoSpy = vi.spyOn(shadow.geometry, 'dispose');
    const matSpy = vi.spyOn(shadow.material, 'dispose');
    disposeGroup(g);
    expect(geoSpy).not.toHaveBeenCalled();   // shared plane, reused by every room
    expect(matSpy).toHaveBeenCalled();       // the clone is this room's own
    mats.dispose();
  });

  it('never disposes a texture out of the module cache, even off an owned material', () => {
    const cached = makeShadowTexture({});
    const owned = new THREE.MeshBasicMaterial({ map: cached });
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), owned));
    const texSpy = vi.spyOn(cached, 'dispose');
    disposeGroup(g);
    expect(texSpy).not.toHaveBeenCalled();
  });
});

// The trap this guards: Material.copy() deep-copies userData, so a plain
// .clone() of a shared material comes back claiming to be shared and the
// manager will never free it — one leaked material per build/drop cycle.
describe('cloneOwned', () => {
  it('a plain .clone() inherits userData.shared, which is exactly the bug', () => {
    const mats = createMaterials();
    expect(mats.bone.clone().userData.shared).toBe(true);
    mats.dispose();
  });

  it('cloneOwned hands back a clone the room owns', () => {
    const mats = createMaterials();
    const c = cloneOwned(mats.bone);
    expect(c).not.toBe(mats.bone);
    expect(c.userData.shared).toBe(false);
    expect(c.color.getHex()).toBe(mats.bone.color.getHex());
    mats.dispose();
  });

  it('a cloneOwned material is actually disposed with its room', () => {
    const mats = createMaterials();
    const c = cloneOwned(mats.bone);
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.BoxGeometry(), c));
    const spy = vi.spyOn(c, 'dispose');
    const sharedSpy = vi.spyOn(mats.bone, 'dispose');
    disposeGroup(g);
    expect(spy).toHaveBeenCalled();
    expect(sharedSpy).not.toHaveBeenCalled();
    mats.dispose();
  });
});

describe('the scene module contract', () => {
  it('has a module for every chapter, keyed by its own id', () => {
    expect(Object.keys(MODULES).sort()).toEqual(CHAPTERS.map((c) => c.id).sort());
    for (const c of CHAPTERS) {
      const mod = MODULES[c.id];
      expect(mod.id).toBe(c.id);
      expect(typeof mod.build).toBe('function');
      expect(typeof mod.update).toBe('function');
    }
  });

  it('declares a budget inside the per-room ceiling', () => {
    for (const c of CHAPTERS) {
      const b = MODULES[c.id].budget;
      expect(b.calls, `${c.id} calls`).toBeLessThanOrEqual(90);
      expect(b.tris, `${c.id} tris`).toBeLessThanOrEqual(150000);
    }
  });

  // The catch-all for all eight parallel scene implementers: the only materials
  // allowed to claim userData.shared are the nine identity-equal ones out of
  // createMaterials(). Anything else claiming it is a .clone() that should have
  // been a cloneOwned(), and it will never be freed.
  it('no built room contains a material claiming to be shared that is not one of the nine', () => {
    const mats = createMaterials();
    const nine = new Set(Object.values(mats).filter((m) => typeof m !== 'function'));
    expect(nine.size).toBe(9);
    const quality = createQuality('high');

    for (let i = 0; i < CHAPTERS.length; i++) {
      const chapter = CHAPTERS[i];
      const ctx = { THREE, quality, materials: mats, portrait: false, station: new THREE.Vector3(), chapter };
      const g = MODULES[chapter.id].build(ctx);
      g.traverse((o) => {
        const list = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
        for (const m of list) {
          if (m.userData.shared !== true) continue;
          expect(
            nine.has(m),
            `${chapter.id}: material "${m.name || m.type}" is marked shared but is not one of the nine — use cloneOwned() instead of .clone()`,
          ).toBe(true);
        }
      });
      disposeGroup(g);
    }
    mats.dispose();
  });

  it('builds and updates every real module without a WebGL context', () => {
    const mats = createMaterials();
    const quality = createQuality('high');
    for (let i = 0; i < CHAPTERS.length; i++) {
      const chapter = CHAPTERS[i];
      const mod = MODULES[chapter.id];
      const ctx = { THREE, quality, materials: mats, portrait: false, station: new THREE.Vector3(), chapter };
      const g = mod.build(ctx);
      expect(g.isGroup, `${chapter.id} build() must return a Group`).toBe(true);
      mod.update(g, 0, ctx);
      mod.update(g, 1, ctx);
      disposeGroup(g);
    }
    mats.dispose();
  });
});

describe('createSceneManager', () => {
  const stubModule = (id) => ({
    id,
    budget: { calls: 1, tris: 10 },
    built: 0, updated: 0, disposed: 0,
    build(ctx) {
      this.built++;
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.BoxGeometry(), ctx.materials.bone));
      return g;
    },
    update() { this.updated++; },
    dispose() { this.disposed++; },
  });

  const setup = () => {
    const scene = new THREE.Scene();
    const modules = Object.fromEntries(CHAPTERS.map((c) => [c.id, stubModule(c.id)]));
    const mgr = createSceneManager({
      scene, modules, materials: createMaterials(), quality: createQuality('high'), portrait: false,
    });
    return { scene, modules, mgr };
  };

  it('builds only the current room and its neighbours', () => {
    const { modules, mgr } = setup();
    mgr.update({ index: 0, p: 0 });
    expect(mgr.stats().built).toEqual(['00-hero', '01-clinical']);
    expect(modules['02-engine'].built).toBe(0);
  });

  it('places each room at its own station', () => {
    const { scene, mgr } = setup();
    mgr.update({ index: 3, p: 0.5 });
    const room = scene.children.find((c) => c.userData.chapterId === '04-three');
    expect(room.position.z).toBeCloseTo(-71.0, 4);
  });

  it('disposes the room two stations behind and never rebuilds a resident one', () => {
    const { modules, mgr } = setup();
    mgr.update({ index: 0, p: 0 });
    mgr.update({ index: 1, p: 0 });
    mgr.update({ index: 2, p: 0 });
    expect(modules['00-hero'].disposed).toBe(1);
    expect(modules['01-clinical'].built).toBe(1);
    expect(mgr.stats().built).toEqual(['01-clinical', '02-engine', '03-compile']);
  });

  // A neighbour room is visible before it is current — 18u away against fog
  // that reaches 26 — so it has to be posed for the side you will approach it
  // from, or it snaps the instant the chapter changes.
  it('poses a room the moment it is built: ahead at p=0, behind at p=1', () => {
    const { modules, mgr } = setup();
    const seen = [];
    for (const c of CHAPTERS) modules[c.id].update = (group, p) => { seen.push([c.id, p]); };
    mgr.update({ index: 5, p: 0.3 });
    expect(seen).toEqual([
      ['04-three', 1],      // behind: left in its closing pose
      ['05-clash', 0],      // the build pose for the current room...
      ['06-chasm', 0],      // ahead: left in its opening pose
      ['05-clash', 0.3],    // ...immediately superseded by the real progress
    ]);
  });

  it('poses a room built ahead of you at p=0 as you walk forward', () => {
    const { modules, mgr } = setup();
    mgr.update({ index: 5, p: 0.9 });
    const seen = [];
    modules['07-ai'].update = (group, p) => { seen.push(p); };
    mgr.update({ index: 6, p: 0.05 });   // 07-ai is newly resident, ahead
    expect(seen).toEqual([0]);
  });

  it('poses a room built behind you at p=1 when you scroll back up', () => {
    const { modules, mgr } = setup();
    mgr.update({ index: 5, p: 0 });
    const seen = [];
    modules['03-compile'].update = (group, p) => { seen.push(p); };
    mgr.update({ index: 4, p: 0.9 });    // 03-compile is newly resident, behind
    expect(seen).toEqual([1]);
  });

  it('updates only the current chapter, with its own progress', () => {
    const { modules, mgr } = setup();
    mgr.update({ index: 4, p: 0.25 });
    // Each of 3/4/5 was posed once on build; 04-three then got the real p.
    expect(modules['04-three'].updated).toBe(2);
    expect(modules['05-clash'].updated).toBe(1);
    const before = modules['05-clash'].updated;
    mgr.update({ index: 4, p: 0.5 });
    expect(modules['04-three'].updated).toBe(3);
    expect(modules['05-clash'].updated).toBe(before);   // neighbours stay frozen
  });

  it('hands update() the chapter progress, not the global one', () => {
    const { modules, mgr } = setup();
    const seen = [];
    modules['06-chasm'].update = (group, p) => { seen.push(p); };
    mgr.update({ index: 6, p: 0.75 });
    expect(seen).toEqual([0, 0.75]);    // build pose, then the real progress
  });

  it('reuses one ctx per room so the frame path allocates nothing', () => {
    const { modules, mgr } = setup();
    const seen = [];
    modules['02-engine'].update = (group, p, ctx) => { seen.push(ctx); };
    mgr.update({ index: 2, p: 0 });
    mgr.update({ index: 2, p: 0.5 });
    expect(seen).toHaveLength(3);       // build pose + two frames
    for (const ctx of seen) expect(ctx).toBe(seen[0]);
  });

  it('an orientation flip reaches rooms that are already built', () => {
    const { modules, mgr } = setup();
    let last = null;
    modules['02-engine'].update = (group, p, ctx) => { last = ctx.portrait; };
    mgr.update({ index: 2, p: 0 });
    expect(last).toBe(false);
    mgr.setPortrait(true);
    mgr.update({ index: 2, p: 0 });
    expect(last).toBe(true);
  });

  it('disposeAll empties the scene of rooms', () => {
    const { scene, mgr } = setup();
    mgr.update({ index: 5, p: 0 });
    mgr.disposeAll();
    expect(scene.children.filter((c) => c.userData.chapterId)).toHaveLength(0);
  });
});

// The leak proof. Rooms are built and dropped hundreds of times over one
// session; if a single geometry or texture survives its room, the tab dies on
// the third scroll. Baseline in, baseline out.
describe('build/dispose cycling is leak-free', () => {
  function tracked() {
    const geo = new Set();
    const tex = new Set();
    return {
      geo(g) { geo.add(g); g.addEventListener('dispose', () => geo.delete(g)); return g; },
      tex(t) { tex.add(t); t.addEventListener('dispose', () => tex.delete(t)); return t; },
      counts: () => ({ geo: geo.size, tex: tex.size }),
    };
  }

  it('returns geometry and texture counts to baseline after a full 0 -> 10 -> 0 sweep', () => {
    const track = tracked();
    const scene = new THREE.Scene();
    const materials = createMaterials();
    let peak = 0;

    const modules = Object.fromEntries(CHAPTERS.map((c) => [c.id, {
      id: c.id,
      budget: { calls: 4, tris: 200 },
      build(ctx) {
        const g = new THREE.Group();
        // owned geometry + owned material carrying an owned texture
        const map = track.tex(new THREE.DataTexture(new Uint8Array(4), 1, 1));
        map.needsUpdate = true;
        g.add(new THREE.Mesh(track.geo(new THREE.BoxGeometry()), new THREE.MeshBasicMaterial({ map })));
        // shared material, owned geometry
        g.add(new THREE.Mesh(track.geo(new THREE.PlaneGeometry(1, 1)), ctx.materials.bone));
        // shared geometry, owned (cloned) material holding a cached texture
        g.add(makeContactShadow(ctx.materials, { radius: 1 }));
        return g;
      },
      update() {},
    }]));

    const mgr = createSceneManager({
      scene, modules, materials, quality: createQuality('high'), portrait: false,
    });

    const baseline = track.counts();
    expect(baseline).toEqual({ geo: 0, tex: 0 });

    const cachedShadow = makeShadowTexture({});
    const cachedText = makeTextTexture('00-hero', { px: 96 });
    const shadowSpy = vi.spyOn(cachedShadow, 'dispose');
    const textSpy = vi.spyOn(cachedText, 'dispose');

    const sweep = (from, to) => {
      const step = from <= to ? 1 : -1;
      for (let i = from; step > 0 ? i <= to : i >= to; i += step) {
        for (const p of [0, 0.5, 1]) mgr.update({ index: i, p });
        const n = mgr.stats().built.length;
        peak = Math.max(peak, n);
        expect(n).toBeLessThanOrEqual(3);
      }
    };
    sweep(0, 10);
    sweep(10, 0);
    sweep(0, 10);

    expect(peak).toBe(3);
    mgr.disposeAll();

    expect(track.counts()).toEqual(baseline);
    expect(scene.children.filter((c) => c.userData.chapterId)).toHaveLength(0);

    // The module texture cache outlives every room.
    expect(shadowSpy).not.toHaveBeenCalled();
    expect(textSpy).not.toHaveBeenCalled();
    expect(makeShadowTexture({})).toBe(cachedShadow);
    expect(makeTextTexture('00-hero', { px: 96 })).toBe(cachedText);

    materials.dispose();
  });

  it('cycles the real stub modules through the whole journey without growth', () => {
    const scene = new THREE.Scene();
    const materials = createMaterials();
    const mgr = createSceneManager({
      scene, modules: MODULES, materials, quality: createQuality('low'), portrait: true,
    });
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i <= 10; i++) mgr.update({ index: i, p: 0.5 });
      for (let i = 10; i >= 0; i--) mgr.update({ index: i, p: 0.5 });
      expect(scene.children.filter((c) => c.userData.chapterId).length).toBeLessThanOrEqual(3);
    }
    mgr.disposeAll();
    expect(scene.children).toHaveLength(0);
    materials.dispose();
  });
});
