# Canonical Game State

The game-state subsystem is the single canonical store for mutable campaign
facts. Model narration may propose changes, but canon changes are committed only
through deterministic state tools.

## Tables

`character` is a singleton row (`id = 1`) for the active character sheet. It is
the convergence target for character creation and future import flows. The
initial schema tracks identity, class, level, hit points, ability scores, and
conditions. See `docs/character-creation.md` for the creation flow contract and
the deferred importer mandate.

`inventory` stores one row per item stack or unique carried object. Each row has
an application-level `id`, display `name`, quantity, optional location, and JSON
properties for item-specific metadata.

`plot_flags` stores keyed canonical story facts. Values are encoded as JSON so
booleans, strings, numbers, arrays, and small objects can be stored without
introducing table churn for every new campaign flag.

`clock` is a singleton row (`id = 1`) for in-game time and current location.

`overlay_facts` stores keyed temporary or derived facts used by world and memory
subsystems. It has the same JSON value shape as `plot_flags`, but callers should
treat overlay facts as contextual state rather than character-sheet canon.

Every mutable row carries:

- `provenance`: the deterministic source of the accepted fact.
- `session_id`: the session that accepted the write.
- `updated_at`: the accepted write timestamp.

## State Tools

`mutateState(db, input)` validates one state mutation and writes it in a SQLite
transaction. The supported operation is `set`. Unsupported targets, fields, or
operations are rejected with `MutateStateError` before canon is changed.

`mutateStateBatch(db, inputs)` applies a turn-sized list of mutations in one
transaction. If validation, SQLite, or caller code throws before the batch
finishes, SQLite rolls back the in-flight writes and preserves the last committed
state.

`getStateProvenance(db, query)` returns row-level provenance metadata for
narrative callbacks. It supports character, inventory, plot flag, clock, and
overlay fact rows.

