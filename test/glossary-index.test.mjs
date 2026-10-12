import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { projectSetOfTermRecords } from "../scripts/project-set-of-term-records.mjs";
import { createGlossaryIndexReader, createNearestSchemeResolver, facetOf, projectGlossaryIndex, schemeOf } from "../src/glossary-index.mjs";
import { glossaryConceptToken } from "../src/glossary-token.mjs";
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
  assert.deepEqual(reader.search("child"), [{ identity: "sub-operation", name: "Sub Operation", description: "A sub-operation is an operation specialized to one narrower stated purpose within its parent.", section: "alpha-services-section", score: 25 }]);
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
