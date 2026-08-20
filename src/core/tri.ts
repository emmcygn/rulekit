export type Tri = "true" | "false" | "unknown";

export function andTri(xs: Tri[]): Tri {
  if (xs.includes("false")) return "false";
  if (xs.includes("unknown")) return "unknown";
  return "true";
}

export function orTri(xs: Tri[]): Tri {
  if (xs.includes("true")) return "true";
  if (xs.includes("unknown")) return "unknown";
  return "false";
}

export function notTri(x: Tri): Tri {
  if (x === "true") return "false";
  if (x === "false") return "true";
  return "unknown";
}
