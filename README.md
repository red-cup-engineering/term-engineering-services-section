# @red-cup-engineering/term-engineering-services-section

Engineering policy and operations for semantically admitted Markdown glossary terms and their filename-keyword knowledge web.

## Verbs (`term` CLI, `apps/term-cli.mjs`)

- `render` — renders a term record to Markdown; reads a term record JSON object on stdin.
- `read` — reads one admitted term by path (argv[3]); reads nothing on stdin.
- `recognize` — parses a term Markdown carrier without admitting it; reads `{text, filename}` JSON on stdin.
- `admit` — recognizes and semantically admits a term Markdown carrier; reads `{text, filename, authorizedRelationKeys}` JSON on stdin.
- `write` — admits and durably writes one term carrier; reads a term write request JSON object on stdin.
- `index` — derives the glossary keyword web from a term directory (argv[3], default: cwd); reads nothing on stdin.
- `write-set` — writes each term in an array of write requests, then derives one loss-accounted web; reads a JSON array on stdin.

Run `term --help` (or with no arguments) for the same summary on stdout.
An unknown verb prints it to stderr and exits 2.

## Writing a term

The write contract — request shape, frontmatter admission, relation-key authorization, and evidence requirements — is documented in [`scripts/write-term.md`](scripts/write-term.md).
Read it before drafting any `write` or `write-set` request.
`writeTerm` enforces the evidence half of that contract (`admitSemanticEvidence`): a request without sources, without a definition, distinction and consequence each witnessed verbatim in the body (whitespace collapsed), or citing an absolute-path source that does not exist is refused before anything is written.
A term cites the Leader utterances it answers in `provenance.utterances`, as the `ni:///sha-256;…` addresses the leader-utterances records use.

## Carrier identity and assertions

The admission path (`recognizeTermMarkdown`, `admitTermMarkdown`, and the `*InVault` wrappers) preserves frontmatter assertions as they occur in the carrier:

- **Identity.**
  `identity` is derived from the Markdown filename stem when the frontmatter states none.
  An explicit `identity` must still equal the stem; a mismatch refuses admission.
- **Assertions.**
  Each frontmatter field is direct carrier content. The service neither classifies fields as metadata nor moves them into `provenance`, `relations`, or `status-function`. `type: intelligence`, `creator: Homo sapiens`, dates, tags, and relation predicates such as `requires: [light]` remain exactly where their author stated them.
  Existing nested objects are retained only when they were explicitly supplied; they are not a target form for migration.
- **Visibility.**
  `visibility` is `public` or `authenticated` (the default when absent). Only `public` opens a term to anonymous surfaces such as the public vocabulary and the knowledge garden's public tree.

## Corpus cleanup

`planMarkdownCorpusCleanup` (in `src/term-migration.mjs`) plans byte-preserving frontmatter edits over a Markdown corpus; `scripts/apply-set-of-terms.mjs` applies a plan (or any byte-matching subset of it) behind per-file revision guards, with a backup and restore on failure.
In glossary term directories it folds legacy org-roam, Obsidian, and Digital Garden keys into admitted slots before anything is deleted, so no assertion is lost:

- `defines`, `roam_aliases`, `roam_alias`, and a `title` that differs from `name` become `aliases` (a `title` equal to `name` is just removed).
- `related` and `related-to` become `see-also` (inside `relations` when the carrier already nests them); a Markdown link keeps its target's stem.
- `date` and `created` become `date-created`; one that disagrees with an existing `date-created` stays put.
- `roam_refs` becomes `provenance.sources`.
- `dg-publish: true` becomes `visibility: public`; a flag that disagrees with the stated visibility stays put, and a `dg-permalink` equal to the stem is removed.

A key the fold cannot place without guessing is left where it is, which keeps its carrier unadmitted and visible to the next pass.

## Tests

`npm test` runs the package's `node --test` suite.

## Glossary index

`scripts/project-set-of-term-records.mjs` (bin `project-set-of-term-records`) walks a root for glossary carriers, the Markdown files under any section's `content/text/glossary/{terms,concepts,topics}/`, reads each through the house file-read service, and writes a deterministic `computer-glossary-index.v2` JSON index (`--root <dir> --out <file.json>`).
Terms, concepts and topics are one carrier kind, admitted by the same rules.
`src/glossary-index.mjs` (the `./glossary-index` export) is the pure, filesystem-free reader over that index: `projectGlossaryIndex({ root, documents })` derives it and `createGlossaryIndexReader(index)` binds `resolve(identity)`, `neighborhood(identity)`, and `search(query, { limit })` over it.
Each record carries `section` (the first `services/<name>` beneath the root), `scheme` (the whole root-relative directory owning the glossary), `facet` (`term`, `concept` or `topic`), and `token` (its concept token, below), so one index over the whole 561 Group still tells every section's glossary apart.
`createNearestSchemeResolver(records)` is the one rule for what a relation's target identity names: the record in the nearest scheme up then down the section tree, with an equally near tie left unresolved. The SKOS and foam projections both use it.
It is generic over any glossary; nothing domain-specific is named here.

## Glossary tokens

`src/glossary-token.mjs` (the `./glossary-token` export) makes every glossary carrier SignCell typed marks (`@red-cup-engineering/signcell/typed-mark`), each identified by its semiotic content address. There are four kinds:

- a **sign**, `{ identity }`: the bare word, shared by every section that files it;
- a **concept**, `{ scheme, identity }`: one section's meaning of a sign, stable while its definition is revised, so relations aimed at it do not move when its text does (`glossaryConceptId` computes it without minting; it is each index record's `token`);
- a **definition**: one admitted carrier's content without its file location, bound to its concept, readdressed whenever the carrier changes;
- a **scheme**, `{ scheme }`: the section that files the concept.

Schemes are named by `schemeIriPath`, so a concept's token and its SKOS IRI name the same section.

## Glossary foam

`src/glossary-foam.mjs` (the `./glossary-foam` export) projects a glossary index into one semiotic foam (schema `computer-glossary-foam.v1`): a SignCell `sign.graph` whose cells are the tokens and whose edges each carry the definition that asserts them as witness.

- **Edges.** Every concept has `skos:notation` to its sign, `skos:inScheme` to its scheme and `skos:definition` to its definition; keywords are `skos:broader`, and every carrier-range relation stays under its house predicate IRI (`https://561.group/ns/predicate/<name>`), as in the SKOS projection.
- **Cuts.** Each section's glossary is one graph cut with its own content address; the foam is the cuts glued (`glueSignGraphs`). Revising one definition readdresses that definition, its section's cut and the foam, never its concept or another section's cut.
- **Wanted signs.** A relation whose target no projected concept answers lands on the target's sign, so no assertion is lost; signs that relations reach but no carrier defines are listed in `wanted`, most wanted first. Targets that are not carrier identities (free text) are counted as `unaddressableTargets`.
- **Diagnostics.** A concept filed twice in one section (a term and a topic of one identity) keeps both definitions and is reported.
- **Audience.** As in the SKOS projection.

`scripts/project-glossary-foam.mjs` (bin `project-glossary-foam`, `--root --index --out [--audience public|authenticated]`) indexes a root and writes both. Over the whole 561 Group the authenticated foam takes about 75 seconds and 850 MB, and is about 40 MB; it is derived on demand.

## SKOS vocabulary

`src/glossary-skos.mjs` (the `./glossary-skos` export) projects a glossary index into a [W3C SKOS](https://www.w3.org/TR/skos-reference/) vocabulary serialized as JSON-LD (schema `computer-glossary-skos.v3`), so RDF, thesaurus, and schema.org consumers can all read the house glossaries.
Nodes come from the data layer's shared builders (`definedTermJsonLd`, `definedTermSetJsonLd` in `@red-cup-engineering/computer-triplet-serialized-content-engineering-services-section/schema-org`): each owning section is a `DefinedTermSet` and `skos:ConceptScheme`, and each admitted term a `DefinedTerm` and `skos:Concept`.

- **IRIs.** A concept is `<base><scheme path>/<identity>` (base `https://561.group/knowledge/`); `schemeIriPath` drops the `services/` connectors, so an IRI depends on the section path alone, never on what else was indexed.
- **Fields.** Name is `name`/`skos:prefLabel`, aliases `skos:altLabel`, the description schema.org `description`, the body `skos:definition`, the identity `termCode`/`skos:notation`, the concept token `dct:identifier`, the carrier `type` `dct:type`. A term and a topic of one identity in one section are one concept: the first is published and the rest counted as `refiledConcepts`.
- **Relations.** Carrier-range relations and keywords resolve to the nearest projected concept in the section tree (a tie stays unresolved and is counted). `subtype-of`, `instance-of`, `part-of`, `component-of` and keywords become `skos:broader`; `types`, `components`, `composed-of`, `contains` and `includes` become `skos:narrower`; every other predicate becomes `skos:related`. Each also stays under its house predicate IRI (`https://561.group/ns/predicate/<name>`, the shape GEODE serves). Every reference is an `@id` node.
- **Audience.** `audience: "public"` (the default) projects only terms whose own carrier says `visibility: public`, the house surface policy's single public opt-in; `"authenticated"` projects every admitted term. A term stating any `consent-status` is withheld from both.

`scripts/project-glossary-skos.mjs` (bin `project-glossary-skos`, `--root --index --out [--base] [--audience public|authenticated]`) indexes a root and writes both.

`recognizeTermDocument({ frontmatter, body, filename })` is the recognition path for a carrier some other reader already parsed (a vault room, say); `recognizeTermMarkdown` parses and delegates to it.
