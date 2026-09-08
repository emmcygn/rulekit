# Help shape RuleKit with clinical operations experience

I'm looking for clinical operations professionals, trial managers, study coordinators, and people who review eligibility criteria to help decide where this prototype would actually be useful.

RuleKit makes protocol rules inspectable: keep the original wording, record an explicit interpretation, test boundary cases, and compare how an amendment changes results in a synthetic cohort. The software exists. The workflow and usefulness need to be challenged by people who do this work.

**You do not need to code, share patient records, or commit to an ongoing project to start.** A first contribution could be one conversation or a review of one public criterion. This is an invitation to exploratory collaboration; any ongoing role or commercial arrangement would be discussed separately.

## A useful first conversation

An initial 30-minute walkthrough could cover:

1. **Your workflow:** where an eligibility interpretation or amendment creates repeated manual work, uncertainty, or disagreement.
2. **One public example:** a criterion that is difficult to operationalize, with no confidential protocol or patient information.
3. **The prototype:** inspect its interpretation, missing evidence, and version comparison. Point out what is clinically misleading or operationally irrelevant.
4. **A next experiment:** agree one small task and what would count as a useful result, or conclude that this is the wrong problem to pursue.

The most useful feedback is specific: “this needs a measurement date,” “this empty field cannot mean a negative history,” or “our reviewer needs to see the amendment source beside this result.”

## Five-minute demo route

Use the [local setup](../README.md#run-it-locally), or [get in touch](#get-in-touch) for a guided walkthrough.

| Step | What to inspect | Question to bring back |
| --- | --- | --- |
| Open **Screening funnel** | Ten synthetic patients, criterion results, and unknown evidence | Would the distinction between missing evidence and a failed criterion help a reviewer? |
| Open **Amendment** | Changes between the bundled protocol versions and affected synthetic participants | Which information would you need before acting on an amendment? |
| Open **Thresholds** | Change a numeric threshold and inspect the cohort response | Is this exploration useful during protocol review, and what context is missing? |
| Open **Checks** | Findings tied to the rule text | Which findings would be actionable, and which would be noise? |
| Open **Review** | A proposed fact, its source note, and confirm/edit/reject choices | Could you verify this interpretation without re-reading the entire note? |

The UI is an exploration of a synthetic protocol. Changing a threshold does not establish a clinically appropriate cutoff. A browser confirmation is a demo action, not an authorized clinical sign-off.

## Small contributions that would move this forward

- **Review one translation.** Compare a criterion in the public COMMANDER HF registry with its [encoded interpretation and modeling notes](../rules/trials/commander-hf). Identify lost qualifiers, ambiguous timing, or assumptions that should remain unresolved.
- **Describe one workflow.** Explain the trigger, who reviews it, what documents they need, and the output they must produce. Generic examples are sufficient.
- **Create a synthetic edge case.** Describe an invented participant whose evidence exposes an ambiguous rule or missing fact.
- **Define a useful evaluation.** Help compare time, disagreements, missed qualifiers, and ability to trace a result to its source against the current review process.

Engineers are also welcome to help with tests, evidence provenance, or interoperability. The [contribution guide](../CONTRIBUTING.md) covers code and rule changes.

## What this project has not established

There has been no clinical validation, real-chart study, or operational deployment established by this repository. The workbench uses ten synthetic fixtures and has no patient upload. There is no EHR integration, authenticated review, or durable shared audit trail. Some criteria are only partially represented or retained as unmodeled text.

The initial collaboration should stay with public protocol material and synthetic examples. Any study involving real records would be a separate project with its own institutional permissions, data arrangements, validation plan, and governance.

## Get in touch

**[Open a collaboration issue](https://github.com/emmcygn/rulekit/issues/new?template=collaboration.yml)** with your role, the workflow you would like to discuss, and whether you would prefer a walkthrough or to review a public criterion. If you found RuleKit through LinkedIn, you can also reply to the post or message me there.

GitHub issues are public: do not include patient information, confidential protocols, or private contact details. No GitHub account is needed to start a LinkedIn conversation.

[Back to the repository](../README.md) · [Project direction and milestones](project-brief.md)
