import assert from "node:assert/strict";
import test from "node:test";
import { rewriteMigratedTermLinks, planTermMigration, prepareDescriptionBridge, seatDescriptionOverlay, verifyMigrationMaterialization } from "../src/term-migration.mjs";
import { proposeAndRepairTerm } from "../src/term-proposal-loop.mjs";
import { renderTermMarkdown } from "../src/term-carrier.mjs";

const claims = {
  definition: "A model is a deliberately limited representation used to answer a stated class of questions about a system.",
  distinction: "Unlike a copy, a model selects variables and relations according to the observer's intended question.",
  consequence: "An engineer must test the model against observations before using its answers to choose an operation.",
};
const body = Object.values(claims).join("\n\n");

test("migration recovers name and aliases, rewrites links, and keeps alternate provenance out of carrier", () => {
  const plan = planTermMigration([
    { relativePath: "model.md", text: "---\ntitle: Model\nalias: representation\n---\nSee [Operation](operation.org).\n\nA substantive migrated definition remains here." },
    { relativePath: "operation.org", format: "org", metadata: { title: "Operation" }, text: "#+title: Operation\nAn operation changes state." },
    { relativePath: "old-model.md", role: "alternate-witness", alternateFor: "model.md", text: "An earlier witnessed formulation." },
  ], { convertOrgToGfm: () => "An operation changes state." });
  assert.equal(plan.transactions.length, 2);
  const model = plan.transactions.find(({ output }) => output === "model.md");
  assert.match(model.markdown, /name: Model/u);
  assert.match(model.markdown, /operation\.md/u);
  assert.doesNotMatch(model.markdown, /source-path|provenance|old-model/u);
  assert.equal(model.alternateWitnesses[0].disposition, "witnessed-out-of-carrier");
  assert.equal(verifyMigrationMaterialization(plan, new Map(plan.transactions.map((item) => [item.output, item.markdown]))).valid, true);
});

test("migration refuses collisions, missing alternate targets, and lossy Org conversion", () => {
  assert.throws(() => planTermMigration([{ relativePath: "a.md", targetStem: "same", text: "---\nname: A\n---\nBody" }, { relativePath: "b.md", targetStem: "same", text: "---\nname: B\n---\nBody" }]), /collision/u);
  assert.throws(() => planTermMigration([{ relativePath: "a.md", text: "---\nname: A\n---\nBody" }, { relativePath: "other.md", role: "alternate-witness", alternateFor: "missing.md", text: "Old" }]), /no target/u);
  assert.throws(() => planTermMigration([{ relativePath: "a.org", format: "org", metadata: { title: "A" }, text: "Substantive" }], { convertOrgToGfm: () => "" }), /lost substantive/u);
});

test("description bridge matches source witnesses and returns overlay receipts", () => {
  const text = renderTermMarkdown({ identity: "model", name: "Model", body });
  const [request] = prepareDescriptionBridge([{ filename: "model.md", text }]);
  const overlay = seatDescriptionOverlay([{ filename: "model.md", text }], [{ ...request, description: "A model is a purpose-bounded representation of a system. Engineers test it against observations before relying on its answers." }]);
  assert.equal(overlay.receipts.length, 1);
  assert.match(overlay.outputs.get("model.md"), /description:/u);
  assert.throws(() => seatDescriptionOverlay([{ filename: "model.md", text }], [{ ...request, sourceSha256: "wrong", description: "A model is a purpose-bounded representation of a system. Engineers test it against observations before relying on its answers." }]), /witness mismatch/u);
});

test("bounded proposal loop repairs a circular first draft and admits the sourced second draft", async () => {
  let calls = 0;
  const result = await proposeAndRepairTerm({ name: "Model", sources: ["source.md"] }, { fuel: 2, knownCompoundStems: ["bilattice-articulation-model-belief-orienting-operation"], propose: async ({ priorFindings }) => {
    calls += 1;
    if (calls === 1) return { name: "Model", filename: "model.md", body: "Model is a constituent of BAMBOO and names the model word in that acronym.", claims: { definition: "Model is a constituent of BAMBOO and names the model word in that acronym.", distinction: "Model is a constituent of BAMBOO and names the model word in that acronym.", consequence: "Model is a constituent of BAMBOO and names the model word in that acronym." } };
    assert.ok(priorFindings.some((item) => item.includes("circular-definition")));
    return { name: "Model", filename: "model.md", body, claims };
  } });
  assert.equal(result.disposition, "proposed");
  assert.deepEqual(result.attempts.map(({ disposition }) => disposition), ["refused", "admitted"]);
});

test("migration rewrites only canonical link targets without changing source bytes or cascading renames", () => {
  const input = '---\r\nexample: "[Hidden](old.md)"\r\n---\r\n[ visible ]( old.org#part "a title" )\r\n[new](new.md)\n![image](old.md)\r\n`[inline](old.md)`\r\n~~~~md\r\n[fenced](old.md)\r\n~~~~\r\n[[file:old.org][Org label]]\n';
  const expected = '---\r\nexample: "[Hidden](old.md)"\r\n---\r\n[ visible ]( new.md#part "a title" )\r\n[new](third.md)\n![image](new.md)\r\n`[inline](old.md)`\r\n~~~~md\r\n[fenced](old.md)\r\n~~~~\r\n[Org label](new.md)\n';
  assert.equal(rewriteMigratedTermLinks(input, new Map([["old", "new"], ["new", "third"]])), expected);
});
