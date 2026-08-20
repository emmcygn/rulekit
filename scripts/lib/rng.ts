/**
 * Deterministic PRNG. `Math.random` is banned everywhere in this pipeline: a
 * corpus you cannot reproduce byte-for-byte from a seed is not a fixture.
 *
 * mulberry32 — 32-bit state, good enough for shuffling and coin flips, tiny
 * enough to read. Seeded per stream (usually seed + patient id) so a patient's
 * corruption never depends on how many patients ran before it.
 */
export type Rng = {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform integer in [min, max]. */
  int(min: number, max: number): number;
  /** True with probability p. */
  chance(p: number): boolean;
  /** Uniform element of a non-empty array. */
  pick<T>(items: readonly T[]): T;
};

/** FNV-1a over a string — turns a patient id into a 32-bit seed. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function makeRng(seed: number | string): Rng {
  let a = (typeof seed === "string" ? hashString(seed) : seed >>> 0) || 0x9e3779b9;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (p) => next() < p,
    pick: <T,>(items: readonly T[]): T => {
      const item = items[Math.floor(next() * items.length)];
      if (item === undefined) throw new Error("pick() on an empty array");
      return item;
    },
  };
}

/** Seed a stream for one patient, so per-patient output is order-independent. */
export const patientRng = (seed: number, patient: string, stream = ""): Rng =>
  makeRng(`${seed}:${patient}:${stream}`);
