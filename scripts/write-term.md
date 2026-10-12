---
name: Write a computer glossary term
description: "Writes one source-bounded engineering definition only after semantic and carrier admission. Compounds declare constituent filename stems as keywords while primitives remain independently meaningful."
---

Read the sources that establish how the owning engineering section uses the concept before drafting. A primitive term must explain the concept itself, distinguish it from a nearby concept, and state a consequence for engineering design, observation, or operation. Its prose must not mention a compound merely because that compound uses the word.

Supply one JSON request on standard input to `scripts/write-term.mjs`, or an array of such requests to `scripts/write-set-of-terms.mjs`. The request contains `termDirectory`, a `term`, and `semanticEvidence`; it may also carry `authorizedRelationKeys` and `overwrite`.

The `term` carries the machine-identity `filename`, the matching `identity` (the filename stem — the operation rejects the write when the two disagree, and never derives either from `name`), the human handle `name`, optional `aliases`, an optional two-sentence `description`, optional resource tags, optional compound-only `keywords`, direct assertions, and a substantive `body`. `keywords` is an array of kebab-case carrier identities, not a comma-separated string. Every supplied frontmatter assertion stays direct: for example, `type: intelligence`, `creator: Homo sapiens`, dates, sources, and relation predicates are all source content rather than bookkeeping to relocate.

Asserting any `relations` predicate requires listing that predicate in the request's top-level `authorizedRelationKeys`. The field defaults to empty, so a request that supplies `relations` without it is refused with `term relation predicate is not authorized`. The predicate must also appear in `schemas/glossary/term/relation-predicates.json`; read that vocabulary before drafting, because near-misses are refused (`delivers` is authorized, `produces` is not).

`semanticEvidence` supplies `sources` and exact `claims.definition`, `.distinction`, and `.consequence` excerpts witnessed in the body. These evidence fields govern admission and are not written into frontmatter: the write is refused unless each claim occurs verbatim in the body (whitespace collapsed, so wrapping does not matter) and every absolute-path source exists.

Cite the Leader utterances a term answers in `provenance.utterances`, as the `ni:///sha-256;…` addresses the leader-utterances records give them.

For a compound such as BAMBOO, put its constituents only on the compound carrier:

```json
{
  "termDirectory": "/absolute/path/to/content/text/glossary/terms",
  "authorizedRelationKeys": ["composed-of"],
  "term": {
    "filename": "bilattice-articulation-model-belief-orienting-operation.md",
    "identity": "bilattice-articulation-model-belief-orienting-operation",
    "name": "Bilattice Articulation Model Belief Orienting Operation",
    "keywords": ["bilattice", "articulation", "model", "belief", "orienting", "operation"],
    "composed-of": ["bilattice", "articulation"],
    "date-created": "2026-09-01",
    "body": "..."
  },
  "semanticEvidence": {
    "sources": ["/absolute/path/to/source.md"],
    "claims": {
      "definition": "An exact definition excerpt present in the body.",
      "distinction": "An exact distinction excerpt present in the body.",
      "consequence": "An exact engineering consequence excerpt present in the body."
    }
  }
}
```

Do not add `slug`, `defines`, `related`, `title`, reciprocal primitive backlinks, invented relation keys, or an H1 repeating `name`. Do not accept a carrier merely because it parses or links. If sources do not support the definition, refuse the write and report the missing knowledge instead of padding the file.
