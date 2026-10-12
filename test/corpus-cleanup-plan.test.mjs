import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  classifyMarkdownCorpusPath,
  extractIsoDateFromFrontmatterValue,
  kebabCaseIdentitySlug,
  migrateReferencesListToMap,
  planIdentityRenames,
  planMarkdownCorpusCleanup,
  prepareMarkdownCorpusCleanupDocument,
  selectMarkdownCorpusCleanupTransactionsByActionKinds,
  verifyMarkdownCorpusCleanupPlan,
} from "../src/term-migration.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

test("plans CRLF term cleanup while preserving comments, order, body, and fenced H1 bytes", () => {
  const input = "---\r\nslug: model\r\n# exact comment\r\nname: model\r\ntitle: Model\r\ntype: term\r\npart-of: world\r\nkeep: [one, two]\r\nrelated:\r\n  - other\r\n---\r\n# Model\r\n\r\n```md\r\n# Model\r\n```\r\nBody.\r\n";
  const expected = "---\r\n# exact comment\r\nname: Model\r\nkeep: [one, two]\r\nsee-also: other\r\n---\r\n\r\n```md\r\n# Model\r\n```\r\nBody.\r\n";
  const documents = [{ relativePath: "content/text/glossary/terms/model.md", text: input }];
  const plan = planMarkdownCorpusCleanup(documents);
  assert.deepEqual(plan.counts, { input: 1, planned: 1, refused: 0, unchanged: 0, excluded: 0 });
  assert.equal(plan.transactions[0].beforeSha256, sha256(input));
  assert.equal(plan.transactions[0].proposedAfterSha256, sha256(expected));
  assert.equal(plan.transactions[0].bytePreservation.verified, true);
  assert.deepEqual(plan.transactions[0].actions.map(({ operation, key }) => [operation, key]), [
    ["fold-frontmatter-key-into-relation", "related"],
    ["delete-frontmatter-key", "slug"],
    ["delete-frontmatter-key-value", "part-of"],
    ["delete-frontmatter-key-value", "type"],
    ["rename-frontmatter-key", undefined],
    ["remove-repeated-h1", undefined],
  ]);
  assert.equal(verifyMarkdownCorpusCleanupPlan(plan, documents).valid, true);
});

test("deletes generic keys despite malformed unrelated YAML without serializing it", () => {
  const input = "---\r\nslug: example\r\n# exact\r\nbroken: [one\r\nrelated: other\r\nname: Example\r\n---\r\nBody.\r\n";
  const expected = "---\r\n# exact\r\nbroken: [one\r\nname: Example\r\n---\r\nBody.\r\n";
  const plan = planMarkdownCorpusCleanup([{ relativePath: "notes/example.md", text: input }]);
  assert.equal(plan.refusals.length, 0);
  assert.equal(plan.transactions[0].proposedAfterSha256, sha256(expected));
});

test("refuses duplicate targets and ambiguous nested targets", () => {
  const plan = planMarkdownCorpusCleanup([
    { relativePath: "notes/duplicate.md", text: "---\nslug: one\nslug: two\n---\nBody\n" },
    { relativePath: "notes/nested.md", text: "---\nmalformed: [one\ncontainer:\n  related: other\n---\nBody\n" },
  ]);
  assert.deepEqual(plan.refusals.map(({ reasonClass }) => reasonClass).sort(), ["ambiguous-nested-key", "duplicate-key"]);
  assert.equal(plan.transactions.length, 0);
});

test("a title beside an explicit name other than the stem becomes an alias, or goes when it repeats the name", () => {
  const differing = prepareMarkdownCorpusCleanupDocument({ relativePath: "glossary/terms/model.md", text: "---\nname: Other\ntitle: Model\n---\nBody\n" });
  assert.equal(differing.output, "---\nname: Other\naliases:\n  - Model\n---\nBody\n");
  const repeating = prepareMarkdownCorpusCleanupDocument({ relativePath: "glossary/terms/model.md", text: "---\nname: Other\ntitle: Other\n---\nBody\n" });
  assert.equal(repeating.output, "---\nname: Other\n---\nBody\n");
});

test("legacy Org-roam and digital-garden keys fold into admitted slots, losing no label, link, date, source, or publish choice", () => {
  const text = [
    "---", "name: X", "defines:", "  - \"X\"", "  - x-ish", "aliases: [ Ex ]", "date: \"\\\\[2025-08-29 Fri 20:55\\\\]\"",
    "roam-refs: \"https://e.org/x\"", "dg-publish: true", "related-to:", "  - \"[Y term](../y.md)\"", "---", "Body", "",
  ].join("\n");
  const folded = prepareMarkdownCorpusCleanupDocument({ relativePath: "content/text/glossary/terms/x.md", text });
  assert.equal(folded.output, [
    "---", "name: X", "aliases: [ Ex, x-ish ]", "see-also: y", "date-created: 2025-08-29", "provenance:", "  sources:", "    - https://e.org/x",
    "visibility: public", "---", "Body", "",
  ].join("\n"));
  assert.deepEqual(folded.actions.map(({ operation }) => operation), [
    "fold-frontmatter-key-into-aliases", "fold-frontmatter-key-into-relation", "fold-frontmatter-date-into-date-created",
    "fold-frontmatter-key-into-provenance-sources", "fold-publish-flag-into-visibility",
  ]);
});

test("a legacy key that disagrees with a stated slot stays for review", () => {
  const text = "---\nname: X\ndate-created: 2025-01-01\ndate: 2025-08-29\nvisibility: public\ndg-publish: false\n---\nBody\n";
  const kept = prepareMarkdownCorpusCleanupDocument({ relativePath: "content/text/glossary/terms/x.md", text });
  assert.equal(kept.disposition, "unchanged");
});

test("resolves title-name collisions exactly when current name is the filename stem", () => {
  const replacement = planMarkdownCorpusCleanup([{ relativePath: "terms/model.md", text: "---\nname: model\ntitle: Model\n---\nBody\n" }]);
  assert.equal(replacement.transactions[0].proposedAfterSha256, sha256("---\nname: Model\n---\nBody\n"));
  const equal = planMarkdownCorpusCleanup([{ relativePath: "terms/model.md", text: "---\nname: model\ntitle: model\n---\nBody\n" }]);
  assert.equal(equal.transactions[0].proposedAfterSha256, sha256("---\nname: model\n---\nBody\n"));
});

test("matches the old part-of contamination and type term by exact scalar value", () => {
  const plan = planMarkdownCorpusCleanup([
    { relativePath: "notes/old.md", text: "---\npart-of: world\n---\nBody\n" },
    { relativePath: "notes/case.md", text: "---\npart-of: World\n---\nBody\n" },
    { relativePath: "notes/list.md", text: "---\npart-of: [world]\n---\nBody\n" },
    { relativePath: "terms/not-term.md", text: "---\ntype: concept\nname: Not Term\n---\nBody\n" },
  ]);
  assert.equal(plan.counts.planned, 1);
  assert.equal(plan.counts.unchanged, 3);
  assert.deepEqual(plan.transactions[0].actions, [{ operation: "delete-frontmatter-key-value", key: "part-of", value: "world" }]);
});

test("excludes repository-ignored, generated, and dependency paths", () => {
  const plan = planMarkdownCorpusCleanup([
    { relativePath: "ignored/note.md", ignored: true, text: "---\nslug: one\n---\n" },
    { relativePath: "pkg/node_modules/dep/readme.md", text: "---\nslug: two\n---\n" },
    { relativePath: "pkg/dist/readme.md", text: "---\nslug: three\n---\n" },
  ]);
  assert.deepEqual(plan.counts, { input: 3, planned: 0, refused: 0, unchanged: 0, excluded: 3 });
  assert.deepEqual(plan.excluded.map(({ reason }) => reason), ["ignored-by-repository", "generated-tree", "dependency-tree"]);
  assert.equal(classifyMarkdownCorpusPath("content/terms/model.md").termDirectory, true);
});

test("extractIsoDateFromFrontmatterValue extracts the embedded date and returns null for a bare date or none at all", () => {
  assert.equal(extractIsoDateFromFrontmatterValue("[[2025-04-27]]"), "2025-04-27");
  assert.equal(extractIsoDateFromFrontmatterValue("2026-03-03T00:00:00"), "2026-03-03");
  assert.equal(extractIsoDateFromFrontmatterValue("2025-04-27"), null);
  assert.equal(extractIsoDateFromFrontmatterValue("no date here"), null);
  assert.equal(extractIsoDateFromFrontmatterValue(42), null);
});

test("a wiki-linked date-created value in a term-directory carrier is planned to normalize to its embedded ISO date", () => {
  const input = "---\nname: Redshift\ndate-created: \"[[2025-04-27]]\"\n---\nRedshift is documented here for the fixture.\n";
  const plan = planMarkdownCorpusCleanup([{ relativePath: "content/text/glossary/terms/redshift.md", text: input }]);
  assert.equal(plan.counts.planned, 1);
  assert.deepEqual(plan.transactions[0].actions, [{ operation: "normalize-date-frontmatter-value", key: "date-created", from: "[[2025-04-27]]", to: "2025-04-27" }]);
  assert.equal(verifyMarkdownCorpusCleanupPlan(plan, [{ relativePath: "content/text/glossary/terms/redshift.md", text: input }]).valid, true);
});

test("a date-created value carrying no ISO date at all stays unchanged, the refusal the contract keeps", () => {
  const input = "---\nname: Redshift\ndate-created: not-a-date-at-all\n---\nRedshift is documented here for the fixture.\n";
  const plan = planMarkdownCorpusCleanup([{ relativePath: "content/text/glossary/terms/redshift.md", text: input }]);
  assert.deepEqual(plan.counts, { input: 1, planned: 0, refused: 0, unchanged: 1, excluded: 0 });
});

test("migrateReferencesListToMap builds a complete reference only when authors, title, and year are recoverable without invention", () => {
  const ok = migrateReferencesListToMap([{ id: "bousso2002", title: "The Holographic Principle", author: [{ family: "Bousso", given: "Raphael" }], issued: [{ year: 2002 }] }]);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.map.bousso2002, { authors: ["Raphael Bousso"], title: "The Holographic Principle", year: 2002 });
  assert.equal(migrateReferencesListToMap([{ id: "bousso2002", title: "The Holographic Principle" }]).ok, false);
  assert.equal(migrateReferencesListToMap([{ id: "Not-Lowercase2020", title: "X", author: ["A"], issued: { year: 2020 } }]).ok, false);
  assert.equal(migrateReferencesListToMap([]).ok, false);
  assert.equal(migrateReferencesListToMap("not-a-list").ok, false);
});

test("migrateReferencesListToMap recovers the CSL-JSON uppercase URL/DOI keys, not only lowercase url/doi", () => {
  const migrated = migrateReferencesListToMap([{ id: "mikolov2013", title: "Efficient Estimation of Word Representations in Vector Space", author: [{ literal: "T. Mikolov" }], issued: [{ year: 2013 }], URL: "https://arxiv.org/abs/1301.3781" }]);
  assert.equal(migrated.ok, true);
  assert.equal(migrated.map.mikolov2013.url, "https://arxiv.org/abs/1301.3781");
});

test("a references list with a recognizable citekey on every entry is planned to migrate to the term schema's citekey map", () => {
  const input = "---\nname: Black Holes\nreferences:\n  - id: bekenstein1973\n    type: document\n    title: Black Holes and Entropy\n    author:\n      - literal: J. D. Bekenstein\n    container-title: Physical Review D\n    issued:\n      - year: 1973\n---\nBlack holes are documented here for the fixture.\n";
  const plan = planMarkdownCorpusCleanup([{ relativePath: "content/text/glossary/terms/black-holes.md", text: input }]);
  assert.equal(plan.counts.planned, 1);
  assert.deepEqual(plan.transactions[0].actions, [{ operation: "migrate-references-list-to-map", key: "references", entries: 1 }]);
});

test("a references list without a recognizable citekey on every entry is left unchanged, never partially migrated", () => {
  const input = "---\nname: Climate\nreferences:\n  - id: Hansen2025Colorful\n    title: Warning\n    author:\n      - family: Hansen\n        given: James\n    issued:\n      - year: 2025\n---\nClimate is documented here for the fixture.\n";
  const plan = planMarkdownCorpusCleanup([{ relativePath: "content/text/glossary/terms/climate.md", text: input }]);
  assert.deepEqual(plan.counts, { input: 1, planned: 0, refused: 0, unchanged: 1, excluded: 0 });
});

test("kebabCaseIdentitySlug lowercases, hyphenates spaces and underscores, drops non-alphanumerics, and collapses hyphens", () => {
  assert.equal(kebabCaseIdentitySlug("Some Term_Name"), "some-term-name");
  assert.equal(kebabCaseIdentitySlug("Weird!!Chars??"), "weirdchars");
  assert.equal(kebabCaseIdentitySlug("already-kebab"), "already-kebab");
  assert.equal(kebabCaseIdentitySlug("--Leading And Trailing--"), "leading-and-trailing");
});

test("planIdentityRenames plans a kebab-case rename for a non-kebab term stem and counts same-section link references, never touching another section", () => {
  const documents = [
    { relativePath: "services/alpha-services-section/content/text/glossary/terms/Some_Term.md", text: "---\nname: Some Term\n---\nBody.\n" },
    { relativePath: "services/alpha-services-section/content/text/documents/notes/note.md", text: "See [Some Term](../../../glossary/terms/Some_Term.md) for more." },
    { relativePath: "services/beta-services-section/content/text/documents/notes/other.md", text: "See [Some Term](../../glossary/terms/Some_Term.md) elsewhere." },
  ];
  const plan = planIdentityRenames(documents);
  assert.deepEqual(plan.counts, { candidates: 1, planned: 1, collisions: 0 });
  const [rename] = plan.renames;
  assert.equal(rename.currentStem, "Some_Term");
  assert.equal(rename.plannedIdentity, "some-term");
  assert.equal(rename.plannedPath, "services/alpha-services-section/content/text/glossary/terms/some-term.md");
  assert.equal(rename.section, "services/alpha-services-section");
  assert.equal(rename.linkUpdateCount, 1);
  assert.deepEqual(rename.linkUpdatePaths, ["services/alpha-services-section/content/text/documents/notes/note.md"]);
});

test("planIdentityRenames flags a collision on both sides when two candidates in the same directory would slug to the same identity, and never applies any rename", () => {
  const documents = [
    { relativePath: "terms/Some Term.md", text: "Body" },
    { relativePath: "terms/some_term.md", text: "Body" },
  ];
  const plan = planIdentityRenames(documents);
  assert.deepEqual(plan.counts, { candidates: 2, planned: 0, collisions: 2 });
  assert.ok(plan.renames.every((rename) => rename.collision === true));
});

test("selectMarkdownCorpusCleanupTransactionsByActionKinds keeps only transactions whose actions are entirely within the named kinds", () => {
  const dateOnly = { relativePath: "content/text/glossary/terms/redshift.md", text: "---\nname: Redshift\ndate-created: \"[[2025-04-27]]\"\n---\nRedshift is documented here for the fixture.\n" };
  const mixed = { relativePath: "content/text/glossary/terms/mixed.md", text: "---\nslug: mixed\nname: Mixed\ndate-created: \"[[2025-04-27]]\"\n---\nMixed carries both a legacy key and a date to normalize.\n" };
  const plan = planMarkdownCorpusCleanup([dateOnly, mixed]);
  assert.equal(plan.counts.planned, 2);
  const selected = selectMarkdownCorpusCleanupTransactionsByActionKinds(plan, ["normalize-date-frontmatter-value"]);
  assert.equal(selected.transactions.length, 1);
  assert.equal(selected.transactions[0].path, "content/text/glossary/terms/redshift.md");
  assert.equal(selected.counts.planned, 1);
});

test("repeated H1 removal uses canonical declarations and preserves mixed newline source bytes", () => {
  const prefix = "---\r\nname: Model\r\ndescription: |\r\n  # Model\r\n---\r\n";
  const fenced = "~~~~md\r\n# Model\n~~~~\r\n";
  const result = prepareMarkdownCorpusCleanupDocument({ relativePath: "notes/model.md", text: prefix + fenced + "Model\r\n=====\n\nText é.\r\n" });
  assert.equal(result.disposition, "planned");
  assert.equal(result.output, prefix + fenced + "\nText é.\r\n");
  assert.deepEqual(result.actions, [{ operation: "remove-repeated-h1", handle: "Model", line: 9 }]);
});
