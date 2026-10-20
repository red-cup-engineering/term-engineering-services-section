import assert from "node:assert/strict";
import test from "node:test";
import { glossaryClaimsAt } from "../src/glossary-claims.mjs";
import { FOAM_PREDICATES, projectGlossaryFoam } from "../src/glossary-foam.mjs";
import { createGlossaryIndexReader, projectGlossaryIndex } from "../src/glossary-index.mjs";
import { glossaryAudienceAdmits } from "../src/glossary-skos.mjs";
import { glossaryConceptToken, glossarySignToken } from "../src/glossary-token.mjs";
import { renderTermMarkdown } from "../src/term-carrier.mjs";

const ALPHA = "services/alpha-services-section";
const BETA = "services/beta-services-section";
const body = "A team is an admitted group of performing characters with an authored collaborative purpose."; 
const word = (scheme, facet, identity, visible = true) => ({
  path: scheme + "/content/text/glossary/" + facet + "/" + identity + ".md",
  filename: identity + ".md",
  text: renderTermMarkdown({ identity, name: identity, body,
    ...(visible ? { visibility: "public" } : {}) }),
});
const foam = documents => projectGlossaryFoam(projectGlossaryIndex({ root: "/glossary", documents }));

test("one source-native claim merges two witnessed definition facets, not their concept identity", () => {
  const source = foam([word(ALPHA, "terms", "team"), word(ALPHA, "topics", "team")]);
  const selected = glossaryClaimsAt(source, { scheme: ALPHA, identity: "team", predicate: FOAM_PREDICATES.notation });
  assert.equal(selected.kind, "computer-glossary-signcell-readings.v1");
  assert.equal(selected.cells.length, 1);
  assert.equal(selected.cells[0].subject.id, glossaryConceptToken(ALPHA, "team").id);
  assert.equal(selected.cells[0].object.id, glossarySignToken("team").id);
  assert.equal(selected.cells[0].for.length, 2);
  assert.deepEqual(selected.cells[0].against, []);
  assert.equal(selected.sources[0].edges.length, 2);
  assert.equal(selected.sourceStatementsOnly, true);
  assert.equal(selected.knowledgeTruthEstablished, false);
  assert.equal(selected.relationToKinematicPointProved, false);
});

test("lexically identical signs in different schemes cannot supply each other claim witnesses", () => {
  const source = foam([word(ALPHA, "terms", "team"), word(BETA, "terms", "team")]);
  const a = glossaryClaimsAt(source, { scheme: ALPHA, identity: "team", predicate: FOAM_PREDICATES.notation });
  const b = glossaryClaimsAt(source, { scheme: BETA, identity: "team", predicate: FOAM_PREDICATES.notation });
  assert.notEqual(a.concept.id, b.concept.id);
  assert.equal(a.cells.length, 1);
  assert.equal(b.cells.length, 1);
  assert.equal(a.cells[0].for.length, 1);
  assert.equal(b.cells[0].for.length, 1);
  assert.notEqual(a.cells[0].subject.id, b.cells[0].subject.id);
});

test("no unseen claim becomes denial, and hidden concept cannot be recovered via public foam", () => {
  const source = foam([word(ALPHA, "terms", "team"), word(ALPHA, "terms", "secret", false)]);
  const absent = glossaryClaimsAt(source, { scheme: ALPHA, identity: "team", predicate: "https://561.group/ns/predicate/nonexistent" });
  assert.deepEqual(absent.cells, []);
  assert.deepEqual(absent.sources, []);
  assert.equal(absent.section.readings.contested, 0);
  assert.throws(() => glossaryClaimsAt(source, { scheme: ALPHA, identity: "secret" }), TypeError);
  assert.throws(() => glossaryClaimsAt(source, { scheme: ALPHA, identity: "team", actor: "someone-else" }), /exact scheme/);
});


test("querying a local foam refuses boundary-only concept references rather than inventing absence", () => {
  const index = projectGlossaryIndex({ root: "/glossary", documents: [
    word(ALPHA, "terms", "team"), word(BETA, "terms", "team"),
  ] });
  const selected = projectGlossaryFoam(index, {
    concept: { scheme: ALPHA, identity: "team" },
  });
  const local = glossaryClaimsAt(selected, { scheme: ALPHA, identity: "team", predicate: FOAM_PREDICATES.notation });
  const whole = glossaryClaimsAt(projectGlossaryFoam(index),
    { scheme: ALPHA, identity: "team", predicate: FOAM_PREDICATES.notation });
  assert.deepEqual(local.cells, whole.cells);
  assert.deepEqual(local.sources, whole.sources);
  assert.throws(() => glossaryClaimsAt(selected, { scheme: BETA, identity: "team" }), /outside the selected source cut/);
});

test("an authorized Mandarin lexical hit reaches that sense's original source-witnessed SignCell claims", () => {
  // The original glossary producer performs scope admission; neither a
  // lexical spelling nor a model-selected actor can grant source knowledge.
  const term = (scheme, identity, name, aliases = [], visible = true) => ({
    path: scheme + "/content/text/glossary/terms/" + identity + ".md",
    filename: identity + ".md",
    text: renderTermMarkdown({ identity, name, aliases, body,
      ...(visible ? { visibility: "public" } : {}) }),
  });
  const index = projectGlossaryIndex({ root: "/glossary", documents: [
    term(ALPHA, "language-space", "语言空间", ["L-Space", "語言空間"]),
    term(BETA, "language-space", "语义空间"),
    term(ALPHA, "private-lexeme", "秘密术语", [], false),
  ] });
  const visible = Object.freeze({
    ...index, records: Object.freeze(index.records.filter(record =>
      glossaryAudienceAdmits(record, "public"))),
  });
  const reader = createGlossaryIndexReader(visible);
  const hits = reader.search("空间");
  assert.equal(hits.length, 2);
  assert.equal(new Set(hits.map(hit => hit.sign)).size, 1,
    "both schemes use the same lexical SignCell sign, not one meaning");
  assert.equal(new Set(hits.map(hit => hit.token)).size, 2,
    "distinct source concept tokens retain their own definitions");
  assert.deepEqual(reader.search("L-Space").map(hit => hit.scheme), [ALPHA],
    "the English spelling belongs only to the explicitly authored alias");
  assert.deepEqual(reader.search("秘密"), [], "public search cannot enumerate gated terms");
  const chosen = hits.find(hit => hit.scheme === ALPHA);
  assert.ok(chosen);
  const local = projectGlossaryFoam(index, {
    audience: "public", concept: { scheme: chosen.scheme, identity: chosen.identity },
  });
  const claim = glossaryClaimsAt(local, {
    scheme: chosen.scheme, identity: chosen.identity, predicate: FOAM_PREDICATES.notation,
  });
  assert.equal(claim.concept.id, chosen.token);
  assert.equal(claim.cells.length, 1);
  assert.equal(claim.cells[0].subject.id, chosen.token);
  assert.equal(claim.cells[0].object.id, glossarySignToken("language-space").id);
  assert.equal(claim.cells[0].for.length, 1);
  assert.deepEqual(claim.cells[0].against, []);
  assert.equal(claim.sources[0].edges.length, 1);
  assert.equal(claim.sourceStatementsOnly, true);
  assert.equal(claim.knowledgeTruthEstablished, false);
  assert.throws(() => glossaryClaimsAt(local, {
    scheme: BETA, identity: chosen.identity,
  }), /outside the selected source cut/,
    "a neighbor's typed concept does not grant access to its definitions");
});
