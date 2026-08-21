/**
 * Operator glyphs for labels the workbench writes itself ("eGFR < 45" on a knob
 * picker). Core's own trace prose spells its comparisons out in ASCII; this map
 * is presentation only and never rewrites what the engine said.
 */
export const OP_SYMBOL = {
  eq: "=",
  neq: "≠",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
} as const satisfies Record<string, string>;

export const symbolOf = (op: string): string =>
  op in OP_SYMBOL ? OP_SYMBOL[op as keyof typeof OP_SYMBOL] : op;
