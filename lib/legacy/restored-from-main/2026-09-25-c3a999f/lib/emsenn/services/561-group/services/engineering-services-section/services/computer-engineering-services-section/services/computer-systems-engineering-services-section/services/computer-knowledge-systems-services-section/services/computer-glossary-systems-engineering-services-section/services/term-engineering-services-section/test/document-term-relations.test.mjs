import assert from "node:assert/strict";
import test from "node:test";
import {
  declaredKeywordsOf,
  declaredRelationsOf,
  declaredTitleOf,
  foldTermIdentities,
  foldTermIdentity,
  projectDocumentTermRows,
  unresolvedTermGaps,
} from "../src/document-term-relations.mjs";

test("foldTermIdentity lowercases and hyphenates, and refuses what will not fold", () => {
  assert.equal(foldTermIdentity("Proof Path"), "proof-path");
  assert.equal(foldTermIdentity("  quoted-value  "), "quoted-value");
  assert.equal(foldTermIdentity(42), null);
  assert.equal(foldTermIdentity(""), null);
});

test("foldTermIdentities flattens nested arrays and drops what does not fold", () => {
  assert.deepEqual(foldTermIdentities(["Alpha", ["Beta", 3], "Alpha"]), ["alpha", "beta", "alpha"]);
  assert.deepEqual(foldTermIdentities("Solo"), ["solo"]);
});

test("declaredKeywordsOf reads a keyword list and a comma-separated string alike, deduplicated", () => {
  assert.deepEqual(declaredKeywordsOf({ keywords: ["sociology", "proof-path", "proof-path"] }), ["sociology", "proof-path"]);
  assert.deepEqual(declaredKeywordsOf({ keywords: "sociology, proof-path" }), ["sociology", "proof-path"]);
  assert.deepEqual(declaredKeywordsOf({}), []);
  assert.deepEqual(declaredKeywordsOf(undefined), []);
});

test("declaredTitleOf trims a string title and reports null otherwise", () => {
  assert.equal(declaredTitleOf({ title: "  Organizing Sociology by Proof Path  " }), "Organizing Sociology by Proof Path");
  assert.equal(declaredTitleOf({ title: "   " }), null);
  assert.equal(declaredTitleOf({}), null);
  assert.equal(declaredTitleOf({ title: 7 }), null);
});

test("declaredRelationsOf projects only the requested keys and counts values that named no concept", () => {
  const { assertions, unnamed } = declaredRelationsOf({
    path: "a.md",
    frontmatter: { "composed-of": ["alpha", 7], "baseline-cost": "3 story points", ignored: "beta" },
    relationKeys: ["composed-of", "baseline-cost"],
  });
  assert.deepEqual(assertions, [
    { path: "a.md", relation: "composed-of", concept: "alpha", polarity: "positive" },
    { path: "a.md", relation: "baseline-cost", concept: "3 story points", polarity: "positive" },
  ]);
  assert.equal(unnamed, 1);
});

// A note with keywords: an ordinary (non-term) document's frontmatter keywords and title become
// declares-keyword/titled rows, exactly the capability the corpus-wide graph was missing.
test("a note with keywords and a title projects declares-keyword and titled assertions", () => {
  const { assertions, unnamed } = projectDocumentTermRows({
    path: "services/sociology-science-services-section/content/text/triage/organizing-sociology-by-proof-path.md",
    frontmatter: {
      title: "Organizing Sociology by Proof Path",
      keywords: ["sociology", "archive-organization", "curry-howard", "directionality", "yoneda-embedding", "proof-path"],
    },
  });
  assert.equal(unnamed, 0);
  const byRelation = (relation) => assertions.filter((assertion) => assertion.relation === relation).map(({ concept }) => concept);
  assert.deepEqual(byRelation("declares-keyword"), ["sociology", "archive-organization", "curry-howard", "directionality", "yoneda-embedding", "proof-path"]);
  assert.deepEqual(byRelation("titled"), ["Organizing Sociology by Proof Path"]);
});

// A note with an undefined keyword: the keyword still produces a findable row (unresolvedTermGaps
// is the separate, corpus-wide judgement of whether anything defines it).
test("a note with a keyword no carrier defines still projects the row; unresolvedTermGaps names the gap", () => {
  const { assertions } = projectDocumentTermRows({
    path: "notes/undefined-keyword.md",
    frontmatter: { title: "Undefined keyword note", keywords: ["proof-path"] },
  });
  assert.deepEqual(assertions.map(({ relation, concept }) => [relation, concept]), [
    ["declares-keyword", "proof-path"],
    ["titled", "Undefined keyword note"],
  ]);
  const knownTerms = new Set(["sociology"]); // "proof-path" is not among the corpus's defined terms
  const gaps = unresolvedTermGaps(assertions, knownTerms);
  assert.deepEqual(gaps, [{ path: "notes/undefined-keyword.md", relation: "declares-keyword", term: "proof-path" }]);
});

test("unresolvedTermGaps never flags a titled or literal-range assertion, and never flags a resolved one", () => {
  const assertions = [
    { path: "a.md", relation: "titled", concept: "Some Title Words" },
    { path: "a.md", relation: "baseline-cost", concept: "3 points" }, // literal range, not a term
    { path: "a.md", relation: "composed-of", concept: "known-part" }, // carrier range, resolved
    { path: "a.md", relation: "composed-of", concept: "missing-part" }, // carrier range, unresolved
  ];
  const gaps = unresolvedTermGaps(assertions, new Set(["known-part"]));
  assert.deepEqual(gaps, [{ path: "a.md", relation: "composed-of", term: "missing-part" }]);
});

// A term carrier: its own normalized `relations` map keys still project as before, scoped to the
// keys the term contract actually admitted for it, not the full authorized vocabulary.
test("a term carrier's projection is scoped to its own normalized relation keys, not the full vocabulary", () => {
  const { assertions, unnamed } = projectDocumentTermRows({
    path: "content/text/glossary/terms/work-unit.md",
    frontmatter: { identity: "work-unit", name: "Work Unit", "instance-of": "work", requires: "skill-result" },
    relationKeys: ["instance-of", "requires"],
  });
  assert.equal(unnamed, 0);
  assert.deepEqual(assertions.map(({ relation, concept }) => [relation, concept]), [
    ["instance-of", "work"],
    ["requires", "skill-result"],
  ]);
});
