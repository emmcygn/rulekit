// Allocation-free scalar helpers. Safe to call every frame.

export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export const lerp = (a, b, t) => a + (b - a) * t;

// Clamped 3t^2 - 2t^3.
export const smoothstep = (t) => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};

// Remap p from [a,b] to [0,1], clamped.
export const sub = (p, a, b) => clamp01((p - a) / (b - a));

// Framerate-independent lerp toward target.
export const damp = (cur, target, lambda, dt) => lerp(target, cur, Math.exp(-lambda * dt));
