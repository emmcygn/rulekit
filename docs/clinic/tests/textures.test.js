import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { makeTextTexture, makeHatchTexture, makeShadowTexture, makeGlyphAtlas, disposeTextures, HEADLESS } from '../src/lib/textures.js';
import { createMaterials, COLORS } from '../src/lib/materials.js';
import { makeContactShadow } from '../src/lib/contactShadow.js';

describe('textures are headless-safe', () => {
  it('reports headless in Node and still returns real THREE textures', () => {
    expect(HEADLESS).toBe(true);
    for (const t of [makeTextTexture('eGFR'), makeHatchTexture({}), makeShadowTexture({})]) {
      expect(t.isTexture).toBe(true);
    }
  });
  it('text textures carry an aspect ratio so quads are not stretched', () => {
    expect(typeof makeTextTexture('eGFR at least 30').userData.aspect).toBe('number');
  });
  it('memoises by key — the same request returns the same object', () => {
    expect(makeTextTexture('gte')).toBe(makeTextTexture('gte'));
    expect(makeTextTexture('gte')).not.toBe(makeTextTexture('lte'));
  });
  it('a glyph atlas maps every word to a UV rect inside the unit square', () => {
    const atlas = makeGlyphAtlas(['participants', 'eGFR', 'at', 'least', '30']);
    expect(atlas.uv.size).toBe(5);
    const r = atlas.uv.get('eGFR');
    expect(r.w).toBeGreaterThan(0);
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.x + r.w).toBeLessThanOrEqual(1.0001);
  });
});

describe('materials', () => {
  it('uses the spec palette and marks everything shared', () => {
    expect(COLORS).toEqual({ paper: 0xF4F6F8, ink: 0x1A1D21, data: 0x7FA8C9, accent: 0xE2582A, rule: 0xD8DEE4 });
    const m = createMaterials();
    for (const [name, mat] of Object.entries(m)) {
      if (typeof mat === 'function') continue;
      expect(mat.userData.shared, `${name} is not marked shared`).toBe(true);
    }
    expect(m.ink.color.getHex()).toBe(COLORS.ink);
    expect(m.data.color.getHex()).toBe(COLORS.data);
    expect(m.accent.color.getHex()).toBe(COLORS.accent);
    m.dispose();
  });
  it('no mesh built on these materials casts or receives a shadow map', () => {
    const m = createMaterials();
    const probe = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), m.bone);
    expect(probe.castShadow).toBe(false);
    expect(probe.receiveShadow).toBe(false);
    m.dispose();
  });
});

describe('contact shadow', () => {
  it('is a flat plane in XZ, not a shadow map', () => {
    const m = createMaterials();
    const s = makeContactShadow(m, { radius: 2 });
    expect(s.isMesh).toBe(true);
    expect(s.rotation.x).toBeCloseTo(-Math.PI / 2, 6);
    m.dispose();
  });
});

disposeTextures();
