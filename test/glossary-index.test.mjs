import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { projectSetOfTermRecords } from "../scripts/project-set-of-term-records.mjs";
import { createGlossaryIndexReader, createNearestSchemeResolver, facetOf, projectGlossaryIndex, schemeOf } from "../src/glossary-index.mjs";
import { glossaryConceptToken, glossarySignToken } from "../src/glossary-token.mjs";
import { renderTermMarkdown } from "../src/term-carrier.mjs";

const operationBody = "An operation is a well-defined unit of work with a stated input and output that a system carries out.";

function fixtureDocuments() {
  const operation = renderTermMarkdown({ identity: "operation", name: "Operation", body: operationBody });
  const subOperation = renderTermMarkdown({
    identity: "sub-operation",
    name: "Sub Operation",
    aliases: ["child operation"],
    keywords: ["operation"],
    relations: { "subtype-of": "operation" },
    description: "A sub-operation is an operation specialized to one narrower stated purpose within its parent.",
    body: "A sub-operation is an operation specialized to one narrower stated purpose within its parent, inheriting the parent's contract while adding its own constraint.",
  });
  const broken = "---\nidentity: not-broken\nname: Broken\n---\nThis body is long enough but its identity intentionally disagrees with its filename for the fixture.";
  return [
    { path: "services/alpha-services-section/content/text/glossary/terms/operation.md", filename: "operation.md", text: operation },
    { path: "services/alpha-services-section/content/text/glossary/terms/sub-operation.md", filename: "sub-operation.md", text: subOperation },
    { path: "services/beta-services-section/content/text/glossary/terms/broken.md", filename: "broken.md", text: broken },
  ];
}

test("projectGlossaryIndex is deterministic, admits recognized carriers, and accounts refusals", () => {
  const first = projectGlossaryIndex({ root: "/glossary", documents: fixtureDocuments() });
  const second = projectGlossaryIndex({ root: "/glossary", documents: fixtureDocuments() });
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(first.schema, "computer-glossary-index.v2");
  assert.deepEqual(first.records.map((record) => record.identity), ["operation", "sub-operation"]);
  assert.equal(first.records[0].section, "alpha-services-section");
  assert.equal(first.refused.length, 1);
  assert.equal(first.refused[0].path, "services/beta-services-section/content/text/glossary/terms/broken.md");
  assert.ok(first.refused[0].findings.some(({ rule }) => rule === "identity"));
});

test("resolve returns the record by identity, undefined when absent, and throws on a non-kebab-case identity", () => {
  const reader = createGlossaryIndexReader(projectGlossaryIndex({ root: "/glossary", documents: fixtureDocuments() }));
  assert.equal(reader.resolve("operation").name, "Operation");
  assert.equal(reader.resolve("no-such-term"), undefined);
  assert.throws(() => reader.resolve("Not_Kebab"), TypeError);
});

test("neighborhood carries outgoing carrier-range relations with resolved targets, and incoming relations from other records", () => {
  const reader = createGlossaryIndexReader(projectGlossaryIndex({ root: "/glossary", documents: fixtureDocuments() }));
  const child = reader.neighborhood("sub-operation");
  assert.equal(child.record.identity, "sub-operation");
  assert.equal(child.outgoing.length, 1);
  assert.equal(child.outgoing[0].predicate, "subtype-of");
  assert.equal(child.outgoing[0].target, "operation");
  assert.equal(child.outgoing[0].record.identity, "operation");
  assert.equal(child.incoming.length, 0);
  const parent = reader.neighborhood("operation");
  assert.equal(parent.outgoing.length, 0);
  assert.equal(parent.incoming.length, 1);
  assert.equal(parent.incoming[0].predicate, "subtype-of");
  assert.equal(parent.incoming[0].from, "sub-operation");
  assert.equal(parent.incoming[0].record.identity, "sub-operation");
  const unknown = reader.neighborhood("no-such-term");
  assert.equal(unknown.record, undefined);
  assert.equal(unknown.outgoing.length, 0);
  assert.equal(unknown.incoming.length, 0);
});

test("search tokenizes the query, ranks an exact whole-name match highest, and enforces default/max limits", () => {
  const reader = createGlossaryIndexReader(projectGlossaryIndex({ root: "/glossary", documents: fixtureDocuments() }));
  const results = reader.search("operation");
  assert.deepEqual(results.map((result) => result.identity), ["operation", "sub-operation"]);
  assert.ok(results[0].score > results[1].score);
  assert.throws(() => reader.search(""), TypeError);
  assert.throws(() => reader.search("   "), TypeError);
  assert.equal(reader.search("operation", { limit: 1 }).length, 1);
  assert.throws(() => reader.search("operation", { limit: 0 }), TypeError);
  assert.ok(reader.search("operation", { limit: 500 }).length <= 100);
  assert.deepEqual(reader.search("child"), [{ identity: "sub-operation", sign: glossarySignToken("sub-operation").id, token: glossaryConceptToken("services/alpha-services-section", "sub-operation").id, scheme: "services/alpha-services-section", facet: "term", name: "Sub Operation", description: "A sub-operation is an operation specialized to one narrower stated purpose within its parent.", section: "alpha-services-section", score: 25 }]);
});

test("the projection script walks a root, reads carriers through the house file service, and writes what projectGlossaryIndex derives", async () => {
  const root = mkdtempSync(join(tmpdir(), "glossary-index-script-"));
  try {
    const termsDir = join(root, "services", "alpha-services-section", "content", "text", "glossary", "terms");
    mkdirSync(termsDir, { recursive: true });
    writeFileSync(join(termsDir, "operation.md"), renderTermMarkdown({ identity: "operation", name: "Operation", body: operationBody }));
    const out = join(root, "glossary-index.json");
    const { index } = await projectSetOfTermRecords({ root, out });
    const text = readFileSync(out, "utf8");
    assert.ok(text.endsWith("}\n"));
    assert.deepEqual(JSON.parse(text), JSON.parse(JSON.stringify(index)));
    assert.equal(index.records.length, 1);
    assert.equal(index.records[0].identity, "operation");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a section's terms, concepts and topics are one scheme, each record naming its facet and its concept token", () => {
  const carrier = (facet, identity) => ({ path: `services/alpha-services-section/content/text/glossary/${facet}/${identity}.md`, filename: `${identity}.md`, text: renderTermMarkdown({ identity, name: identity, body: operationBody }) });
  const index = projectGlossaryIndex({ root: "/glossary", documents: [carrier("terms", "operation"), carrier("concepts", "closure"), carrier("topics", "work")] });
  assert.deepEqual(index.records.map(({ identity, facet, scheme }) => [identity, facet, scheme]), [
    ["closure", "concept", "services/alpha-services-section"], ["operation", "term", "services/alpha-services-section"], ["work", "topic", "services/alpha-services-section"],
  ]);
  for (const record of index.records) assert.equal(record.token, glossaryConceptToken(record.scheme, record.identity).id);
  assert.equal(schemeOf("content/text/glossary/topics/work.md"), "");
  assert.equal(facetOf("services/a/content/text/glossary/concepts/x.md"), "concept");
  assert.throws(() => schemeOf("services/a/content/text/notes/x.md"), TypeError);
});

test("the nearest-scheme resolver prefers the asserting scheme, climbs the section tree, and refuses an equally near tie", () => {
  const record = (scheme, identity) => ({ scheme, identity });
  const resolve = createNearestSchemeResolver([
    record("services/a", "role"), record("services/a/services/b", "role"), record("services/x", "role"), record("services/c", "team"), record("services/d", "team"),
    record("services/a", "office"), record("services/x", "office"),
  ]);
  assert.equal(resolve({ scheme: "services/a/services/b" }, "role").scheme, "services/a/services/b");
  assert.equal(resolve({ scheme: "services/a/services/e" }, "office").scheme, "services/a");
  assert.equal(resolve({ scheme: "services/a/services/e" }, "role"), undefined, "a sibling section is as near as the parent");
  assert.equal(resolve({ scheme: "services/a" }, "team"), undefined);
  assert.equal(resolve({ scheme: "services/a" }, "absent"), undefined);
});


test("one lexical sign, several local senses: token-scoped query and relations never overwrite another scheme", () => {
  const alpha = "services/alpha-services-section";
  const beta = "services/beta-services-section";
  const word = (scheme, identity, relations = {}) => ({
    path: scheme + "/content/text/glossary/terms/" + identity + ".md", filename: identity + ".md",
    text: renderTermMarkdown({ identity, name: identity, body: operationBody, relations }),
  });
  const index = projectGlossaryIndex({ root: "/glossary", documents: [
    word(alpha, "role"), word(beta, "role"),
    word(alpha, "team", { "composed-of": "role" }),
    word(beta, "team", { "composed-of": "role" }),
  ] });
  const reader = createGlossaryIndexReader(index);
  assert.equal(reader.readings("role").length, 2);
  assert.throws(() => reader.resolve("role"), /ambiguous glossary sign\/concept/);
  assert.throws(() => reader.neighborhood("role"), /ambiguous glossary sign\/concept/);
  const first = glossaryConceptToken(alpha, "role").id;
  const second = glossaryConceptToken(beta, "role").id;
  assert.notEqual(first, second);
  assert.equal(reader.resolve(first).scheme, alpha);
  assert.equal(reader.resolve({ identity: "role", scheme: beta }).token, second);
  assert.deepEqual(reader.neighborhood(first).incoming.map(({ fromToken }) => fromToken),
    [glossaryConceptToken(alpha, "team").id]);
  assert.deepEqual(reader.neighborhood(second).incoming.map(({ fromToken }) => fromToken),
    [glossaryConceptToken(beta, "team").id]);
  const hits = reader.search("role").filter(hit => hit.identity === "role");
  assert.deepEqual(new Set(hits.map(hit => hit.token)), new Set([first, second]));
  assert.equal(new Set(hits.map(hit => hit.sign)).size, 1, "same sign, different concepts");
  assert.equal(reader.resolve("absent"), undefined);
  assert.throws(() => reader.resolve({ token: first, scheme: beta }), /selector needs/);
});

test("same concept in two definition facets keeps both readings and refuses ambiguous definition selection", () => {
  const scheme = "services/alpha-services-section";
  const concept = glossaryConceptToken(scheme, "team").id;
  const documents = ["terms", "topics"].map(facet => ({
    path: scheme + "/content/text/glossary/" + facet + "/team.md",
    filename: "team.md",
    text: renderTermMarkdown({ identity: "team", name: "Team", body: operationBody }),
  }));
  const reader = createGlossaryIndexReader(projectGlossaryIndex({ root: "/glossary", documents }));
  assert.deepEqual(reader.readings(concept).map(({ facet }) => facet).sort(), ["term", "topic"]);
  assert.throws(() => reader.resolve(concept), /ambiguous glossary sign\/concept/);
  assert.equal(reader.resolve({ token: concept, facet: "topic" }).facet, "topic");
  assert.equal(reader.resolve({ identity: "team", scheme, facet: "term" }).token, concept);
  assert.throws(() => reader.readings({ token: "ni:///sha-256;not-a-token" }), /selector needs/);
  assert.throws(() => reader.readings({ identity: "team", actor: "someone-else" }), /selector needs/);
});

test("unresolved relation retains a typed SignCell sign without minting a target concept", () => {
  const scheme = "services/alpha-services-section";
  const index = projectGlossaryIndex({ root: "/glossary", documents: [{
    path: scheme + "/content/text/glossary/terms/team.md", filename: "team.md",
    text: renderTermMarkdown({ identity: "team", name: "Team", body: operationBody, relations: { "composed-of": "missing" } }),
  }] });
  const reader = createGlossaryIndexReader(index);
  assert.deepEqual(reader.neighborhood("team").outgoing.map(({ target, targetSign, unresolved, targetToken }) =>
    [target, targetSign, unresolved, targetToken]), [
    ["missing", glossarySignToken("missing").id, true, undefined],
  ]);
  assert.deepEqual(reader.neighborhood("missing").incoming, []);
});

test("UAX29 lexical lookup recovers multilingual labels while SignCell scheme-specific senses stay distinct", () => {
  const alpha = "services/alpha-services-section";
  const beta = "services/beta-services-section";
  const word = (scheme, name, aliases = [], keywords = []) => ({
    path: scheme + "/content/text/glossary/terms/language-space.md",
    filename: "language-space.md",
    text: renderTermMarkdown({
      identity: "language-space", name, aliases, keywords, body: operationBody,
    }),
  });
  const reader = createGlossaryIndexReader(projectGlossaryIndex({
    root: "/glossary", documents: [
      word(alpha, "语言空间", ["L-Space", "語言空間"], ["因果集"]),
      word(beta, "语义空间"),
    ],
  }));
  const hits = reader.search("空间").filter(hit => hit.identity === "language-space");
  assert.equal(hits.length, 2, "both authored Chinese names contain a lexical 空间 segment");
  assert.notEqual(hits[0].token, hits[1].token, "same filename sign does not identify different senses");
  assert.equal(hits[0].sign, hits[1].sign, "same spelled carrier remains one SignCell lexical sign");
  const exact = reader.search("语言空间");
  assert.equal(exact[0].scheme, alpha, "authored whole-name match outranks shared partial words");
  assert.equal(exact[0].score > exact.at(-1).score, true);
  assert.deepEqual(reader.search("L-Space").map(hit => hit.scheme), [alpha],
    "only the originally authored alias connects English to this concept");
  assert.deepEqual(reader.search("語言空間").map(hit => hit.scheme), [alpha],
    "traditional Han remains an explicitly authored alias, never an inferred equivalence");
  assert.deepEqual(reader.search("因果集").map(hit => hit.scheme), [alpha],
    "the source keyword must be segmented by the same Unicode provider as queries");
  assert.throws(() => reader.resolve("language-space"), /ambiguous glossary sign\/concept/,
    "a lexical query must not elect one meaning across two source schemes");
});

test("repeated Unicode lexical queries reuse the admitted cut without losing name, alias or description facets", () => {
  const source = fixtureDocuments();
  const alpha = "services/alpha-services-section";
  source.push({
    path: alpha + "/content/text/glossary/terms/causal-sets.md",
    filename: "causal-sets.md",
    text: renderTermMarkdown({ identity: "causal-sets", name: "因果集",
      aliases: ["Causal Sets"], keywords: ["kinematic space"],
      description: "Causal order of witnessed events", body: operationBody }),
  });
  const reader = createGlossaryIndexReader(projectGlossaryIndex({ root: "/glossary", documents: source }));
  for (const query of ["因果集", "因果", "Causal", "kinematic", "witnessed", "operation"]) {
    const first = reader.search(query);
    assert.deepEqual(reader.search(query), first, "repeated bound-reader results preserve the source cut");
    assert.ok(first.length > 0, "every authored lexical field remains findable: " + query);
  }
  assert.deepEqual(reader.search("causal").filter(hit => hit.identity === "causal-sets")
    .map(hit => hit.scheme), [alpha]);
  assert.deepEqual(reader.search("unattestedterm"), [],
    "an absent word is neither a synonym nor negative SignCell testimony");
});

test("native SignCell NI search is exact and never falls through to lexical word scoring", () => {
  const scheme = "services/alpha-services-section";
  const otherScheme = "services/beta-services-section";
  const carrier = (owner, facet, name) => ({
    path: owner + "/content/text/glossary/" + facet + "/language-space.md",
    filename: "language-space.md",
    text: renderTermMarkdown({ identity: "language-space", name, body: operationBody }),
  });
  const reader = createGlossaryIndexReader(projectGlossaryIndex({
    root: "/glossary", documents: [
      carrier(scheme, "terms", "语言空间"),
      carrier(scheme, "topics", "Language space"),
      carrier(otherScheme, "terms", "Semantic space"),
    ],
  }));
  const token = glossaryConceptToken(scheme, "language-space").id;
  const other = glossaryConceptToken(otherScheme, "language-space").id;
  const direct = reader.search(token);
  assert.equal(direct.length, 2, "one original concept can have two definition facets");
  assert.deepEqual(direct.map(hit => hit.facet).sort(), ["term", "topic"]);
  assert.ok(direct.every(hit => hit.token === token && hit.scheme === scheme));
  assert.notEqual(token, other, "different schemes are distinct concept tokens");
  assert.deepEqual(reader.search(other).map(hit => hit.scheme), [otherScheme]);
  assert.equal(reader.search(token, { limit: 1 }).length, 1);
  assert.deepEqual(reader.search("ni:///sha-256;" + "Z".repeat(43)), [],
    "an unknown but structurally valid token adds no denied or invented source");
  assert.throws(() => reader.search("ni:///sha-256;broken"), /exact canonical SignCell concept token/);
  assert.throws(() => reader.search("ni:semantic-space"), /exact canonical SignCell concept token/);
  assert.deepEqual(reader.search("中文不存在词"), [],
    "a source-absent human lexical string is not a negative epistemic claim");
});
