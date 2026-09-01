import { describe, it, expect } from 'vitest';
import { TIERS, TIER_ORDER, detectTier, resolveTier, stepDown, createQuality, IDLE_FPS } from '../src/core/quality.js';

// sample(rafDt, workMs). A frame only counts against the tier when our own draw
// is what filled it, so every "this machine is slow" test has to say how long
// the draw took. `busy` makes a frame compute-bound, `cheap` makes it a frame
// the browser simply did not hand us any sooner.
const busy = (dt) => dt * 1000 * 0.95;
const cheap = 1.5;

describe('tier table matches the spec', () => {
  it('has the exact DPR caps and densities', () => {
    expect(TIERS.high).toMatchObject({ dprCap: 2, density: 1, antialias: true, postFx: true, blur: true });
    expect(TIERS.medium).toMatchObject({ dprCap: 1.5, density: 0.6, antialias: true, postFx: false, blur: false });
    expect(TIERS.low).toMatchObject({ dprCap: 1.25, density: 0.35, antialias: false, postFx: false, blur: false });
    expect(TIER_ORDER).toEqual(['high', 'medium', 'low']);
    expect(IDLE_FPS).toBe(12);
  });
});

describe('detectTier', () => {
  it('weak core counts go straight to low', () => {
    expect(detectTier({ dpr: 2, cores: 4, mobile: true })).toBe('low');
    expect(detectTier({ dpr: 1, cores: 2, mobile: false })).toBe('low');
  });
  it('phones and high-DPR mid machines get medium', () => {
    expect(detectTier({ dpr: 3, cores: 8, mobile: true })).toBe('medium');
    expect(detectTier({ dpr: 3, cores: 12, mobile: false })).toBe('medium');
    expect(detectTier({ dpr: 2, cores: 6, mobile: false })).toBe('medium');
  });
  it('a desktop with headroom gets high', () => {
    expect(detectTier({ dpr: 2, cores: 10, mobile: false })).toBe('high');
  });
  it('tolerates missing hints', () => {
    expect(TIER_ORDER).toContain(detectTier({}));
  });
});

describe('resolveTier (?tier=)', () => {
  it('honours every real tier name the README documents', () => {
    for (const tier of TIER_ORDER) expect(resolveTier(tier, 'high')).toBe(tier);
  });
  it('falls back to detection for a missing, empty or nonsense flag', () => {
    expect(resolveTier(null, 'medium')).toBe('medium');
    expect(resolveTier('', 'medium')).toBe('medium');
    expect(resolveTier('potato', 'medium')).toBe('medium');
    expect(resolveTier('LOW', 'high')).toBe('high');
  });
  it('is a starting point, not a floor - a forced high can still step down', () => {
    const q = createQuality(resolveTier('high', 'low'), { windowFrames: 4, cooldownFrames: 8, probeMs: 1e9 });
    expect(q.tier).toBe('high');
    for (let i = 0; i < 6; i++) q.sample(1 / 20, busy(1 / 20));
    expect(q.tier).toBe('medium');
  });
});

describe('stepDown', () => {
  it('walks one step and stops at low', () => {
    expect(stepDown('high')).toBe('medium');
    expect(stepDown('medium')).toBe('low');
    expect(stepDown('low')).toBe('low');
  });
});

describe('createQuality', () => {
  it('scales counts by density and never returns zero', () => {
    expect(createQuality('high').count(100)).toBe(100);
    expect(createQuality('medium').count(100)).toBe(60);
    expect(createQuality('low').count(100)).toBe(35);
    expect(createQuality('low').count(1)).toBe(1);
  });

  it('steps down after a sustained slow window and fires onChange once', () => {
    const q = createQuality('high');
    const seen = [];
    q.onChange((t) => seen.push(t));
    for (let i = 0; i < 90; i++) q.sample(1 / 20, busy(1 / 20));   // 20fps, all ours
    expect(q.tier).toBe('medium');
    expect(seen).toEqual(['medium']);
  });

  it('holds a cooldown before stepping again', () => {
    const q = createQuality('high');
    for (let i = 0; i < 90; i++) q.sample(1 / 20, busy(1 / 20));
    expect(q.tier).toBe('medium');
    for (let i = 0; i < 90; i++) q.sample(1 / 20, busy(1 / 20));
    expect(q.tier).toBe('medium');                    // still cooling down
    for (let i = 0; i < 180; i++) q.sample(1 / 20, busy(1 / 20));
    expect(q.tier).toBe('low');
  });

  it('never steps up', () => {
    const q = createQuality('low');
    for (let i = 0; i < 600; i++) q.sample(1 / 120, cheap);
    expect(q.tier).toBe('low');
  });

  it('probeVerdict reports fail only when low tier is still under 24fps', () => {
    const q = createQuality('low');
    for (let i = 0; i < 90; i++) q.sample(1 / 15, busy(1 / 15));
    expect(q.probeVerdict()).toBe('fail');
    const ok = createQuality('low');
    for (let i = 0; i < 90; i++) ok.sample(1 / 40, busy(1 / 40));
    expect(ok.probeVerdict()).toBe('ok');
  });

  it('settings track the current tier and never step back up', () => {
    const q = createQuality('high');
    expect(q.settings.dprCap).toBe(2);
    for (let i = 0; i < 90; i++) q.sample(1 / 20, busy(1 / 20));
    expect(q.settings.dprCap).toBe(1.5);
    expect(q.settings.antialias).toBe(true);
    for (let i = 0; i < 600; i++) q.sample(1 / 240, cheap);   // fast again
    expect(q.tier).toBe('medium');
  });

  it('a fast machine at high tier never steps down', () => {
    const q = createQuality('high');
    const seen = [];
    q.onChange((t) => seen.push(t));
    for (let i = 0; i < 600; i++) q.sample(1 / 60, 4);
    expect(q.tier).toBe('high');
    expect(seen).toEqual([]);
  });

  it('meanFps is optimistic before any samples land', () => {
    expect(createQuality('high').meanFps()).toBe(60);
    expect(createQuality('high').meanWorkMs()).toBe(0);
    expect(createQuality('high').probeVerdict()).toBe('pending');
  });

  it('takes an options object without breaking the one-argument form', () => {
    const strict = createQuality('high', { stepDownFps: 100 });
    for (let i = 0; i < 90; i++) strict.sample(1 / 60, busy(1 / 60));   // 60fps, but busy
    expect(strict.tier).toBe('medium');                                  // 60 < 100
    const lax = createQuality('high');
    for (let i = 0; i < 90; i++) lax.sample(1 / 60, busy(1 / 60));
    expect(lax.tier).toBe('high');                                       // 60 >= 45
  });
});

// The bug this whole workMs channel exists for: an occluded tab or a 30Hz panel
// hands us 33ms frames we did nothing to earn.
describe('vsync-bound vs compute-bound', () => {
  it('a 30Hz context with cheap frames does NOT step down', () => {
    const q = createQuality('high');
    const seen = [];
    q.onChange((t) => seen.push(t));
    for (let i = 0; i < 600; i++) q.sample(1 / 30, 2);   // 33.3ms apart, 2ms of work
    expect(q.tier).toBe('high');
    expect(seen).toEqual([]);
    expect(q.meanFps()).toBeCloseTo(30, 5);              // it really is 30fps
  });

  it('a 30Hz context whose frames are full of our own work DOES step down', () => {
    const q = createQuality('high');
    for (let i = 0; i < 600; i++) q.sample(1 / 30, 30);  // 33.3ms apart, 30ms of work
    expect(q.tier).toBe('low');
  });

  it('holds the line right at the work ratio', () => {
    const under = createQuality('high');
    for (let i = 0; i < 90; i++) under.sample(1 / 30, 26);   // 0.78 of a 33.3ms frame
    expect(under.tier).toBe('high');
    const over = createQuality('high');
    for (let i = 0; i < 90; i++) over.sample(1 / 30, 28);    // 0.84 of it
    expect(over.tier).toBe('medium');
  });

  it('one long stall with a cheap draw does not drag the tier down', () => {
    const q = createQuality('high');
    q.sample(2.0, 3);                                   // a 2s GC pause or tab throttle
    for (let i = 0; i < 200; i++) q.sample(1 / 60, 3);
    expect(q.tier).toBe('high');
  });

  it('meanWorkMs reports the draw cost', () => {
    const q = createQuality('high');
    for (let i = 0; i < 10; i++) q.sample(1 / 60, 5);
    expect(q.meanWorkMs()).toBeCloseTo(5, 5);
  });
});

describe('boot render probe', () => {
  it('steps down once at ~1s instead of waiting for the full window', () => {
    const q = createQuality('high');
    for (let i = 0; i < 20; i++) q.sample(1 / 30, 30);   // 0.67s in
    expect(q.tier).toBe('high');                          // probe has not fired yet
    for (let i = 0; i < 12; i++) q.sample(1 / 30, 30);   // past 1.0s
    expect(q.tier).toBe('medium');                        // ...and well short of 90 frames
  });

  it('leaves a healthy boot alone', () => {
    const q = createQuality('high');
    for (let i = 0; i < 70; i++) q.sample(1 / 60, 4);    // past 1.0s at 60fps
    expect(q.tier).toBe('high');
  });

  it('does not fire on a vsync-bound boot', () => {
    const q = createQuality('high');
    for (let i = 0; i < 40; i++) q.sample(1 / 30, 2);    // past 1.0s, throttled to 30fps
    expect(q.tier).toBe('high');
  });

  it('only ever fires once, then the cooldown owns the decision', () => {
    const q = createQuality('high');
    const seen = [];
    q.onChange((t) => seen.push(t));
    for (let i = 0; i < 120; i++) q.sample(1 / 30, 30);  // 4s of compute-bound frames
    expect(seen).toEqual(['medium']);                     // probe stepped, cooldown held
  });

  it('waits for enough frames before judging a very slow start', () => {
    const q = createQuality('high');
    q.sample(1.2, 1150);                                  // one frame, already past 1s
    expect(q.tier).toBe('high');                          // too few frames to call it
  });
});
