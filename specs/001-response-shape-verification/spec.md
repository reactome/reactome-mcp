# 001 — Verifying response shapes

**Status:** implemented
**Date:** 2026-09-14
**Constitution:** Principles I, II, III

## Problem

Nine tools called the right endpoint, returned success, and rendered `undefined`
— or rendered nothing at all and looked fine. A tenth, `search_diagram`, had
never returned an answer in the life of the repository.

None of this was a logic error. Each tool read a field path the Reactome
services do not return:

| Tool | Declared | Actual |
|---|---|---|
| `search_suggest`, `search_spellcheck` | `{suggestions: string[]}` | bare `string[]` |
| `entity_component_of` | `Complex[]` | one entry per relationship type, with parallel `names`/`stIds`/`schemaClasses` arrays |
| `participants` | `stId`, `referenceEntity` | `peDbId`, `refEntities[]` |
| `static_interactors`, `psicquic_details` | flat interactor list | `entities[].interactors[]` |
| `interactor_summary`, `psicquic_summary` | `{accession, count}` | `{resource, entities: [{acc, count}]}` |
| `analysis_found_entities` | `mapsTo[].identifier` | `mapsTo[].ids[]` |
| `search_facets` | `FacetEntry[]` | `{available: FacetEntry[]}` |
| `search_diagram` | grouped `results` | flat `entries` |

`contentClient.get<T>(...)` asserts `T`. It does not check it. Nothing else did
either, because 51 of 56 tools had no test — including all seven analysis tools,
which is why a token-parsing bug had shipped earlier.

## Decision

**Every response type is derived from a real response.** The endpoint and a
trimmed payload go in a comment above the type, and a test pins the formatter
using that same payload. A fixture that stops matching production is a signal to
change the formatter, not the fixture.

**A sweep runs against the live services.** `npm run sweep` calls all 53 tools
and reports anything that looks wrong. It is not in `npm test` — it needs the
network and hits production — and runs weekly and on demand.

## What the sweep must detect, and why marker-grepping is not enough

The first version grepped for `undefined`, `[object Object]` and empty bodies.
Tested against a deliberately reintroduced `search_facets` bug, it reported
`no suspicious output` and exited 0: a facets response that has dropped every
facet still renders a heading, a total, and "*No facets available.*". Three
plausible lines and nothing to grep for.

So the sweep also asserts, for 16 tools whose arguments are known to return
data, that the answer still contains what it should.

**A silent drop is the failure mode that matters.** `participants` never showed
external identifiers at all. There was no `undefined` to notice — the bracket
was simply absent, and no one can see an absence in output they have not
compared against the source.

## Consequences

- Fixtures are verbose. That is the cost of recording what was observed rather
  than what was assumed.
- The sweep can go red because Reactome changed. Service errors are therefore
  reported separately and do not fail the run.
- Expectations are only as good as their coverage: 16 of 53 tools today. The
  run prints how many were actually checked, so a typo cannot quietly mean
  "nothing was verified".

## Still open

- 37 tools have no content expectation.
- `/data/orthology/{id}/species/{taxId}` returns HTTP 500 for valid-looking
  input. Upstream; our URL matches the documented route.
- `MappedInteractor.identifier` is probably wrong in the same way as
  `MappedEntity.identifier` was, but nothing renders it, so it could not be
  verified against a real payload. It was left alone rather than guessed at.
