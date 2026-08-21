/**
 * The workbench's attrition module IS core's — one implementation, re-exported.
 * (This file was a temporary copy while core's `attrition.ts` landed in a
 * parallel branch; the swap documented in its header has now happened.)
 *
 * The aliases below preserve the names the workbench components were written
 * against; they are types-only renames of the core contract, never a second
 * implementation.
 */
export * from "../../../src/core/attrition.js";
export {
  attritionFrom,
  computeAttrition,
  bandOf,
  overallOf,
  isParked,
} from "../../../src/core/attrition.js";

import type { PatientBand, CriterionAttrition, Attrition as CoreAttrition } from "../../../src/core/attrition.js";

export type Band = PatientBand;
export type AttritionRow = CriterionAttrition;
export type BandedPatient = { patient: string; band: Band; evaluation: import("./api.js").Evaluation };
export type Attrition = CoreAttrition;

export const BANDS: Band[] = ["potentially-eligible", "screen-fail", "not-evaluable"];
