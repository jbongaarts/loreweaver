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

export interface ImporterCounts {
  readonly spells: number;
  readonly conditions: number;
  readonly feats: number;
  readonly hazards: number;
  readonly actions: number;
  readonly rules: number;
}

export interface ImporterRunResult {
  readonly outDir: string;
  readonly sourceHash: string;
  readonly counts: ImporterCounts;
}
