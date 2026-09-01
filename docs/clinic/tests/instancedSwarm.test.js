import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createSwarm, hideRest } from '../src/lib/instancedSwarm.js';

const geo = () => new THREE.BoxGeometry(1, 1, 1);
const mat = () => new THREE.MeshBasicMaterial();

describe('createSwarm', () => {
  it('is a single InstancedMesh - one draw call', () => {
    const s = createSwarm({ geometry: geo(), material: mat(), count: 400 });
    expect(s.mesh.isInstancedMesh).toBe(true);
    expect(s.mesh.count).toBe(400);
    expect(s.mesh.instanceMatrix.usage).toBe(THREE.DynamicDrawUsage);
    s.dispose();
  });

  it('setAt writes position, scale and rotation into the instance matrix', () => {
    const s = createSwarm({ geometry: geo(), material: mat(), count: 4 });
    s.setAt(2, new THREE.Vector3(1, 2, 3), 0.5, Math.PI / 2, 1);
    s.commit();
    const m = new THREE.Matrix4();
    s.mesh.getMatrixAt(2, m);
    const p = new THREE.Vector3().setFromMatrixPosition(m);
    expect(p.x).toBeCloseTo(1, 6);
    expect(p.z).toBeCloseTo(3, 6);
    expect(new THREE.Vector3().setFromMatrixScale(m).x).toBeCloseTo(0.5, 6);
    s.dispose();
  });

  it('opacity rides on instanceColor so no extra material is needed', () => {
    const s = createSwarm({ geometry: geo(), material: mat(), count: 2 });
    s.setAt(0, new THREE.Vector3(), 1, 0, 0.25);
    s.commit();
    const c = new THREE.Color();
    s.mesh.getColorAt(0, c);
    expect(c.r).toBeCloseTo(0.25, 3);
    s.dispose();
  });

  it('hideRest parks trailing instances at zero scale', () => {
    const s = createSwarm({ geometry: geo(), material: mat(), count: 5 });
    hideRest(s, 2);
    s.commit();
    const m = new THREE.Matrix4();
    s.mesh.getMatrixAt(4, m);
    expect(new THREE.Vector3().setFromMatrixScale(m).x).toBeCloseTo(0, 8);
    s.dispose();
  });

  it('repeated setAt stays stable and flags the buffer once', () => {
    const s = createSwarm({ geometry: geo(), material: mat(), count: 50 });
    const v = new THREE.Vector3();
    // three's BufferAttribute exposes `needsUpdate` as a setter only, so the
    // observable flag is `version`, which increments once per needsUpdate = true.
    const before = s.mesh.instanceMatrix.version;
    for (let i = 0; i < 5000; i++) s.setAt(i % 50, v.set(i, 0, 0), 1, 0, 1);
    s.commit();
    expect(s.mesh.instanceMatrix.version).toBe(before + 1);
    const m = new THREE.Matrix4();
    s.mesh.getMatrixAt(49, m);
    expect(new THREE.Vector3().setFromMatrixPosition(m).x).toBeCloseTo(4999, 3);
    s.dispose();
  });
});
