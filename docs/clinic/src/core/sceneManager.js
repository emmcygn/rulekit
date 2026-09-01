// Room residency. Eleven chapters exist on paper; at most three exist in GPU
// memory. The manager builds the room ahead of you before you arrive and drops
// the one two stations behind after you have left, so peak cost is three rooms
// no matter how long the scroll is.
//
// The stations are ~18 units apart and the fog runs near 8 / far 26, so both
// edges of that window sit inside solid fog: the room being built and the room
// being dropped are never visible when they change state.
//
// Ownership is the whole game here. `createMaterials()` hands out nine shared
// materials and `src/lib/textures.js` memoises every texture in a module-level
// cache; both outlive any room. A room owns only what its own build() made.
// The marker is `userData.shared` — on materials, on geometries (the contact
// shadow's one PlaneGeometry) and on textures. Anything carrying it is
// somebody else's, and this file never disposes it. In particular the module
// texture cache is only ever freed by `disposeTextures()`, which is a teardown
// call, never part of the room lifecycle.
//
// DEVIATION FROM SPEC §8, ruled on deliberately. The spec says the manager
// "disposes textures one station behind". It does not, and it should not: the
// memoised cache in src/lib/textures.js is kept for the life of the page.
//   - It is bounded, not a leak. Every entry is keyed by its bake parameters, so
//     the set is finite and known: ~20.2MB of base texture data once the whole
//     journey has been walked, which is the ceiling, not a rate.
//   - Dropping it would trade that flat 20MB for re-baking canvases on every
//     backscroll — the same textures, redrawn, on the frame a room is built,
//     which is exactly the frame that cannot afford it.
// So §8's sentence is superseded for the SHARED cache only. Room-owned textures
// are unaffected and still die with their room, one station behind, via
// disposeGroup() below.

import * as THREE from 'three';
import { CHAPTERS } from './chapters.js';
import { stationVec } from './cameraRig.js';

// Which station indices should be built when you are standing at `index`.
// `residencyInto` writes into an array you own, so the frame path allocates
// nothing; `residency` is the allocating one-shot form the tests read.
export function residencyInto(index, total, out) {
  out.length = 0;
  for (let i = index - 1; i <= index + 1; i++) if (i >= 0 && i < total) out.push(i);
  return out;
}

export function residency(index, total) {
  return residencyInto(index, total, []);
}

const MAP_KEYS = ['map', 'alphaMap', 'emissiveMap', 'bumpMap', 'aoMap', 'normalMap'];

function disposeMaterial(mat) {
  if (!mat || mat.userData.shared) return;
  for (const key of MAP_KEYS) {
    const tex = mat[key];
    // A room can hang a cached texture off a material it owns — the contact
    // shadow clone does exactly that. The material dies with the room; the
    // texture does not.
    if (tex && tex.dispose && !tex.userData.shared) tex.dispose();
  }
  mat.dispose();
}

// Traverses the room and frees everything the room itself made: geometries,
// materials, and the textures those materials own. Runs after the module's own
// optional dispose(), so a module only has to handle things this cannot see
// (timers, listeners, references it parked outside the group).
export function disposeGroup(group) {
  group.traverse((o) => {
    if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
    if (Array.isArray(o.material)) o.material.forEach(disposeMaterial);
    else if (o.material) disposeMaterial(o.material);
    if (o.isInstancedMesh) o.dispose();
  });
  group.clear();
}

export function createSceneManager({ scene, modules, materials, quality, portrait }) {
  let isPortrait = !!portrait;
  const live = new Map();   // chapterId -> { group, module, station, ctx }
  // Same keys as `live`, as a plain array. Iterating a Map allocates an
  // iterator every time; this path runs every frame, so it iterates by index.
  const liveIds = [];
  const wantIdx = [];       // scratch, reused every frame
  const doomed = [];        // scratch, reused every frame

  // One ctx object per resident room, reused every frame: update() runs on the
  // frame path and must not allocate.
  //
  // `currentIndex` is where the camera is standing, and it decides the pose the
  // new room is left in. Stations are 18u apart against fog that reaches 26, so
  // a neighbour is often visible before it becomes current; left in whatever
  // pose build() happened to leave, it would snap the instant the chapter
  // changed. A room ahead of you is posed at p=0 (its opening state, which is
  // what you approach) and a room behind you at p=1 (its closing state, which
  // is what you are walking away from).
  function build(i, currentIndex) {
    const chapter = CHAPTERS[i];
    const mod = modules[chapter.id];
    if (!mod) throw new Error(`no scene module for ${chapter.id}`);
    const station = stationVec(i);
    const ctx = { THREE, quality, materials, portrait: isPortrait, station, chapter };
    const group = mod.build(ctx);
    // Scenes are authored in station-local space; the manager is what puts the
    // room where it belongs on the spline.
    group.position.copy(station);
    group.userData.chapterId = chapter.id;
    scene.add(group);
    live.set(chapter.id, { group, module: mod, station, ctx });
    liveIds.push(chapter.id);
    mod.update(group, i < currentIndex ? 1 : 0, ctx);
  }

  function drop(id) {
    const entry = live.get(id);
    if (!entry) return;
    scene.remove(entry.group);
    // The module's own dispose() first — it may still need the group intact —
    // then the generic sweep, which is what actually frees GPU memory.
    if (entry.module.dispose) entry.module.dispose(entry.group);
    disposeGroup(entry.group);
    live.delete(id);
    liveIds.splice(liveIds.indexOf(id), 1);
  }

  function update(state) {
    residencyInto(state.index, CHAPTERS.length, wantIdx);
    // Drop first, build second: peak residency stays at three rather than
    // touching four for the length of one frame.
    doomed.length = 0;
    for (let j = 0; j < liveIds.length; j++) {
      const id = liveIds[j];
      let keep = false;
      for (let k = 0; k < wantIdx.length; k++) if (CHAPTERS[wantIdx[k]].id === id) { keep = true; break; }
      if (!keep) doomed.push(id);
    }
    for (let k = 0; k < doomed.length; k++) drop(doomed[k]);
    for (let k = 0; k < wantIdx.length; k++) {
      const i = wantIdx[k];
      if (!live.has(CHAPTERS[i].id)) build(i, state.index);
    }

    // Only the chapter you are standing in animates. The neighbours are built
    // and posed but frozen — they are there so arrival costs nothing.
    const current = live.get(CHAPTERS[state.index].id);
    if (current) current.module.update(current.group, state.p, current.ctx);
  }

  return {
    update,
    // Orientation flips mid-session. Rooms already built keep their ctx object
    // (update() must not allocate a fresh one every frame), so the flag is
    // rewritten in place rather than rebuilt.
    setPortrait(v) {
      isPortrait = !!v;
      for (let j = 0; j < liveIds.length; j++) live.get(liveIds[j]).ctx.portrait = isPortrait;
    },
    // Read by the HUD 4x/second, never per frame, so the copy is free.
    stats: () => ({ built: liveIds.slice().sort() }),
    disposeAll() { while (liveIds.length) drop(liveIds[0]); },
  };
}
