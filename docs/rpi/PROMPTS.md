# SnapConsent Prompt-Writing Guide for RPI Work

This document rewrites and organizes the repo-specific prompt guidance into a clean, reusable markdown reference.

---

## 1. Core prompt-writing philosophy for this repo

A good prompt in this repo is:

- bounded
- code-first
- phase-correct
- explicit about reuse
- explicit about what is out of scope
- clear about invariants that must not be broken
- clear about current live architecture versus future ideas

A bad prompt in this repo usually:

- jumps straight to implementation without verifying current behavior
- asks for a broad redesign when a bounded extension is enough
- mixes multiple large features into one cycle
- forgets tenant scoping, retry safety, suppression logic, or audit invariants
- lets the AI invent a new model instead of reusing current canonical helpers
- treats previous RPI docs as truth without verifying current code

---

## 2. Phase discipline: what each phase is for

### Research phase

Use Research to answer:

- what exists now
- how it actually works in live code/schema
- what constraints already exist
- what the real options are
- what the cleanest bounded direction is

Research should not:

- implement
- overcommit to exact code changes
- assume current behavior from old plans without verification

### Plan phase

Use Plan to answer:

- what exact architecture is chosen
- what schema/API/UI changes are needed
- what must be reused
- what is explicitly excluded
- what edge cases and tests matter
- how implementation should be phased

Plan should not:

- redo broad exploratory research
- stay vague about exact route/schema/state decisions
- defer all important choices to implementation

### Implement phase

Use Implement to:

- follow `plan.md` closely
- make the code changes in phases
- test after each phase
- keep deviations minimal
- report exactly what changed

Implementation should not:

- restart architecture exploration
- redesign the feature mid-flight without a strong reason
- silently expand scope

---

## 3. What a good prompt must always do in this repo

For non-trivial work, prompts should usually include the following.

### A. Read order

Always tell the AI to read:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/rpi/README.md`

Then:

- relevant prior RPI docs in that area
- the specific live files/routes/helpers/components involved

### B. Source of truth

Prompt should say clearly:

- current repository code and schema are the source of truth
- prior research/plans are context, not unquestionable fact

### C. Boundaries

Prompt should explicitly say:

- what is in scope
- what is out of scope
- what must be reused
- what must not be redesigned

### D. Invariants

Prompt should explicitly call out:

- tenant scoping
- server-side business logic
- immutable published rows if template-related
- signed snapshot auditability if consent/template-related
- current exact-face identity model if face-related
- retry-safe/idempotent behavior where relevant

### E. Deliverable

Prompt should always specify the exact file to create:

- `docs/rpi/<id>-<slug>/research.md`
- `docs/rpi/<id>-<slug>/plan.md`

Or, in implementation:

- follow `plan.md`

---

## 4. Good Research prompt structure

A good Research prompt for this repo should usually contain these sections.

### 4.1 Title

Example:

> Start the RPI research phase for:  
> Feature 0XX — `<feature name>`

### 4.2 Read order

List the required docs first, then prior RPI docs, then current code.

Good pattern:

1. `AGENTS.md`
2. `CONTEXT.md`
3. `ARCHITECTURE.md`
4. `docs/rpi/README.md`
5. relevant prior RPI docs
6. live implementation files, helpers, routes, migrations, and tests in this area

### 4.3 Goal

One short paragraph covering:

- what the feature is trying to achieve
- what product problem it solves

### 4.4 Desired behavior

List the desired end-user behavior, but still at research level.

This is important:

- enough to orient the AI
- not so detailed that it becomes an implementation spec too early

### 4.5 Important scope boundaries

This is one of the most important parts.

A good prompt explicitly says things like:

- reuse current overlay behavior
- reuse current linking logic
- do not redesign export/DAM yet
- do not build a full page builder
- keep zero-face fallback out of scope
- keep it exact-face-only
- do not create fake consent rows

### 4.6 Research questions

This should be the largest section.

A good Research prompt asks for:

- current schema
- current routes/helpers/components involved
- current live behavior
- current constraints/invariants
- options considered
- recommended bounded direction
- open decisions for plan phase

For this repo, good research questions often include:

- what is the canonical table/model now
- what current route/helper is already reusable
- what state transitions exist today
- what parts are current derived state versus persisted state
- what would need additive schema versus no schema change
- what current suppression/precedence/reconcile behavior exists

### 4.7 Deliverable

Always end with the exact expected output file and expected document contents.

Good pattern:

Create:

`docs/rpi/<NEXT_ID>-<slug>/research.md`

The research document should include:

- Inputs reviewed
- Verified current behavior
- Current schema/code paths/routes/components involved
- Current constraints and invariants
- Options considered
- Recommended bounded direction
- Risks and tradeoffs
- Explicit open decisions for the plan phase

---

## 5. Good Plan prompt structure

A good Plan prompt should assume research already happened.

It should be shorter than Research, but more exact.

### 5.1 Read order

Good pattern:

- core docs
- `research.md`
- targeted live verification only for plan-critical conclusions

Important:

- do not ask the AI to redo broad research

Good wording:

- “do targeted verification only”
- “use `research.md` as the primary synthesized source of truth”

### 5.2 Goal

State what the feature is now planning concretely.

### 5.3 Important implementation intent

This is where you lock important reuse/boundaries:

- reuse current overlay engine
- reuse current manual-link route
- preserve suppression rules
- keep hidden and blocked separate
- keep one-column layout only
- manual faces must not enter auto matching

This section is extremely useful in this repo.

### 5.4 Exact scope boundary

A good Plan prompt should force exact scope decisions:

- linked faces only or all faces?
- exact-face only or asset-level too?
- one-column only or sections too?
- disabled placeholder vs real backend?
- hidden visible by toggle only?
- simulated upload only?

This is how you stop features from ballooning.

### 5.5 Planning tasks

These should force the plan to answer exact design questions, usually in this order:

1. chosen architecture
2. exact scope boundary
3. exact schema/model plan
4. exact route/read/write/API plan
5. exact UI/state plan
6. security/reliability considerations
7. edge cases
8. test plan
9. implementation phases
10. scope boundaries

### 5.6 Deliverable

Good pattern:

Create:

`docs/rpi/<ID>-<slug>/plan.md`

The plan document should include:

- Inputs and ground truth
- Verified current boundary
- Options considered
- Recommendation
- Chosen architecture
- Exact schema/API/read/write plan
- Exact UI/state plan
- Security and reliability considerations
- Edge cases
- Test plan
- Implementation phases
- Scope boundaries
- A concise implementation prompt at the end

---

## 6. Good Implement prompt structure

Implementation prompts in this repo should be short.

Why:

- all context should already live in `plan.md`
- long implementation prompts often repeat too much and create drift

A good implementation prompt should include only the following.

### 6.1 Read order

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/rpi/README.md`
- the specific `plan.md`

### 6.2 Contract wording

Say clearly:

- follow `plan.md` as the implementation contract
- keep deviations minimal

### 6.3 Phases

Tell the AI to implement in phases and test after each.

Good pattern:

1. phase 1
2. phase 2
3. phase 3

Plus:

- tests after each phase

### 6.4 Only actually useful extra instructions

Only include instructions that are not already obvious from the plan, for example:

- preserve current overlay engine
- keep manual faces out of auto matching
- keep blocked and hidden separate
- keep exact-face only
- keep preview validate side-effect-free

Do not repeat the whole plan.

### 6.5 End-of-run report

Always ask for:

- what changed
- minimal deviations
- tests run and results

### Good concise implementation prompt pattern

> Implement Feature 0XX by following `docs/rpi/0XX-.../plan.md` as the implementation contract.
>
> Before coding, read:
>
> - `AGENTS.md`
> - `CONTEXT.md`
> - `ARCHITECTURE.md`
> - `docs/rpi/README.md`
> - `docs/rpi/0XX-.../plan.md`
>
> Keep deviations minimal.
>
> Implement in phases:
>
> 1. ...
> 2. ...
> 3. ...
>
> Additional instructions:
>
> - `<only the truly important extra rules not worth restating in full>`
>
> After each phase, run relevant tests and fix failures before continuing.
>
> At the end, report:
>
> - what changed
> - any minimal deviations from the plan
> - tests run and results

---

## 7. Prompt-writing heuristics specific to SnapConsent

### 7.1 When to say “reuse current logic”

Say this explicitly when the feature touches:

- exact-face linking
- unlink/replace
- hidden-face behavior
- overlay rendering
- structured field validation
- versioned templates
- public submit

This repo often already has the hardest logic implemented.  
Prompts should push reuse instead of invention.

### 7.2 When to force exact boundaries

Force exact boundaries whenever the feature risks widening into:

- review-session redesign
- export/DAM redesign
- generic page builder
- generic assignment state machine
- new face identity model
- asset-level assignment plus exact-face assignment in one feature
- auto-matching redesign

### 7.3 When to require “current code is source of truth”

This should almost always be said during Research and Plan, especially when:

- older RPI docs exist
- multiple features have changed the same area
- the code evolved beyond earlier plans

### 7.4 When to require additive schema only

Say this explicitly if the feature could tempt the AI into replacing current models.

This is common for:

- template features
- face/assignment features
- export features

### 7.5 When to require server-side authority

Say this explicitly if the feature touches:

- validation
- linking
- hidden/blocked state
- public submit
- template publish
- project export
- preview validation dry-runs

---

## 8. Common pitfalls to guard against in prompts

These are recurring failure modes in this repo.

### 8.1 “Fake consent” shortcuts

Do not let the AI model something like Block as fake consent unless you really want that.

Prompt should explicitly reject semantic corruption shortcuts.

### 8.2 Reusing the wrong table

Example from current context:

- `asset_consent_links` still exists, but is not the canonical photo-link source anymore

Prompts should explicitly say which canonical table/helper to use.

### 8.3 Accidental scope expansion

Example triggers:

- “also support unlinked faces”
- “also support asset-level link”
- “also support export”
- “also support sections/columns”

Prompt should explicitly defer these unless intentionally included.

### 8.4 Mixing preview convenience with real authority

Preview validation, template preview, and interactive draft UIs are convenience features.

Prompts must explicitly preserve:

- real submit authority on the server
- no side effects from preview
- no fake invite/consent writes in preview

### 8.5 Forgetting rematerialization/remapping implications

Any face feature touching current face rows must consider:

- rematerialization
- stale row cleanup
- manual face preservation
- hidden/blocked state preservation

Prompt should explicitly ask for this when relevant.

### 8.6 Overloading the paginated asset/grid API

For preview-specific data, prefer a bounded preview route rather than stuffing everything into the paginated list response.

---

## 9. Recommended reusable phase templates

You can give another AI coding tool these reusable instructions.

### 9.1 Reusable Research prompt template


Start the RPI research phase for:
Feature <NEXT_ID> — <feature title>

First read, in this order:
1. AGENTS.md
2. CONTEXT.md
3. ARCHITECTURE.md
4. docs/rpi/README.md
5. relevant prior RPI docs in the same feature area
6. current live implementation files, helpers, routes, migrations, and tests in this area

Goal:
<one paragraph describing the product problem and intended user outcome>

Important scope boundaries:
- <what must be reused>
- <what must stay out of scope>
- <what invariants must be preserved>

Research must answer:
1. current live boundary
2. current schema/routes/components/helpers involved
3. current canonical model/state transitions
4. options considered
5. recommended bounded direction
6. risks/tradeoffs
7. open decisions for plan phase

Deliverable:
Create:
docs/rpi/<NEXT_ID>-<slug>/research.md

The research document should include:
- Inputs reviewed
- Verified current behavior
- Current schema/code paths/routes/components involved
- Current constraints and invariants
- Options considered
- Recommended bounded direction
- Risks and tradeoffs
- Explicit open decisions for the plan phase

### 9.2 Reusable Plan prompt template

Start the RPI plan phase for:
Feature <ID> — <feature title>

First read, in this order:
1. AGENTS.md
2. CONTEXT.md
3. ARCHITECTURE.md
4. docs/rpi/README.md
5. docs/rpi/<ID>-<slug>/research.md
6. only the live implementation files directly needed to verify the planning boundary

Goal:
Produce a concrete, bounded implementation plan for <feature goal>.

Important implementation intent:
- <must reuse>
- <must preserve>
- <must not redesign>

Keep this feature bounded to:
- <in scope items>

Keep out of scope:
- <out of scope items>

Planning tasks to complete:
1. chosen architecture
2. exact scope boundary
3. exact schema/model plan
4. exact API/read/write plan
5. exact UI/state plan
6. security/reliability considerations
7. edge cases
8. test plan
9. implementation phases
10. scope boundaries

Deliverable:
Create:
docs/rpi/<ID>-<slug>/plan.md

The plan document should include:
- Inputs and ground truth
- Verified current boundary
- Options considered
- Recommendation
- Chosen architecture
- Exact schema/API/read/write plan
- Exact UI/state plan
- Security and reliability considerations
- Edge cases
- Test plan
- Implementation phases
- Scope boundaries
- A concise implementation prompt at the end
- 
### 9.2 Reusable Implement prompt template

Implement Feature <ID> by following docs/rpi/<ID>-<slug>/plan.md as the implementation contract.

Before coding, read:
- AGENTS.md
- CONTEXT.md
- ARCHITECTURE.md
- docs/rpi/README.md
- docs/rpi/<ID>-<slug>/plan.md

Keep deviations minimal.

Implement in phases:
1. <phase 1>
2. <phase 2>
3. <phase 3>

Additional instructions:
- <only the most important extra constraints not worth repeating from plan.md>

After each phase, run relevant tests and fix failures before continuing.

At the end, report:
- what changed
- any minimal deviations from the plan
- tests run and results

## 10. Recommended AI behavior instructions for this repo

When working on this repo:

- Follow strict RPI:
  - Research
  - Plan
  - Implement
- Treat live code and schema as source of truth.
- Use prior RPI docs as context, not unquestionable fact.
- Keep features bounded.
- Prefer additive extensions over redesign.
- Reuse existing canonical helpers and routes where possible.
- Be explicit about what is in scope and out of scope.
- Always preserve tenant scoping and server-side business logic.
- Preserve immutable published template rows and signed snapshot auditability.
- For face features, preserve the current exact-face identity model unless the feature explicitly redesigns it.
- For preview features, do not confuse convenience validation with real submission authority.
- For large research.md or plan.md files, write incrementally and verify final coherence and encoding.