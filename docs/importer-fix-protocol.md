# Importer Fix Protocol

This protocol applies to deterministic rules-pack importer work, including extractor changes, parser changes, audit/oracle changes, importer tests, and generated rules-pack updates.

The goal is to prevent importer fixes from becoming local, symptom-driven patches that make one record look better while weakening regression coverage or breaking another part of the generated pack.

## Core rule

Regression tests and audit expectations are contracts.

Do not weaken, delete, or rewrite a failing regression expectation merely to make tests pass. A test or audit expectation may only be changed when the SRD source text, schema intent, or an existing documented design decision proves the expectation itself is wrong. Explain that evidence in the PR summary.

## Required workflow for importer bug fixes

1. Identify the failure class before changing parser behavior.
   - List affected generated record IDs when known.
   - Include at least one concrete before/after example.
   - Distinguish parser bugs from generated-data churn.

2. Add or confirm audit/test coverage first.
   - Prefer an audit invariant that represents the failure class.
   - Add focused regression tests for representative records.
   - Do not rely only on one hand-picked example if the problem is structural.

3. Change importer, extractor, or parser behavior.
   - Keep the change localized to the relevant failure class.
   - Avoid broad refactors unless they are required and explained.
   - Do not hand-edit generated records.

4. Regenerate generated rules-pack records through the importer.
   - Generated records must come from the importer workflow.
   - The committed generated pack must match regenerated output exactly.

5. Review the generated diff.
   - Explain every generated record added, removed, or changed.
   - Generated-pack churn outside the intended failure class is suspect.
   - Stop and investigate unexpected churn before broadening the change.

6. Run verification.
   - Run focused parser/audit tests.
   - Run pack regeneration and verification.
   - Run typecheck.
   - Run the repository's standard check command.
   - Run the full test suite when practical for importer PRs.

## Required PR summary for importer changes

Importer PRs must report:

- affected record IDs before the fix;
- audit/test failure count before and after, when applicable;
- generated records added, removed, and changed;
- why each generated diff is expected;
- exact commands run and results;
- any follow-up bead created or updated for intentionally deferred scope.

## Test changes

Changing a test is allowed only when the test is wrong, incomplete, or too narrow for the intended behavior.

Bad reasons to change a test:

- the implementation currently fails it;
- the generated output currently disagrees with it;
- changing the assertion is easier than fixing the parser;
- the test blocks a preferred implementation.

Good reasons to change a test:

- the SRD source text proves the expected value is wrong;
- the schema intent changed and is documented;
- a narrow assertion is replaced by a stronger invariant;
- a local example test is replaced by broader audit coverage without losing the original regression intent.

When changing importer tests, state whether the change preserves, strengthens, or intentionally replaces the original regression contract.

## Generated records

Do not hand-edit generated rules-pack records.

Generated records must be changed by updating the importer, extractor, parser, or source manifest and then rerunning the generation workflow. The verification command must show that committed output matches importer output.

If generated records change outside the targeted failure class, explain why. If there is no clear explanation, treat the diff as suspicious.

## Follow-up scope

If a fix reveals a larger boundary, coverage, or schema problem, either:

1. include the complete fix with audit coverage in the same PR, or
2. create/update a follow-up bead with:
   - observed examples;
   - affected record IDs;
   - expected behavior;
   - likely files involved;
   - suggested tests or audit rules.

Do not silently leave known importer corruption untracked.
