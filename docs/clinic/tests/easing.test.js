import { describe, it, expect } from 'vitest';
import { clamp01, lerp, smoothstep, sub, damp } from '../src/lib/easing.js';

describe('easing', () => {
  it('clamp01 clamps both ends', () => {
    expect(clamp01(-3)).toBe(0);
    expect(clamp01(0.4)).toBe(0.4);
    expect(clamp01(9)).toBe(1);
  });
  it('smoothstep is 0/1 at the ends and 0.5 at the middle', () => {
    expect(smoothstep(0)).toBe(0);
    expect(smoothstep(1)).toBe(1);
    expect(smoothstep(0.5)).toBeCloseTo(0.5, 6);
    expect(smoothstep(-1)).toBe(0);
  });
  it('sub remaps a sub-range and clamps outside it', () => {
    expect(sub(0.25, 0.2, 0.6)).toBeCloseTo(0.125, 6);
    expect(sub(0.1, 0.2, 0.6)).toBe(0);
    expect(sub(0.9, 0.2, 0.6)).toBe(1);
  });
  it('damp converges toward the target and is framerate-independent', () => {
    const oneBig = damp(0, 1, 5, 0.1);
    let stepped = 0;
    for (let i = 0; i < 6; i++) stepped = damp(stepped, 1, 5, 0.1 / 6);
    expect(stepped).toBeCloseTo(oneBig, 6);
    expect(damp(0, 1, 5, 0.1)).toBeGreaterThan(0);
    expect(damp(0, 1, 5, 0.1)).toBeLessThan(1);
  });
  it('lerp interpolates', () => { expect(lerp(10, 20, 0.25)).toBe(12.5); });
});
