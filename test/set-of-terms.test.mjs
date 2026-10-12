import assert from "node:assert/strict";
import test from "node:test";
import { writeSetOfTerms } from "../scripts/write-set-of-terms.mjs";

const claims = {
  definition: "A model is a deliberately limited representation used to answer a stated class of questions about a system.",
  distinction: "Unlike a copy, a model selects variables and relations according to the observer's intended question.",
  consequence: "An engineer must test the model against observations before using its answers to choose an operation.",
};

test("set lift writes admitted terms and accounts refusals", async () => {
  const writes = [];
  const valid = {
    termDirectory: "/tmp/terms",
    term: { filename: "model.md", identity: "model", name: "Model", body: Object.values(claims).join("\n\n") },
    semanticEvidence: { claims, sources: ["source.md"] },
  };
  const circular = "Neural is a constituent of ABYSSAL-CURRENT in ORCA and therefore names a node in that phrase.";
  const invalid = {
    termDirectory: "/tmp/terms",
    term: { filename: "neural.md", name: "Neural", body: circular },
    semanticEvidence: { claims: { definition: circular, distinction: circular, consequence: circular }, sources: ["source.md"] },
  };
  const result = await writeSetOfTerms([valid, invalid], { exists: () => false, write: (...args) => writes.push(args) });
  assert.equal(result.disposition, "partially-written");
  assert.deepEqual(result.counts, { input: 2, written: 1, refused: 1 });
  assert.equal(writes.length, 1);
});

test("a write is refused when its semantic evidence is missing, unwitnessed in the body, or cites an absent source", async () => {
  const term = { filename: "model.md", identity: "model", name: "Model", body: Object.values(claims).join("\n\n") };
  const request = (semanticEvidence) => ({ termDirectory: "/tmp/terms", term, semanticEvidence });
  const unwitnessed = { ...claims, consequence: "A claim the body never makes." };
  const result = await writeSetOfTerms([
    request(undefined),
    request({ claims: unwitnessed, sources: ["source.md"] }),
    request({ claims, sources: ["/no/such/source.md"] }),
    request({ claims: { ...claims, definition: claims.definition.replace(/ /gu, "\n") }, sources: ["source.md"] }),
  ], { exists: () => false, sourceExists: () => false, write: () => {} });
  assert.deepEqual(result.attempts.map(({ disposition }) => disposition), ["refused", "refused", "refused", "written"]);
  assert.match(result.attempts[1].reason, /consequence is not witnessed/u);
  assert.match(result.attempts[2].reason, /source does not exist/u);
});
