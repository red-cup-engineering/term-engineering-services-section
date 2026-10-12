import assert from "node:assert/strict";
import test from "node:test";
import { indexGlossaryKeywordWeb } from "../src/glossary-keyword-web.mjs";
import { renderTermMarkdown } from "../src/term-carrier.mjs";

const primitive = (name) => renderTermMarkdown({ identity: name.toLowerCase(), name, body: `${name} has an independently useful engineering definition that states what it represents and how an engineer can distinguish and operationally use it.` });

test("BAMBOO alone declares keywords and reverse model backlink stays in memory", () => {
  const bamboo = renderTermMarkdown({
    identity: "bilattice-articulation-model-belief-orienting-operation",
    name: "Bilattice Articulation Model Belief Orienting Operation",
    keywords: ["bilattice", "articulation", "model", "belief", "orienting", "operation"],
    body: "BAMBOO composes a belief-orienting operation from an articulated bilattice model. Its definition belongs to the compound carrier, while each constituent remains independently defined.",
  });
  const documents = ["bilattice", "articulation", "model", "belief", "orienting", "operation"].map((stem) => ({ filename: `${stem}.md`, text: primitive(stem[0].toUpperCase() + stem.slice(1)) }));
  documents.push({ filename: "bilattice-articulation-model-belief-orienting-operation.md", text: bamboo });
  const index = indexGlossaryKeywordWeb([{ directory: "/glossary/terms", documents }]);
  assert.equal(index.edges.length, 6);
  assert.deepEqual(index.backlinksFor("model"), ["bilattice-articulation-model-belief-orienting-operation"]);
  assert.doesNotMatch(documents.find(({ filename }) => filename === "model.md").text, /BAMBOO|bilattice-articulation/iu);
});

test("a filename-identity mismatch is accounted in refused, never thrown, and the rest of the scope still indexes", () => {
  const model = primitive("Model");
  const invalid = "---\nidentity: not-broken\nname: Broken\n---\nThis body is long enough but its identity intentionally disagrees with its filename.";
  const index = indexGlossaryKeywordWeb([{ directory: "/glossary/terms", documents: [{ filename: "model.md", text: model }, { filename: "broken.md", text: invalid }] }]);
  assert.equal(index.edges.length, 0);
  assert.equal(index.refused.length, 1);
  assert.equal(index.refused[0].filename, "broken.md");
  assert.ok(index.refused[0].findings.some(({ rule }) => rule === "identity"));
});

test("keyword resolution uses current scope before an ancestor", () => {
  const compound = renderTermMarkdown({ identity: "local-model-operation", name: "Local Model Operation", keywords: ["model", "operation"], body: "A local model operation composes two locally resolved glossary constituents for an indexing fixture." });
  const index = indexGlossaryKeywordWeb([
    { directory: "/child/terms", documents: [{ filename: "local-model-operation.md", text: compound }, { filename: "model.md", text: primitive("Model") }] },
    { directory: "/parent/terms", documents: [{ filename: "model.md", text: primitive("Model") }, { filename: "operation.md", text: primitive("Operation") }] },
  ]);
  assert.equal(index.unresolved.length, 0);
  assert.deepEqual(index.edges.map(({ to }) => to), ["model", "operation"]);
});
