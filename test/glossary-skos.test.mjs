import assert from "node:assert/strict";
import test from "node:test";
import { projectGlossaryIndex } from "../src/glossary-index.mjs";
import { projectGlossarySkos, schemeIriPath } from "../src/glossary-skos.mjs";
import { recognizeTermDocument, recognizeTermMarkdown, renderTermMarkdown } from "../src/term-carrier.mjs";

const body = "An operation is a well-defined unit of work with a stated input and output that a system carries out.";
const K = "https://561.group/knowledge/";

function index() {
  const term = (scheme, record) => ({ path: `${scheme}/content/text/glossary/terms/${record.identity}.md`, filename: `${record.identity}.md`, text: renderTermMarkdown({ body, visibility: "public", ...record }) });
  return projectGlossaryIndex({ root: "/glossary", documents: [
    term("services/alpha-services-section", { identity: "operation", name: "Operation", aliases: ["work unit"], description: "A unit of work with stated input and output." }),
    term("services/alpha-services-section", { identity: "sub-operation", name: "Sub Operation", relations: { "subtype-of": "operation", "see-also": "missing-term" } }),
    term("services/alpha-services-section/services/gamma-services-section", { identity: "operation", name: "Gamma Operation" }),
    term("services/beta-services-section", { identity: "gated", name: "Gated", "consent-status": "kin-gated" }),
    term("services/beta-services-section", { identity: "unlisted", name: "Unlisted", visibility: undefined }),
  ] });
}
const node = (skos, id) => skos["@graph"].find((each) => each["@id"] === id);

test("projectGlossarySkos publishes a DefinedTermSet/ConceptScheme per section and a DefinedTerm/Concept per public term, deterministically", () => {
  const skos = projectGlossarySkos(index());
  assert.equal(JSON.stringify(skos), JSON.stringify(projectGlossarySkos(index())));
  assert.equal(skos.audience, "public");
  const schemes = skos["@graph"].filter((each) => each["@type"].includes("skos:ConceptScheme")).map((each) => each["@id"]);
  assert.deepEqual(schemes, [`${K}alpha-services-section`, `${K}alpha-services-section/gamma-services-section`]);
  const operation = node(skos, `${K}alpha-services-section/operation`);
  assert.deepEqual(operation["@type"], ["DefinedTerm", "skos:Concept"]);
  assert.equal(operation["skos:prefLabel"], "Operation");
  assert.equal(operation["skos:altLabel"], "work unit");
  assert.equal(operation.description, "A unit of work with stated input and output.");
  assert.equal(operation["skos:definition"], body);
  assert.deepEqual(operation["skos:inScheme"], { "@id": `${K}alpha-services-section` });
  assert.equal(skos.accounting.withheld, 2);
  assert.ok(!skos["@graph"].some((each) => each["skos:notation"] === "gated" || each["skos:notation"] === "unlisted"));
});

test("the authenticated audience also sees terms never opened to the public, but never consent-gated ones", () => {
  const skos = projectGlossarySkos(index(), { audience: "authenticated" });
  assert.ok(node(skos, `${K}beta-services-section/unlisted`));
  assert.equal(node(skos, `${K}beta-services-section/gated`), undefined);
  assert.throws(() => projectGlossarySkos(index(), { audience: "everyone" }), /audience/u);
});

test("relations resolve to the nearest section as IRI nodes and hierarchical predicates map to skos:broader", () => {
  const skos = projectGlossarySkos(index());
  const child = node(skos, `${K}alpha-services-section/sub-operation`);
  assert.deepEqual(child["skos:broader"], { "@id": `${K}alpha-services-section/operation` });
  assert.deepEqual(child["term:subtype-of"], [{ "@id": `${K}alpha-services-section/operation` }]);
  assert.equal(child["skos:related"], undefined);
  assert.equal(skos.accounting.unresolvedRelations, 1);
});

test("a scheme's IRI path comes from its section path alone", () => {
  assert.equal(schemeIriPath("services/science-services-section/services/medical-science-services-section"), "science-services-section/medical-science-services-section");
  assert.equal(schemeIriPath(""), "561-group");
});

test("visibility is a term key, and a parsed carrier is recognized as its Markdown is", () => {
  const text = renderTermMarkdown({ identity: "operation", name: "Operation", body, visibility: "public" });
  const parsed = recognizeTermMarkdown({ text, filename: "operation.md" });
  assert.equal(parsed.admitted, true);
  assert.equal(parsed.visibility, "public");
  const roomLike = recognizeTermDocument({ frontmatter: { name: "Operation", visibility: "public" }, body, filename: "operation.md" });
  assert.deepEqual({ ...roomLike }, { ...parsed });
  assert.equal(recognizeTermDocument({ frontmatter: { name: "Operation", visibility: "everyone" }, body, filename: "operation.md" }).admitted, false);
});
