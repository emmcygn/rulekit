export type Interval = { lo: number; hi: number; loOpen: boolean; hiOpen: boolean };

export const FULL: Interval = { lo: -Infinity, hi: Infinity, loOpen: true, hiOpen: true };

export function fromLeaf(op: "eq" | "gt" | "gte" | "lt" | "lte", value: number): Interval {
  switch (op) {
    case "eq": return { lo: value, hi: value, loOpen: false, hiOpen: false };
    case "gt": return { lo: value, hi: Infinity, loOpen: true, hiOpen: true };
    case "gte": return { lo: value, hi: Infinity, loOpen: false, hiOpen: true };
    case "lt": return { lo: -Infinity, hi: value, loOpen: true, hiOpen: true };
    case "lte": return { lo: -Infinity, hi: value, loOpen: true, hiOpen: false };
  }
}

export function intersect(a: Interval, b: Interval): Interval {
  const lo = Math.max(a.lo, b.lo);
  const hi = Math.min(a.hi, b.hi);
  const loOpen = a.lo === b.lo ? a.loOpen || b.loOpen : lo === a.lo ? a.loOpen : b.loOpen;
  const hiOpen = a.hi === b.hi ? a.hiOpen || b.hiOpen : hi === a.hi ? a.hiOpen : b.hiOpen;
  return { lo, hi, loOpen, hiOpen };
}

export function isEmpty(i: Interval): boolean {
  if (i.lo > i.hi) return true;
  if (i.lo === i.hi) return i.loOpen || i.hiOpen;
  return false;
}

export function isFull(i: Interval): boolean {
  return i.lo === -Infinity && i.hi === Infinity;
}

export function fmtInterval(i: Interval): string {
  const lo = i.lo === -Infinity ? "−∞" : String(i.lo);
  const hi = i.hi === Infinity ? "∞" : String(i.hi);
  return `${i.loOpen || i.lo === -Infinity ? "(" : "["}${lo}, ${hi}${i.hiOpen || i.hi === Infinity ? ")" : "]"}`;
}
