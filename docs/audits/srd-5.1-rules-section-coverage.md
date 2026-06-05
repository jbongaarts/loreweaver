# SRD 5.1 Rules-Section Coverage Audit

**Bead:** `loreweaver-ars`
**Date:** 2026-06-04
**Source audited:** `packages/core/sources/dnd5e-srd-5.1/SRD_CC_v5.1.pdf` (CC-BY-4.0,
hash-pinned in `sources/dnd5e-srd-5.1/manifest.json`).
**Pack audited:** `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/`
(1,320 records).

## Why this audit exists

The final pack accuracy audit flagged that the `rule` parser is *selective*: the
committed pack carries only **10** `rule` records even though the SRD 5.1 core
rules span three chapters (Using Ability Scores, Adventuring, Combat) plus a
Spellcasting-rules chapter and five gamemastering sections (Traps, Diseases,
Madness, Objects, Poisons). This document maps the SRD's rules sections against
what the importer captures today, explains *why* the gaps exist, and recommends
per-section actions (parse as `rule`, parse as a structured record, or leave as
intentionally-unimported prose).

This is an **audit only**. Per the bead scope, it does **not** implement broad
parser changes; it records findings and files follow-up beads for the
high-value expansions.

## Method

1. Extracted the vendored PDF to text (`pdftotext`) in reading order and
   enumerated every heading-style section in the rules chapters and the
   post-spell gamemastering sections.
2. Cross-referenced the section list against:
   - the live section anchors in
     `packages/core/scripts/importers/dnd5e-srd-5.1/sections.ts`,
   - the `rule` extraction logic in `parseRules.ts`,
   - the committed pack's actual `rule`/`action`/`table` records.
3. Classified each section by current import status and recommended action.

## What is captured today

The 10 committed `rule` records are:

```
rule:actions-in-combat      rule:between-adventures     rule:difficult-terrain
rule:instant-death          rule:ranged-attacks         rule:researching
rule:spellcasting-ability   rule:the-environment        rule:the-order-of-combat
rule:time
```

Adjacent rules content is *also* captured under other kinds, and that coverage is
genuinely good - it is the prose-rule layer that is thin:

- **`action` (10):** the standard combat actions (Attack, Dash, Dodge, ...) -
  complete.
- **`condition` (15):** all SRD conditions incl. structured exhaustion levels -
  complete.
- **`hazard` (8):** the eight sample traps from the gamemastering Traps section
  (`loreweaver-hvp`) - complete for traps.
- **`table` (3):** Difficulty Classes, Trap Save DCs/Attack Bonuses, Damage
  Severity by Level - the only reconstructable reference tables in the source
  (`loreweaver-46m`).

## Root causes of the `rule` gap

Four independent mechanisms explain why only 10 prose rules land:

1. **The "wrapper drop" in `parseRules.ts`.** A heading whose *next* non-blank
   line is itself a heading is treated as a chapter/section wrapper and skipped
   (`parseRules.ts:150-154`). The SRD core rules are deeply nested
   (`Using Ability Scores -> Ability Checks -> Using Each Ability -> Strength ->
   Strength Checks -> ...`), so almost every adjudication rule that has named
   sub-rules under it is dropped, and only "leaf" headings whose body is
   immediately prose survive. This is why the captured set looks arbitrary
   (`Difficult Terrain`, `Instant Death`, `Researching`) rather than canonical
   (`Cover`, `Resting`, `Damage and Healing`).

2. **The core-rules slice ends at `Spellcasting`.** The `coreRules` anchor runs
   `Using Ability Scores -> Spellcasting` (`sections.ts:247-255`), so the
   general **Spellcasting rules** chapter (What Is a Spell, Spell Slots,
   Casting Time, Components, Ranges, Areas of Effect, Rituals, ...) is never fed
   to `parseRules`. Only the single leaf `rule:spellcasting-ability` (which
   lives back in the ability-scores chapter) is captured.

3. **The gamemastering sections are never sliced.** Diseases, Madness, Objects,
   and Poisons sit *after* the alphabetic Spell Descriptions section (the spell
   slice ends at `Traps`), and no anchor targets them. Only Traps among that run
   has an anchor. So four whole gamemastering sections - several of them
   structured, adjudication-relevant data - are entirely absent from the pack.

4. **Body-bleed in captured rules.** Because the wrapper drop keeps a heading
   only when its body is prose, some captured rules then absorb the following
   sub-headings into their `data.text` (e.g. `rule:actions-in-combat` body runs
   on into "Attack ... Dash ... Dodge ...", which are *also* emitted as `action`
   records). The current records are usable but not cleanly bounded.

## Section-by-section coverage table

Page numbers are approximate locations in the vendored SRD 5.1 PDF. Status:
**Imported** = captured as some record kind; **Partial** = chapter exists but
only a few leaf rules captured; **Missing** = not in any slice.

| # | SRD section | ~Page | Current status | Recommended action | Priority | Rationale |
|---|-------------|-------|----------------|--------------------|----------|-----------|
| 1 | Using Ability Scores -> Ability Checks (DCs, contests, skills, passive checks, working together) | 76-78 | Partial (DC table only) | Parse as `rule` records (per-subsection) | P2 | Core adjudication ("how do I resolve a skill check / contest / passive check") the DM model will query constantly. The DC table is already a `table`; the prose rules around it are not. |
| 2 | Using Each Ability (Strength/Dex/Con/Int/Wis/Cha checks, lifting & carrying, initiative, hiding) | 77-80 | Partial | Parse as `rule` (or `ability` kind - see Note A) | P2 | High-value: per-ability usage and the carrying-capacity / hide rules are frequently adjudicated. The unused `ability` kind exists in the schema for exactly this. |
| 3 | Saving Throws | 79 | Missing | Parse as `rule` | P2 | Fundamental resolution rule; currently absent as prose. |
| 4 | Proficiency Bonus / Advantage & Disadvantage / Inspiration | 76 | Missing | Parse as `rule` | P2 | Core d20 math the model must explain consistently. |
| 5 | Adventuring -> Time / Movement / Travel Pace / Special Movement | 84-85 | Partial (`time`, `difficult-terrain`) | Parse as `rule` (complete the chapter) | P3 | Travel/movement adjudication; a few leaves captured, most missing. |
| 6 | The Environment (Falling, Suffocating, Vision & Light, Food & Water) | 86-87 | Partial (`the-environment`, leaf) | Parse as `rule` (per-subsection) | P2 | Survival/environment adjudication (falling damage, darkvision, starvation) is high-frequency DM ruling material. |
| 7 | Resting (Short Rest, Long Rest) | 87 | Missing | Parse as `rule` | P2 | Resting is one of the most-referenced rules in play and is currently absent. |
| 8 | Between Adventures / Downtime (Lifestyle, Crafting, Practicing, Recuperating, Training) | 87-88 | Partial (`between-adventures`, `researching`) | Parse as `rule` | P4 | Lower in-session frequency; complete opportunistically. |
| 9 | Combat -> The Order of Combat (Surprise, Initiative, Your Turn, Bonus Actions, Reactions) | 89-90 | Partial (`the-order-of-combat`) | Parse as `rule` (per-subsection) | P2 | Turn structure is core combat adjudication. |
| 10 | Movement and Position (Difficult Terrain, Being Prone, Moving Around Creatures, Creature Size/Space, Squeezing) | 90-91 | Partial (`difficult-terrain`) | Parse as `rule` | P3 | Positioning rules; several leaves missing. |
| 11 | Making an Attack (Attack Rolls, Modifiers, Unseen Attackers, Ranged in Close Combat, Melee, Opportunity Attacks, Grappling, Shoving) | 92-94 | Partial (`ranged-attacks`) | Parse as `rule` (per-subsection) | P1 | Attack resolution is the single most-adjudicated combat subsystem; only one leaf captured today. |
| 12 | Cover | 94 | Missing | Parse as `rule` | P2 | Frequently-cited combat modifier; cleanly bounded prose + half/three-quarters/total values. |
| 13 | Damage and Healing (Hit Points, Damage Rolls, Critical Hits, Damage Types, Resistance/Vulnerability, Healing, Dropping to 0 HP, Death Saves, Temporary HP) | 95-97 | Partial (`instant-death`) | Parse as `rule` (per-subsection) | P1 | Damage/death rules are core; only the `instant-death` leaf is captured. Death-saving-throw and resistance rules are high-value. |
| 14 | Mounted Combat / Underwater Combat | 98-99 | Missing | Parse as `rule` | P3 | Situational but self-contained. |
| 15 | Spellcasting rules (What Is a Spell, Spell Level, Known/Prepared, Spell Slots, Casting at Higher Level, Rituals, Casting Time, Components, Range, Areas of Effect, Duration, Targets, Combining Effects) | 99-105 | Missing (only `spellcasting-ability` leaf) | Parse as `rule` (new `spellcastingRules` slice) | P1 | The general spellcasting rules govern *every* spell the pack already ships (319 spells). Their absence is the largest single rules gap. Requires a new section anchor between `coreRules` end and `Spell Lists`. |
| 16 | Traps (general guidance + sample traps + 2 tables) | 194-196 | Imported (`hazard` x8, `table` x2) | None (complete) | - | `loreweaver-hvp`. General trap-running prose intentionally omitted (DM procedure). |
| 17 | **Diseases** (Sample Diseases: Cackle Fever, Sewer Plague, Sight Rot) | 196 | Missing | Parse as **structured records** under `hazard` (`data.category: 'disease'`) | P2 | Each disease has DC, onset, effect, recovery - structured, lookupable, adjudication-relevant. Folds into `hazard` like traps did (avoids a new exhaustive kind). See Note B. |
| 18 | **Madness** (Short-/Long-/Indefinite Madness effect tables, Going Mad, Curing Madness) | 197-198 | Missing | Parse as `table` (3 effect tables) + `rule` (curing) | P3 | The three madness tables are reconstructable `table` records; the surrounding guidance is a `rule`. |
| 19 | **Objects** (Statistics for Objects: AC by material, HP by size, breaking objects) | 198-200 | Missing | Parse as `table` (Object AC, Object HP) + `rule` | P2 | Object AC/HP tables are needed to adjudicate attacks on objects; structured and reconstructable. |
| 20 | **Poisons** (4 poison types + 14 sample poisons with type/price/DC/effect) | 203-205 | Missing | Parse as **structured records** under `hazard` (`data.category: 'poison'`) | P2 | 14 named poisons each with type, price, save DC, damage, and effect - clearly structured, lookupable game entities (like magic items). Folds into `hazard`. See Note B. |

### Note A - the unused `ability` kind

`RulesRecordKind` includes an `ability` kind (`types.ts:6`) that no current pack
uses. The six ability-score sections ("Using Each Ability") are its natural
home. Using `ability` for these (instead of generic `rule`) gives the DM model a
clean `ability:strength` lookup. Either choice is defensible; recommending
`rule` as the low-risk default and flagging `ability` as the cleaner option for
the implementing bead to decide.

### Note B - structured gamemastering records fold into `hazard`, not new kinds

Poisons and diseases are description-only dangers with save DCs and effects -
the same shape as traps, which the project already folded into the `hazard`
kind rather than minting a `trap` kind (`README.md` hazard decision,
`loreweaver-hvp`). Reusing `hazard` with a `data.category` discriminator
(`'trap'` implicit today, `'poison'`, `'disease'`) keeps the exhaustive
`Record<RulesRecordKind, ...>` validators/indexes unchanged. Minting `poison` /
`disease` kinds would force edits across every exhaustive kind switch for no
schema benefit. **Recommendation: do not add new record kinds; extend `hazard`
with a `category` discriminator.**

## Recommended dispositions (summary)

**Parse as `rule` records (prose adjudication rules) - highest value:**
- Making an Attack subsections (P1), Damage and Healing subsections (P1)
- Spellcasting rules chapter via a new slice (P1)
- Saving Throws, Cover, Resting, The Environment subsections, Ability
  Checks/Using Each Ability, Order of Combat (P2)
- Movement/Position, Mounted/Underwater Combat, Adventuring movement, Downtime
  (P3-P4)

**Parse as structured records:**
- Poisons -> `hazard` + `data.category: 'poison'` (14 records) - P2
- Diseases -> `hazard` + `data.category: 'disease'` (3 records) - P2
- Objects -> `table` (Object AC, Object HP) + `rule` - P2
- Madness -> `table` x3 + `rule` (curing) - P3

**Intentionally out of scope for this milestone (record the decision):**
- General trap-running *procedure* prose (already omitted by design,
  `loreweaver-hvp`).
- DM-facing narrative/advice prose with no lookupable entity (chapter intros,
  "the GM decides..." flavor framing).
- Backgrounds - SRD 5.1 publishes none (ADR 0005); already documented.
- Sentient Magic Items / Artifacts construction guidance - DM-facing
  construction advice, consistent with the existing magic-item A-Z boundary.
- Variant rules (Variant: Skills with Different Abilities, Variant:
  Encumbrance) - optional rules; defer unless a consumer needs them.

## Parser-design implications for the follow-up work

The single biggest blocker is the **wrapper drop** (`parseRules.ts:150-154`).
Completing core-rules `rule` coverage is not just "widen the slice" - it needs a
nesting-aware parser that emits a `rule` per *leaf* subsection while preserving
(or linking) the parent section, instead of dropping every parent. The
implementing bead should decide between:

- **(a)** emit a `rule` for every heading (parent + leaf), bounding each body at
  the next heading of equal-or-higher level (needs `headingLineIndexes` font
  levels, already available from `extract.ts`); or
- **(b)** emit leaf-only `rule` records but stop dropping a parent merely because
  its next line is a heading - instead recurse.

Option (a) is cleaner and matches how `feature`/`subclass` already use heading
levels. This is a non-trivial parser change and must land behind its own bead
with fixtures and a coverage baseline (like the creature/magic-item name sets),
not as a drive-by.

## Follow-up beads

Confirmed high-value expansions, filed as their own beads:

1. **`loreweaver-yli`** (P1) - Nesting-aware `parseRules` rewrite for SRD
   core-rules `rule` coverage (Combat + Ability/Adventuring chapters; fixes the
   wrapper-drop root cause). **DONE.** The parser now reads per-line font tiers
   (new `PageText.lineHeights`) and emits one `rule` per heading bounded at the
   next heading, taking the canonical pack from **10 → 123** `rule` records
   (Making an Attack + subsections, Damage and Healing + Death Saving Throws,
   Cover, Resting/Short Rest/Long Rest, Saving Throws, Order of Combat
   subsections, The Environment subsections, …). Cross-chapter title collisions
   are disambiguated with parent-qualified keys; `Variant:` rules, bullet-led
   skill captions, and the leaf table captions the `table` kind owns are
   excluded. Gated by `EXPECTED_SRD_5_1_RULE_KEYS` / `RuleCoverageError`. This
   addressed root causes 1 ("wrapper drop") and 4 ("body-bleed").
2. **`loreweaver-3hp`** (P1) - Import the Spellcasting-rules chapter as `rule`
   records (new `spellcastingRules` slice).
3. **`loreweaver-6ra`** (P2) - Poisons + Diseases as structured `hazard` records
   (`data.category: 'poison'`/`'disease'`).
4. **`loreweaver-uuk`** (P2) - Objects + Madness reference `table` records plus
   surrounding `rule` prose.
