/**
 * Internal types for the D&D 5e SRD 5.1 importer.
 *
 * Distinct from the canonical `RulesRecord` shape: these are intermediate
 * extraction structures that downstream `toRulesRecords` converts to records.
 */

export interface PageText {
  readonly pageNumber: number;
  readonly lines: readonly string[];
}

/**
 * A spell entry as extracted directly from the SRD source, before the
 * class-list cross-reference pass annotates `classes`.
 */
export interface SpellExtraction {
  readonly name: string;
  readonly level: number;
  readonly school: string;
  readonly ritual: boolean;
  readonly castingTime: string;
  readonly range: string;
  readonly components: readonly string[];
  readonly componentMaterials?: string;
  readonly duration: string;
  readonly description: string;
  readonly higherLevels?: string;
  /** 1-based page in the source PDF where the spell entry begins. */
  readonly sourcePage: number;
}

export type SpellCasterClass =
  | 'Bard'
  | 'Cleric'
  | 'Druid'
  | 'Paladin'
  | 'Ranger'
  | 'Sorcerer'
  | 'Warlock'
  | 'Wizard';

/**
 * Map from a spell name (verbatim from a class spell list) to the set of
 * caster classes whose lists include it.
 */
export type SpellClassIndex = ReadonlyMap<
  string,
  ReadonlySet<SpellCasterClass>
>;

/**
 * Map from a base-class name (e.g. "Fighter") to its primary/key abilities, as
 * read from the SRD 5.1 Multiclassing "Prerequisites" listing
 * (loreweaver-0m9.5.19). Mirrors how `SpellClassIndex` carries the spell→class
 * cross-reference parsed from a separate slice: the SRD's Class Features block
 * does not print a per-class primary-ability line (ADR 0007), so this listing
 * is the canonical source the class emitter merges into `data.primaryAbilities`.
 * The ability list preserves source order (so "Strength 13 or Dexterity 13"
 * yields `['Strength', 'Dexterity']`).
 */
export type ClassPrimaryAbilityIndex = ReadonlyMap<string, readonly string[]>;

/** One level of the exhaustion condition (levels 1–6). */
export interface ExhaustionLevel {
  readonly level: number;
  readonly effect: string;
}

/**
 * A condition entry as extracted from the SRD source, before conversion to a
 * `RulesRecord`. `effects` holds the individual bullet-point rules. `levels`
 * is only present for exhaustion — see the exhaustion decision note in
 * `parseConditions.ts`.
 */
export interface ConditionExtraction {
  readonly name: string;
  /** Full body text (re-flowed paragraphs, bullet markers stripped). */
  readonly description: string;
  /** Individual bullet-point effects with the marker stripped. */
  readonly effects: readonly string[];
  /** Exhaustion only: the six cumulative effect levels. */
  readonly levels?: readonly ExhaustionLevel[];
  /** 1-based page in the source PDF where the condition entry begins. */
  readonly sourcePage: number;
}

/**
 * A feat entry as extracted from the SRD source, before conversion to a
 * `RulesRecord`. `prerequisites` is the raw prerequisite text (e.g.
 * "Strength 13 or higher"); `description` is the benefit body, re-flowed.
 */
export interface FeatExtraction {
  readonly name: string;
  /** Raw prerequisite text, absent when the feat has none. */
  readonly prerequisites?: string;
  /** Benefit text, re-flowed into paragraphs. */
  readonly description: string;
  /** 1-based page in the source PDF where the feat entry begins. */
  readonly sourcePage: number;
}

/**
 * A hazard entry as extracted from the SRD source, before conversion to a
 * `RulesRecord`. SRD 5.1 hazards use plain prose paragraphs; description is
 * the full body text, re-flowed.
 */
export interface HazardExtraction {
  readonly name: string;
  /** Full body text, re-flowed into paragraphs. */
  readonly description: string;
  /** 1-based page in the source PDF where the hazard entry begins. */
  readonly sourcePage: number;
}

/**
 * A rule-text entry as extracted from the SRD source, before conversion to a
 * `RulesRecord`. `text` is the full rule body, re-flowed into paragraphs.
 */
export interface RuleExtraction {
  readonly name: string;
  /** Full rule body text, re-flowed into paragraphs. */
  readonly text: string;
  /** 1-based page in the source PDF where the rule heading begins. */
  readonly sourcePage: number;
}

/**
 * A combat action entry as extracted from the SRD source, before conversion
 * to a `RulesRecord`. The body is captured as prose in `description`.
 */
export interface ActionExtraction {
  readonly name: string;
  readonly description: string;
  /** 1-based page in the source PDF where the action entry begins. */
  readonly sourcePage: number;
}

/**
 * A freestanding reference table as extracted from the SRD source, before
 * conversion to a `RulesRecord`. Rows intentionally allow mixed scalar cell
 * values because SRD tables commonly combine labels with numeric thresholds.
 */
export interface TableExtraction {
  readonly name: string;
  readonly columns: readonly string[];
  readonly rows: readonly (readonly unknown[])[];
  /** 1-based page in the source PDF where the table anchor appears. */
  readonly sourcePage: number;
}

/** Which Equipment-chapter table an extraction came from. */
export type EquipmentCategory = 'weapon' | 'armor' | 'gear';

/**
 * An equipment entry as extracted from the SRD source, before conversion to a
 * `RulesRecord`. SRD 5.1 presents equipment as tables, so the shared fields
 * (`cost`, `weight`) are verbatim cell text; category-specific structured
 * fields are present only for the matching `category`:
 *   - weapons carry `damageDie`, `damageType`, and `properties`;
 *   - armor carries `ac`, `armorType`, `stealthDisadvantage`, and (when the
 *     table lists one) `strengthRequirement`.
 */
export interface EquipmentExtraction {
  readonly name: string;
  readonly category: EquipmentCategory;
  /** Verbatim cost cell, e.g. "2 gp". Absent when the table lists none. */
  readonly cost?: string;
  /** Verbatim weight cell, e.g. "1 lb.". Absent when the table lists none. */
  readonly weight?: string;
  /** Weapon damage die, e.g. "1d4". */
  readonly damageDie?: string;
  /** Weapon damage type, lowercased: "bludgeoning" | "piercing" | "slashing". */
  readonly damageType?: string;
  /** Weapon properties, e.g. ["Finesse", "light", "thrown (range 20/60)"]. */
  readonly properties?: readonly string[];
  /** Armor class text, e.g. "11 + Dex modifier" or "18". */
  readonly ac?: string;
  /** Armor weight class: "light" | "medium" | "heavy" | "shield". */
  readonly armorType?: string;
  /** Armor stealth-check disadvantage flag. */
  readonly stealthDisadvantage?: boolean;
  /** Minimum Strength score the armor requires, e.g. 15 for plate. */
  readonly strengthRequirement?: number;
  /** 1-based page in the source PDF where the entry's row appears. */
  readonly sourcePage: number;
}

/**
 * One named racial trait as extracted from the SRD source: the bold "Label."
 * lead-in and its re-flowed body text. Trait labels in the SRD races chapter
 * are short noun phrases (e.g. "Ability Score Increase", "Age", "Alignment",
 * "Size", "Speed", "Languages", "Darkvision", "Dwarven Resilience").
 */
export interface AncestryTrait {
  readonly name: string;
  readonly text: string;
}

/**
 * A race (or subrace) entry as extracted from the SRD source, before
 * conversion to a `kind=ancestry` `RulesRecord`.
 *
 * SRD 5.1 uses the term "race"; the importer normalizes the record kind to
 * `ancestry` per ADR 0005 while preserving the source term in record data.
 *
 * Subrace handling (decision recorded on loreweaver-0m9.5.6): parent races and
 * subraces are emitted as **separate** ancestry records, and each subrace
 * record is **self-contained / flattened** — its `traits` already include the
 * parent's shared traits merged with the subrace's own additions, so a name
 * lookup of e.g. "Hill Dwarf" resolves to a fully usable record without having
 * to resolve the parent. `subraceOf` points back to the parent; the parent
 * lists its children in `subraces`. The cross-pack `overrides` field is
 * deliberately NOT used (it would hide the parent from the stack).
 */
export interface AncestryExtraction {
  readonly name: string;
  /** Intro / flavor prose for this race or subrace, re-flowed into paragraphs. */
  readonly description: string;
  /** Flattened trait list (parent + own for subraces). */
  readonly traits: readonly AncestryTrait[];
  /** Medium / Small / etc., parsed from the Size trait when present. */
  readonly size?: string;
  /** Base walking speed in feet, parsed from the Speed trait when present. */
  readonly speed?: number;
  /** Parent ancestry name (e.g. "Dwarf") when this is a subrace. */
  readonly subraceOf?: string;
  /** Child ancestry names (e.g. ["Hill Dwarf"]) when this is a parent. */
  readonly subraces?: readonly string[];
  /** 1-based page in the source PDF where the race/subrace entry begins. */
  readonly sourcePage: number;
}

/**
 * The six 5e ability scores. Each is the raw score (1–30), not the modifier;
 * the SRD stat block prints both ("8 (−1)") but the canonical creature record
 * stores only the score.
 */
export interface CreatureAbilityScores {
  readonly strength: number;
  readonly dexterity: number;
  readonly constitution: number;
  readonly intelligence: number;
  readonly wisdom: number;
  readonly charisma: number;
}

/**
 * A creature (monster) entry as extracted from the SRD source, before
 * conversion to a `kind=creature` `RulesRecord`. Mirrors the fields the
 * `dnd5e-srd` creature kindSchema requires (see `kindSchemas.ts`):
 *   - `size` is the capitalized size word ("Small", "Large", …);
 *   - `type` is the lowercase creature type as printed, with the subtype
 *     parenthetical dropped ("humanoid", "dragon", "swarm of Tiny beasts");
 *   - `armorClass` / `hitPoints` are the leading integers of the stat-block
 *     lines (the parenthetical AC source and HP dice expression are dropped);
 *   - `speed` maps movement modes to feet, the unlabeled base speed keyed as
 *     `walk` ({ walk: 30, climb: 30 });
 *   - `challengeRating` is the bare fraction/integer string ("1/4", "6"),
 *     without the XP parenthetical.
 */
export interface CreatureExtraction {
  readonly name: string;
  readonly size: string;
  readonly type: string;
  readonly alignment: string;
  readonly armorClass: number;
  readonly hitPoints: number;
  readonly speed: Readonly<Record<string, number>>;
  readonly challengeRating: string;
  readonly abilityScores: CreatureAbilityScores;
  /** 1-based page in the source PDF where the creature stat block begins. */
  readonly sourcePage: number;
}

/**
 * A base-class entry as extracted from the SRD source, before conversion to a
 * `kind=class` `RulesRecord`. Mirrors the fields the `dnd5e-srd` class
 * kindSchema requires (see `validateDnd5eClass` in `kindSchemas.ts`):
 *   - `hitDie` is the die size N from "Hit Dice: 1dN per <class> level";
 *   - `armorProficiencies` / `weaponProficiencies` / `savingThrowProficiencies`
 *     are the parsed list values of the "Armor:" / "Weapons:" / "Saving Throws:"
 *     lines in the class's "Class Features" block ("None" maps to an empty
 *     array for proficiencies);
 *   - `primaryAbilities` is the parsed "Primary Ability" line.
 *
 * Scope (ADR 0009 / loreweaver-0m9.5.2): base classes only. Subclasses and
 * class features are separate record kinds parsed by separate beads
 * (loreweaver-0m9.5.16/0m9.5.17 and 0m9.5.15/0m9.5.18).
 */
export interface ClassExtraction {
  readonly name: string;
  readonly hitDie: number;
  readonly primaryAbilities: readonly string[];
  readonly savingThrowProficiencies: readonly string[];
  readonly armorProficiencies: readonly string[];
  readonly weaponProficiencies: readonly string[];
  /** 1-based page in the source PDF where the class's Hit Dice line begins. */
  readonly sourcePage: number;
}

/**
 * A subclass entry as extracted from the SRD source, before conversion to a
 * `kind=subclass` `RulesRecord`. Per ADR 0009 a subclass links to its parent
 * base class via `data.parentClass` (the parent class record's key); this
 * extraction carries the parent class NAME and `emit.ts` keys it as
 * `class:<slug>` (mirroring how ancestry `subraceOf` is keyed).
 *
 * The `dnd5e-srd` subclass kindSchema (`validateDnd5eSubclass`) requires
 * `parentClass` and a non-empty `description`. The optional granted-`features`
 * reference array is the responsibility of the feature parser
 * (loreweaver-0m9.5.18) and is intentionally not populated here.
 *
 * Scope (ADR 0009 / loreweaver-0m9.5.17): one record per SRD 5.1 subclass
 * (Champion, Life domain, School of Evocation, …). Base classes are separate
 * `class` records (loreweaver-0m9.5.2); class features are a separate `feature`
 * kind (loreweaver-0m9.5.18).
 */
export interface SubclassExtraction {
  readonly name: string;
  /** Parent base-class name (e.g. "Fighter"); emit keys it as class:<slug>. */
  readonly parentClass: string;
  /** Subclass body prose, re-flowed into paragraphs. */
  readonly description: string;
  /** 1-based page in the source PDF where the subclass heading begins. */
  readonly sourcePage: number;
}

/**
 * A class- or subclass-granted feature as extracted from the SRD source,
 * before conversion to a `kind=feature` `RulesRecord`. Per ADR 0009 a feature
 * links to its grantor through `data.source` (the granting class/subclass
 * record key) and records the `data.level` at which it is gained; `emit.ts`
 * keys the grantor from `grantorKind` + `grantorName` (mirroring how the
 * subclass parser carries the parent class NAME for emit to key).
 *
 * The `dnd5e-srd` feature kindSchema (`validateDnd5eFeature`) requires a
 * non-empty `description`, a `source` grantor key, and an integer `level >= 1`.
 *
 * Level note: `parseFeatures` treats class/subclass progression-table rows as
 * the primary source for the grant level. Leading prose clauses ("Starting at
 * 2nd level, ...", "Beginning when you choose this archetype at 3rd level,
 * ...") are only a fallback when no table anchor exists. A no-leadin feature
 * without a table anchor is not emitted, because silently defaulting to level 1
 * would corrupt the canonical record. Scope (ADR 0009 / loreweaver-0m9.5.18).
 */
export interface FeatureExtraction {
  readonly name: string;
  /** Whether the feature is granted by a base class or a subclass. */
  readonly grantorKind: 'class' | 'subclass';
  /** Grantor display name (e.g. "Fighter" or "Champion"); emit keys it. */
  readonly grantorName: string;
  /** Character level at which the feature is gained (1–20). */
  readonly level: number;
  /** Feature body prose, re-flowed into paragraphs. */
  readonly description: string;
  /** 1-based page in the source PDF where the feature heading begins. */
  readonly sourcePage: number;
}

export interface ImporterCounts {
  readonly spells: number;
  readonly creatures: number;
  readonly classes: number;
  readonly subclasses: number;
  readonly features: number;
  readonly conditions: number;
  readonly feats: number;
  readonly hazards: number;
  readonly actions: number;
  readonly rules: number;
  readonly tables: number;
  readonly equipment: number;
  readonly ancestries: number;
}

export interface ImporterRunResult {
  readonly outDir: string;
  readonly sourceHash: string;
  readonly counts: ImporterCounts;
}
