# LinkedIn draft

Before posting, merge and publish the prepared changes, make sure the repository is visible to the intended audience, and open the link while signed out. The draft below is not a claim that those steps have already happened.

---

When a clinical trial's eligibility criteria change, how do you work out which participants are affected, what evidence is missing, and where two reviewers might interpret the protocol differently?

I've built RuleKit to explore that problem: a working prototype that treats eligibility criteria as versioned, testable rules.

It keeps the protocol wording alongside its interpretation, checks for some kinds of contradiction, and shows how an amendment changes results in a synthetic cohort. There's also a review flow for proposed facts with source quotes: a person confirms the evidence before the rules engine uses it.

The code, demo data, and tests are in the repo. It's a prototype using synthetic data, with no clinical validation. The next step is to find out which part of this is useful in the actual workflow.

I'm looking to connect with clinical operations professionals, trial managers, and study coordinators who would be open to a short walkthrough and an honest critique. No coding or patient data needed. One public criterion that is difficult to operationalize would be a useful place to start.

If that's your world, comment or DM me with the workflow you'd want to discuss. Engineers and medtech builders interested in contributing are welcome too.

https://github.com/emmcygn/rulekit

#ClinicalTrials #ClinicalOperations #MedTech

---

Suggested attachment: [the actual workbench capture](images/workbench-amendment.png), with the synthetic-data label visible. It shows the compact amendment view. Avoid leading with the 98.3% recorded fixture score; the dataset is too small and constructed to support a broad performance claim.
