/**
 * Heuristic coverage classifier for the Chia corpus.
 *
 * Question it answers: of real eligibility criteria, what fraction could be
 * written in rulekit's closed condition language (ops `eq neq gt gte lt lte`,
 * `in`/`notIn`, `exists`, `anyWithin` + a day window; combinators `all`,
 * `any`, `not`)?
 *
 * How it answers it: surface patterns only. Two lists — **anchors**, the
 * features a rule needs to have something to compare (a threshold, a unit, a
 * named lab, a diagnosis, a named condition, a time window), and **blockers**,
 * the features no
 * closed language can express (investigator judgement, consent and logistics,
 * open-ended lists, intent, exception clauses). Then:
 *
 *   no anchor                 -> unmodeled
 *   anchors, no blocker       -> expressible
 *   anchors and blockers      -> partially
 *
 * What this is not: it is not a measurement of whether a rule author could
 * write the rule, and it is not validated against human labels. It reads
 * sentences, not meaning. A criterion whose every word is codable but whose
 * combination is not will be scored expressible; one that names a threshold
 * inside an unmodelable sentence will be scored partially. The number is an
 * order-of-magnitude sanity check on whether the condition language is sized
 * right — nothing stronger, and docs/chia-coverage.md says so.
 */
export type CoverageClass = "expressible" | "partially" | "unmodeled";

export type Signal = { name: string; re: RegExp };

const N = String.raw`(?:\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)`;

/** Features that give a rule something concrete to compare. */
export const ANCHORS: readonly Signal[] = [
  {
    name: "numeric-threshold",
    re: new RegExp(
      String.raw`(?:[≥≤><]=?\s*\d)|(?:(?:greater|less|more|fewer|higher|lower)\s+than(?:\s+or\s+equal\s+to)?\s+${N})|(?:at\s+least\s+${N})|(?:no\s+(?:more|less|greater)\s+than\s+${N})|(?:between\s+${N}\s+and\s+${N})|(?:\bup\s+to\s+${N})`,
      "i",
    ),
  },
  { name: "age", re: /\bage[ds]?\b|\baged\b|\byears?\s+of\s+age\b/i },
  { name: "sex", re: /\b(?:males?|females?|men|women)\b/i },
  {
    name: "unit",
    re: /\b(?:mg\/d[lL]|g\/d[lL]|mmol\/L|mEq\/L|mm\s?Hg|mL\/min|IU\/L|U\/L|pg\/m[lL]|ng\/m[lL]|10\^?9\/L|10\*9\/L|cells\/mm3|kg\/m2|mg\/kg|mm3)\b|\d\s?%/ },
  {
    name: "time-window",
    re: new RegExp(
      String.raw`within\s+(?:the\s+)?(?:last\s+|past\s+|previous\s+|prior\s+)?${N}\s*(?:day|week|month|year)s?|in\s+the\s+(?:last|past|previous)\s+${N}\s*(?:day|week|month|year)s?|${N}\s*(?:days?|weeks?|months?|years?)\s+(?:prior|before|preceding|of)`,
      "i",
    ),
  },
  { name: "diagnosis", re: /\b(?:diagnosis|diagnosed|documented|history\s+of|known|confirmed|evidence\s+of|presence\s+of)\b/i },
  {
    name: "medication",
    re: /\b(?:treatment\s+with|therapy\s+with|receiving|use\s+of|taking|on\s+(?:a\s+)?(?:stable\s+)?dose|anticoagulant|chemotherapy|antibiotic|insulin|steroid)\b/i,
  },
  {
    // Plenty of criteria are nothing but a named condition — "Pregnant or
    // lactating", "Congestive heart failure" — which is a code set and so
    // perfectly expressible, but carries none of the trigger words above.
    // Recognised morphologically plus by an open lexicon of condition stems
    // (prefix-matched, so "metasta" catches "metastases" and "metastatic").
    name: "clinical-condition",
    re: /\b\w{4,}(?:itis|[ae]emia|osis|opathy|oma|ectomy|plasia|trophy|pn[oe]ea|algia)\b|\b(?:disease|disorder|syndrome|cancer|carcinoma|tumou?r|malignan|neoplas|metasta|infect|failure|insufficien|pregnan|lactating|breast-?feeding|diabet|hypertens|hypotens|stroke|infarct|fibrillation|thromb|embol|seizure|epilep|asthma|COPD|HIV|AIDS|hepatitis|cirrhosis|dementia|depression|schizophren|psychosis|transplant|dialysis|surg|fracture|allerg|an[ae]emi|obesity|obese|bleeding|h[ae]morrhag|arrhythmia|angina|ulcer)/i,
  },
  {
    name: "named-measure",
    re: /\b(?:creatinine|h[ae]moglobin|platelet|bilirubin|ALT|AST|SGOT|SGPT|LVEF|ejection\s+fraction|BNP|eGFR|GFR|WBC|neutrophil|HbA1c|A1c|BMI|blood\s+pressure|karnofsky|ECOG|performance\s+status)\b/i,
  },
];

/** Features that no closed condition language can express. */
export const BLOCKERS: readonly Signal[] = [
  {
    name: "investigator-judgement",
    re: /\bin\s+the\s+(?:opinion|judg[e]?ment)\s+of\b|\binvestigator'?s?\s+(?:opinion|discretion|judg)|\bas\s+(?:determined|deemed|judged|assessed)\s+by\b|\bdeemed\b|\bat\s+the\s+discretion\b|\bfelt\s+to\s+be\b|\bin\s+the\s+view\s+of\b/i,
  },
  {
    name: "vague-qualifier",
    re: /\bclinically\s+(?:significant|relevant|important)\b|\b(?:adequate|inadequate|appropriate|acceptable|satisfactory|suitable|unsuitable)\b|\bwell-?controlled\b|\buncontrolled\b|\bpoorly\s+controlled\b|\bstable\b|\bmedically\s+fit\b/i,
  },
  {
    name: "consent-or-logistics",
    re: /\binformed\s+consent\b|\bwilling|\bunwilling\b|\bable\s+to\s+(?:comply|understand|attend|complete|tolerate|swallow)\b|\bcompliance\b|\bcomply\s+with\b|\bfollow-?up\b|\bquestionnaire\b|\bincarcerat|\bprisoner\b|\bgeograph|\bavailable\s+for\b|\bcaregiver\b|\btransport/i,
  },
  {
    name: "open-ended-list",
    re: /\bbut\s+not\s+limited\s+to\b|\bincluding,?\s+but\b|\bsuch\s+as\b|\betc\b|\bany\s+other\b|\bor\s+other\b|\bany\s+condition\b|\bany\s+disease\b/i,
  },
  {
    name: "intent-or-plan",
    re: /\bplanned\b|\banticipat|\bintend|\bexpected\s+to\b|\blikely\s+to\b|\bunlikely\b|\bpotential(?:ly)?\b|\bcandidate\s+for\b|\bcontemplat/i,
  },
  { name: "exception-clause", re: /\bunless\b|\bexcept\b|\bwith\s+the\s+exception\b|\bother\s+than\b/i },
  { name: "prognosis", re: /\blife\s+expectancy\b|\bprognosis\b|\bsurvival\s+of\s+at\s+least\b/i },
  { name: "interference", re: /\b(?:would|which|that|might|may)\s+(?:\w+\s+){0,3}(?:interfere|preclude|confound|compromise|jeopardi[sz]e|limit)\b/i },
];

export type Classification = {
  text: string;
  klass: CoverageClass;
  anchors: string[];
  blockers: string[];
};

export function classifyCriterion(text: string): Classification {
  const anchors = ANCHORS.filter((s) => s.re.test(text)).map((s) => s.name);
  const blockers = BLOCKERS.filter((s) => s.re.test(text)).map((s) => s.name);
  const klass: CoverageClass = anchors.length === 0 ? "unmodeled" : blockers.length === 0 ? "expressible" : "partially";
  return { text, klass, anchors, blockers };
}

/**
 * Chia ships BRAT `.txt` files, one criterion per line, with trailing spaces
 * and the occasional wrapped bullet. Lines shorter than 12 characters are
 * section headings and fragments, not criteria.
 */
export function splitCriteria(fileText: string): string[] {
  return fileText
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length >= 12);
}

export type CoverageTally = Record<CoverageClass, number>;

export function tally(classifications: readonly Classification[]): CoverageTally {
  const t: CoverageTally = { expressible: 0, partially: 0, unmodeled: 0 };
  for (const c of classifications) t[c.klass] += 1;
  return t;
}

export const pct = (n: number, total: number): string => (total === 0 ? "0.0" : ((n / total) * 100).toFixed(1));
