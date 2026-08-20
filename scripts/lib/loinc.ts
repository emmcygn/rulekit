/**
 * The LOINC codes we lift out of Synthea bundles, and the fact-name slug each
 * becomes. Anything not listed here is dropped — the fact model is a closed
 * set, so an unlisted lab has nowhere to go.
 *
 * `unit` is the canonical (UCUM) unit the normalize stage converts to; it is
 * also the unit the flatten stage emits, since Synthea is already UCUM-clean.
 */
export type LabDef = { loinc: string; slug: string; unit: string };

export const LAB_DEFS: readonly LabDef[] = [
  // Basic metabolic panel
  { loinc: "38483-4", slug: "creatinine", unit: "mg/dL" },
  { loinc: "33914-3", slug: "egfr", unit: "mL/min/{1.73_m2}" },
  { loinc: "6299-2", slug: "bun", unit: "mg/dL" },
  { loinc: "2947-0", slug: "sodium", unit: "mmol/L" },
  { loinc: "6298-4", slug: "potassium", unit: "mmol/L" },
  { loinc: "2339-0", slug: "glucose", unit: "mg/dL" },
  { loinc: "49765-1", slug: "calcium", unit: "mg/dL" },
  // Haematology
  { loinc: "718-7", slug: "hemoglobin", unit: "g/dL" },
  { loinc: "4544-3", slug: "hematocrit", unit: "%" },
  { loinc: "777-3", slug: "platelets", unit: "10*3/uL" },
  { loinc: "6690-2", slug: "wbc", unit: "10*3/uL" },
  // Liver / protein
  { loinc: "1751-7", slug: "albumin", unit: "g/dL" },
  { loinc: "1742-6", slug: "alt", unit: "U/L" },
  { loinc: "1920-8", slug: "ast", unit: "U/L" },
  { loinc: "1975-2", slug: "bilirubin_total", unit: "mg/dL" },
  // Lipids / glycaemia
  { loinc: "4548-4", slug: "hba1c", unit: "%" },
  { loinc: "2093-3", slug: "total_cholesterol", unit: "mg/dL" },
  { loinc: "18262-6", slug: "ldl", unit: "mg/dL" },
  { loinc: "2085-9", slug: "hdl", unit: "mg/dL" },
  { loinc: "2571-8", slug: "triglycerides", unit: "mg/dL" },
  // Vitals (BP arrives as components of the 55284-4 panel)
  { loinc: "8480-6", slug: "systolic_bp", unit: "mm[Hg]" },
  { loinc: "8462-4", slug: "diastolic_bp", unit: "mm[Hg]" },
  { loinc: "29463-7", slug: "weight", unit: "kg" },
  { loinc: "8302-2", slug: "height", unit: "cm" },
  { loinc: "39156-5", slug: "bmi", unit: "kg/m2" },
  // Cardiology facts Synthea does not produce; injected by the HF mutation
  // (see flatten-synthea.ts header) and listed here so the pipeline treats
  // them like any other lab.
  { loinc: "10230-1", slug: "lvef", unit: "%" },
  { loinc: "30934-4", slug: "bnp", unit: "pg/mL" },
  { loinc: "33762-6", slug: "nt_probnp", unit: "pg/mL" },
];

export const LAB_BY_LOINC = new Map(LAB_DEFS.map((d) => [d.loinc, d]));
export const LAB_BY_SLUG = new Map(LAB_DEFS.map((d) => [d.slug, d]));
