import test from "node:test";
import assert from "node:assert/strict";
import { admitTermDescription } from "../src/term-description.mjs";

test("admits an independently useful two-sentence term description", () => {
  const admitted = admitTermDescription("A file is a named collection of information. Files let systems retain and retrieve information by name.");
  assert.equal(admitted.type, "Description");
});

test("admits one sentence and refuses compound-position descriptions", () => {
  assert.equal(admitTermDescription("Only one sentence.").text, "Only one sentence.");
  assert.throws(() => admitTermDescription("A file is a component of FILES. It appears in the acronym."), /independently/u);
});
