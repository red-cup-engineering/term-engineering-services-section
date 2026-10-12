import assert from "node:assert/strict";
import test from "node:test";
import { FOAM_PREDICATES, projectGlossaryFoam } from "../src/glossary-foam.mjs";
import { projectGlossaryIndex } from "../src/glossary-index.mjs";
import { TERM_VOCABULARY } from "../src/glossary-skos.mjs";
import { glossaryConceptToken, glossaryConceptType, glossaryDefinitionType, glossarySignToken, glossarySignType } from "../src/glossary-token.mjs";
import { renderTermMarkdown } from "../src/term-carrier.mjs";

const body = "A team is a set of characters filling roles together toward one shared outcome under one procedure.";
const ALPHA = "services/alpha-services-section";
const BETA = "services/beta-services-section";
function index({ teamBody = body } = {}) {
  const carrier = (scheme, facet, record) => ({ path: `${scheme}/content/text/glossary/${facet}/${record.identity}.md`, filename: `${record.identity}.md`, text: renderTermMarkdown({ body, visibility: "public", ...record }) });
  return projectGlossaryIndex({ root: "/glossary", documents: [
    carrier(ALPHA, "terms", { identity: "team", name: "Team", body: teamBody, relations: { "composed-of": ["character", "role"], "see-also": "Some Free Text" } }),
    carrier(ALPHA, "terms", { identity: "role", name: "Role" }),
    carrier(ALPHA, "topics", { identity: "role", name: "Role topic" }),
    carrier(BETA, "terms", { identity: "team", name: "Beta team", keywords: ["team"] }),
    carrier(BETA, "terms", { identity: "hidden", name: "Hidden", visibility: undefined }),
  ] });
}
const cellsOf = (foam, type) => foam.foam.cells.filter((cell) => cell.type === type);
const edgesOf = (foam, subject, predicate) => foam.foam.edges.map(({ edge }) => edge).filter((edge) => edge.subject.id === subject && edge.predicate === predicate);

test("the foam is deterministic and content-addressed, glued from one cut per section without obstruction", () => {
  const foam = projectGlossaryFoam(index());
  assert.equal(JSON.stringify(foam), JSON.stringify(projectGlossaryFoam(index())));
  assert.equal(foam.schema, "computer-glossary-foam.v1");
  assert.match(foam.foam.id, /^ni:\/\/\/sha-256;[A-Za-z0-9_-]{43}$/u);
  assert.deepEqual(foam.cuts.map(({ scheme }) => scheme), ["alpha-services-section", "beta-services-section"]);
  assert.deepEqual(foam.obstructions, []);
  assert.equal(foam.accounting.withheld, 1, "the public foam withholds a carrier that never opened to the public");
});

test("sections that file the same word share its sign and keep their own concepts; each concept is the index record's token", () => {
  const records = index().records;
  const foam = projectGlossaryFoam({ records });
  assert.deepEqual(cellsOf(foam, glossarySignType.id).filter((cell) => cell.content.identity === "team").length, 1);
  const teams = cellsOf(foam, glossaryConceptType.id).filter((cell) => cell.content.identity === "team");
  assert.deepEqual(teams.map((cell) => cell.content.scheme).sort(), ["alpha-services-section", "beta-services-section"]);
  for (const record of records.filter(({ visibility }) => visibility === "public")) assert.ok(foam.foam.cells.some((cell) => cell.id === record.token));
  const alphaTeam = glossaryConceptToken(ALPHA, "team").id;
  assert.equal(edgesOf(foam, alphaTeam, FOAM_PREDICATES.notation)[0].object.id, glossarySignToken("team").id);
  assert.equal(edgesOf(foam, alphaTeam, FOAM_PREDICATES.definition)[0].object.type, glossaryDefinitionType.id);
});

test("relations resolve to the nearest concept, land on the sign when nothing defines it, and every edge is witnessed by its definition", () => {
  const foam = projectGlossaryFoam(index());
  const alphaTeam = glossaryConceptToken(ALPHA, "team").id;
  const composed = edgesOf(foam, alphaTeam, `${TERM_VOCABULARY}composed-of`);
  assert.deepEqual(composed.map((edge) => edge.object.id).sort(), [glossaryConceptToken(ALPHA, "role").id, glossarySignToken("character").id].sort());
  const definition = edgesOf(foam, alphaTeam, FOAM_PREDICATES.definition)[0].object.id;
  assert.ok(composed.every((edge) => edge.witness.id === definition));
  assert.deepEqual(foam.wanted.map(({ identity, wantedBy }) => [identity, wantedBy]), [["character", 1]]);
  assert.equal(foam.accounting.unaddressableTargets, 1, "free text names no sign and is counted, not dropped silently");
  const betaTeam = glossaryConceptToken(BETA, "team").id;
  assert.equal(edgesOf(foam, betaTeam, FOAM_PREDICATES.broader)[0].object.id, betaTeam, "a keyword resolves within its own section first");
});

test("revising a definition re-addresses that definition and its section's cut, never its concept or another section", () => {
  const before = projectGlossaryFoam(index());
  const after = projectGlossaryFoam(index({ teamBody: `${body} Revised.` }));
  const cut = (foam, scheme) => foam.cuts.find((each) => each.scheme === scheme).id;
  assert.notEqual(before.foam.id, after.foam.id);
  assert.notEqual(cut(before, "alpha-services-section"), cut(after, "alpha-services-section"));
  assert.equal(cut(before, "beta-services-section"), cut(after, "beta-services-section"));
  const alphaTeam = glossaryConceptToken(ALPHA, "team").id;
  assert.ok(after.foam.cells.some((cell) => cell.id === alphaTeam));
  assert.notEqual(edgesOf(before, alphaTeam, FOAM_PREDICATES.definition)[0].object.id, edgesOf(after, alphaTeam, FOAM_PREDICATES.definition)[0].object.id);
});

test("a concept filed twice in one section keeps both definitions and is reported", () => {
  const foam = projectGlossaryFoam(index());
  const role = glossaryConceptToken(ALPHA, "role").id;
  assert.equal(edgesOf(foam, role, FOAM_PREDICATES.definition).length, 2);
  assert.deepEqual(foam.diagnostics, [{ code: "concept-defined-more-than-once", concept: role, scheme: "alpha-services-section", identity: "role", facets: ["term", "topic"] }]);
});

test("the authenticated foam carries every admitted carrier, and an unknown audience is refused", () => {
  assert.equal(projectGlossaryFoam(index(), { audience: "authenticated" }).accounting.definitions, 5);
  assert.throws(() => projectGlossaryFoam(index(), { audience: "everyone" }), TypeError);
});
