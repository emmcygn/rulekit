import { describe, it, expect } from 'vitest';
import { stepState, syncToTarget, DAMPING_LAMBDA } from '../src/core/scrollDriver.js';

const fresh = () => ({ targetGlobal: 0, global: 0, index: 0, p: 0, velocity: 0, atRest: true });

describe('stepState', () => {
  it('eases global toward targetGlobal without overshooting', () => {
    const s = fresh();
    s.targetGlobal = 1;
    stepState(s, 1 / 60);
    expect(s.global).toBeGreaterThan(0);
    expect(s.global).toBeLessThan(1);
  });

  it('settles to at-rest once the target stops moving', () => {
    const s = fresh();
    s.targetGlobal = 0.5;
    for (let i = 0; i < 600; i++) stepState(s, 1 / 60);
    expect(s.global).toBeCloseTo(0.5, 5);
    expect(s.atRest).toBe(true);
  });

  it('reports not-at-rest while catching up', () => {
    const s = fresh();
    s.targetGlobal = 0.5;
    expect(stepState(s, 1 / 60)).toBe(true);
    expect(s.atRest).toBe(false);
  });

  it('derives chapter index and per-chapter progress from global', () => {
    const s = fresh();
    s.targetGlobal = 1;
    for (let i = 0; i < 900; i++) stepState(s, 1 / 60);
    expect(s.index).toBe(10);
    expect(s.p).toBeCloseTo(1, 4);
  });

  it('uses the documented damping constant', () => {
    expect(DAMPING_LAMBDA).toBe(5);
  });

  it('allocates nothing per step: two states step independently', () => {
    const a = fresh();
    const b = fresh();
    a.targetGlobal = 1;
    b.targetGlobal = 0;
    for (let i = 0; i < 300; i++) {
      stepState(a, 1 / 60);
      stepState(b, 1 / 60);
    }
    expect(a.index).toBe(10);
    expect(b.index).toBe(0);
    expect(b.global).toBe(0);
  });
});

describe('syncToTarget (reload / scroll restoration path)', () => {
  it('snaps a mid-page start onto the target instead of flying there from 0', () => {
    // A reload with browser scroll restoration leaves targetGlobal mid-document
    // while global is still 0.
    const s = { targetGlobal: 0.5, global: 0, index: 0, p: 0, velocity: 0, atRest: true };
    syncToTarget(s);
    expect(s.global).toBe(0.5);
    expect(s.index).toBe(5);
    expect(s.p).toBeCloseTo(0.4165, 3);
    expect(s.velocity).toBe(0);
    expect(s.atRest).toBe(true);
  });

  it('stays put on the next frame — no drift after the snap', () => {
    const s = { targetGlobal: 0.5, global: 0, index: 0, p: 0, velocity: 0, atRest: true };
    syncToTarget(s);
    expect(stepState(s, 1 / 60)).toBe(false);
    expect(s.global).toBe(0.5);
    expect(s.index).toBe(5);
    expect(s.atRest).toBe(true);
  });

  it('is consistent with globalToChapter at the ends', () => {
    const top = { targetGlobal: 0, global: 0.7, index: 7, p: 0.3, velocity: 9, atRest: false };
    syncToTarget(top);
    expect(top).toMatchObject({ global: 0, index: 0, p: 0, velocity: 0, atRest: true });

    const bottom = { targetGlobal: 1, global: 0, index: 0, p: 0, velocity: 0, atRest: true };
    syncToTarget(bottom);
    expect(bottom).toMatchObject({ global: 1, index: 10, p: 1, atRest: true });
  });
});
