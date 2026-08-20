import { describe, expect, it } from "vitest";
import { classifyCriterion, pct, splitCriteria, tally } from "../../scripts/lib/chia.js";

/**
 * Hand-labelled criteria, all real lines from the Chia corpus or from the
 * COMMANDER HF protocol text. These pin the classifier's behaviour; they are
 * not a validation set, and the report says as much.
 */
const EXPRESSIBLE = [
  "Karnofsky Performance Status > 60",
  "Prior stroke within 90 days of randomization",
  "Serum creatinine < 1.5 mg/dL",
  "Ages Eligible for Study: 18 Years to 95 Years",
  "Must have a documented left ventricular ejection fraction of less than or equal to 40 percent",
  "Hemoglobin greater than or equal to 9 g/dL",
  // A bare code set is expressible even with no threshold and no trigger word.
  "Pregnant or lactating.",
  "Patients with symptomatic CNS metastases or leptomeningeal involvement",
];

const PARTIALLY = [
  "Patients with known brain metastases, unless these metastases have been treated and have been stable for at least six months prior to study start",
  "Any condition that, in the opinion of the investigator, would have an unacceptable risk of bleeding within 28 days of randomization",
  "Must have a life expectancy of greater than three (3) months",
  "Adequate renal function defined as serum creatinine less than 2.0 mg/dL",
  // Human authors of the COMMANDER HF pack marked E5 fully unmodeled — a plan
  // is not an event, and no extract records one. The classifier sees
  // "treatment with <drug class>" and scores it partial. Kept here as the
  // documented calibration example: the heuristic reads more optimistically
  // than a rule author does, which is the direction docs/chia-coverage.md
  // warns about.
  "Planned intermittent outpatient treatment with positive inotropic drugs administered intravenously",
  // Same story for I5: a rule author marked it unmodeled because "medically
  // stable" is a judgement, while the classifier sees the codable phrase
  // "heart failure" and scores it partial.
  "Must be medically stable in terms of their heart failure clinical status at the time of randomization",
];

const UNMODELED = [
  "Willing and able to provide written informed consent",
  "Patients who are, in the opinion of the investigator, unsuitable for the study",
];

describe("classifyCriterion", () => {
  it.each(EXPRESSIBLE)("calls a threshold-and-noun criterion expressible: %s", (text) => {
    expect(classifyCriterion(text).klass).toBe("expressible");
  });

  it.each(PARTIALLY)("calls a modelable core inside an unmodelable sentence partial: %s", (text) => {
    expect(classifyCriterion(text).klass).toBe("partially");
  });

  it.each(UNMODELED)("calls a criterion with nothing to compare unmodeled: %s", (text) => {
    expect(classifyCriterion(text).klass).toBe("unmodeled");
  });

  it("reports which signals fired, so a classification can be argued with", () => {
    const c = classifyCriterion("Prior stroke within 90 days of randomization");
    expect(c.anchors).toContain("time-window");
    expect(c.blockers).toEqual([]);
  });

  it("names the blocker on an investigator-judgement criterion", () => {
    expect(classifyCriterion(PARTIALLY[1] as string).blockers).toContain("investigator-judgement");
  });
});

describe("splitCriteria", () => {
  it("strips the BRAT trailing whitespace and drops fragments", () => {
    expect(splitCriteria("Age over 18 years \n\n  \nyes\nSerum creatinine < 1.5 mg/dL  ")).toEqual([
      "Age over 18 years",
      "Serum creatinine < 1.5 mg/dL",
    ]);
  });
});

describe("tally", () => {
  it("counts each class", () => {
    const all = [...EXPRESSIBLE, ...PARTIALLY, ...UNMODELED].map(classifyCriterion);
    expect(tally(all)).toEqual({ expressible: 8, partially: 6, unmodeled: 2 });
  });

  it("formats percentages to one decimal", () => {
    expect(pct(1, 3)).toBe("33.3");
    expect(pct(0, 0)).toBe("0.0");
  });
});
