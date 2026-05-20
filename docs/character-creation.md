# Character Creation and Import

Character creation is the only MVP path for producing a player character. The
flow is agent-guided, but final legality is enforced by deterministic core
validation before any canonical state write is accepted.

The accepted output is the E3 canonical `character` singleton plus related
canonical tables such as `inventory` when starting equipment is added. Character
creation does not own a second sheet model. It emits `mutate_state`-compatible
writes so the same persistence and provenance rules apply to created characters,
DM-authored corrections, and future import output.

## MVP Creation Contract

The agent may propose or ask the player about choices such as name, ancestry,
class, ability score method, hit points, equipment, and spells. The deterministic
character-creation validator is responsible for rejecting illegal combinations,
bad point-buy totals, invalid standard-array assignments, unsupported SRD build
options, and spell choices that do not match the selected class.

When validation succeeds, the flow writes the accepted sheet into canonical state
through `mutate_state`. If validation fails, the flow returns the validation
errors to the agent for a player-facing correction turn rather than partially
persisting the sheet.

## Deferred Import Contract

Character import is explicitly out of MVP scope. Deferred sources include:

- D&D Beyond exports or scraping.
- OCR from scanned or photographed paper sheets.
- Virtual tabletop exports.
- User-authored ad hoc JSON or spreadsheet sheets.

Future importers must be pure mappers into the single canonical schema. They may
parse source-specific formats, normalize names, and surface validation errors,
but they must not create a parallel character model or source-specific gameplay
schema. The convergence target remains the canonical E3 `character` row and
related canonical state tables, with provenance identifying the importer and
source artifact.
