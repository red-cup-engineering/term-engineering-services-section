import assert from "node:assert/strict";
import test from "node:test";
import { resolveTermRelationAuthority, recognizeTermMarkdownInVault } from "../src/term-relation-keys.mjs";
import { AUTHORIZED_RELATION_PREDICATES, RELATION_PREDICATE_RANGES, relationPredicateRange, renderTermMarkdown } from "../src/term-carrier.mjs";

test("relation authority is one explicit vocabulary, independent of glossary filenames", async () => {
  const authority = await resolveTermRelationAuthority({ paths: ["a/subject.md", "b/subject.md"] });
  assert.deepEqual(authority.relationKeysByPath["a/subject.md"], authority.relationKeysByPath["b/subject.md"]);
  assert.ok(authority.predicates.includes("acts-on"));
  assert.equal(authority.predicates.includes("subject"), false);
});

test("vault-aware recognition admits authorized nested relations and refuses invented ones", async () => {
  const good = renderTermMarkdown({ identity: "subject", name: "Subject", relations: { "acts-on": "system" }, body: "A subject is the entity about which this glossary record makes an explicit assertion." });
  assert.equal((await recognizeTermMarkdownInVault({ path: "scope/subject.md", text: good })).admitted, true);
  const bad = good.replace("acts-on: system", "invented: system");
  assert.equal((await recognizeTermMarkdownInVault({ path: "scope/subject.md", text: bad })).admitted, false);
});

test("every authorized predicate declares a range, and an unauthorized predicate has none", () => {
  assert.ok(AUTHORIZED_RELATION_PREDICATES.length > 0);
  for (const predicate of AUTHORIZED_RELATION_PREDICATES) {
    assert.ok(["carrier", "literal"].includes(RELATION_PREDICATE_RANGES[predicate]), `${predicate} must declare a carrier or literal range`);
  }
  assert.equal(relationPredicateRange("invented"), undefined);
});

test("a carrier-identity predicate and a literal predicate are distinguishable by range", () => {
  assert.equal(relationPredicateRange("acts-on"), "carrier");
  assert.equal(relationPredicateRange("baseline-cost"), "literal");
  assert.notEqual(relationPredicateRange("acts-on"), relationPredicateRange("baseline-cost"));
});

test("the medical-science relations are authorized carrier-range predicates", () => {
  for (const predicate of ["treated-by", "triggered-by", "operationalized-by", "subtype-of", "mediated-by", "overlaps-with", "shares-symptom-with", "analogous-to", "measured-by", "determines", "restricts", "diagnosed-by", "optimized-by"]) {
    assert.ok(AUTHORIZED_RELATION_PREDICATES.includes(predicate), `${predicate} must be authorized`);
    assert.equal(relationPredicateRange(predicate), "carrier", `${predicate} must declare a carrier range`);
  }
});

test("a carrier written with the new medical-science relations is admitted, matching the long-covid carrier's shape", async () => {
  const text = renderTermMarkdown({
    identity: "condition",
    name: "Condition",
    relations: {
      "treated-by": "intervention",
      "triggered-by": "exertion",
      "operationalized-by": "assessment-instrument",
      "subtype-of": "syndrome",
      "mediated-by": "cytokine",
      "overlaps-with": ["adjacent-condition"],
      "shares-symptom-with": ["fatigue"],
    },
    body: "A condition is a state of the organism this record documents distinctly from an adjacent one.",
  });
  const admitted = await recognizeTermMarkdownInVault({ path: "scope/condition.md", text });
  assert.equal(admitted.admitted, true);
  assert.deepEqual(admitted.relations["overlaps-with"], ["adjacent-condition"]);
});

test("the biochemical-mechanism relations are authorized carrier-range predicates", () => {
  for (const predicate of ["permits", "transrepresses", "impairs"]) {
    assert.ok(AUTHORIZED_RELATION_PREDICATES.includes(predicate), `${predicate} must be authorized`);
    assert.equal(relationPredicateRange(predicate), "carrier", `${predicate} must declare a carrier range`);
  }
});

test("the 2026-09-04 science-glossary-census relations are authorized with a declared range", () => {
  for (const [predicate, range] of [
    ["contrasts-with", "carrier"],
    ["part-of", "carrier"],
    ["enables", "carrier"],
    ["requires", "carrier"],
    ["instance-of", "carrier"],
    ["derives-from", "carrier"],
    ["cites", "carrier"],
    ["see-also", "carrier"],
    ["specialization", "carrier"],
    ["properties", "literal"],
  ]) {
    assert.ok(AUTHORIZED_RELATION_PREDICATES.includes(predicate), `${predicate} must be authorized`);
    assert.equal(relationPredicateRange(predicate), range, `${predicate} must declare a ${range} range`);
  }
});

test("a carrier written with the science-glossary-census relations is admitted", async () => {
  const text = renderTermMarkdown({
    identity: "concept",
    name: "Concept",
    relations: { "part-of": "domain", "derives-from": "referent", cites: "dahlberg1978", "see-also": "term", specialization: "formal-concept", properties: "closed extent-intent pair" },
    body: "A concept is the unit of knowledge this record documents by its characteristics, not by any one designation for it.",
  });
  const admitted = await recognizeTermMarkdownInVault({ path: "scope/concept.md", text });
  assert.equal(admitted.admitted, true);
  assert.equal(admitted.relations.cites, "dahlberg1978");
});

test("the 2026-09-04 refusal-histogram relations are authorized with a declared range", () => {
  for (const [predicate, range] of [
    ["component-of", "carrier"],
    ["produces", "carrier"],
    ["contains", "carrier"],
    ["introduces", "carrier"],
    ["class", "literal"],
    ["term-kind", "literal"],
  ]) {
    assert.ok(AUTHORIZED_RELATION_PREDICATES.includes(predicate), `${predicate} must be authorized`);
    assert.equal(relationPredicateRange(predicate), range, `${predicate} must declare a ${range} range`);
  }
});

test("a carrier written with the 2026-09-04 refusal-histogram relations is admitted", async () => {
  const text = renderTermMarkdown({
    identity: "tissue",
    name: "Tissue",
    relations: { "component-of": "organ", produces: "signal", contains: ["cell"], introduces: ["structure"], class: "biological", "term-kind": "object" },
    body: "A tissue is a structural layer this record documents by its own organization, not by the organ it composes.",
  });
  const admitted = await recognizeTermMarkdownInVault({ path: "scope/tissue.md", text });
  assert.equal(admitted.admitted, true);
  assert.equal(admitted.relations["component-of"], "organ");
  assert.deepEqual(admitted.relations.contains, ["cell"]);
});

test("a carrier written with the biochemical-mechanism relations is admitted", async () => {
  const text = renderTermMarkdown({
    identity: "hormone-carrier",
    name: "Hormone carrier",
    relations: { permits: "receptor", transrepresses: "transcription-factor", impairs: "respiration" },
    body: "A hormone carrier is a molecule this record documents by the transformations it enters, not by its concentration alone.",
  });
  const admitted = await recognizeTermMarkdownInVault({ path: "scope/hormone-carrier.md", text });
  assert.equal(admitted.admitted, true);
  assert.equal(admitted.relations.transrepresses, "transcription-factor");
});
