import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

const BASE = resolve(".");
const invoke = (script, args) => spawnSync(process.execPath, [join(BASE, "scripts", script), ...args], {
  encoding: "utf8", timeout: 30000, maxBuffer: 2 * 1024 * 1024,
});
const valid = ["---", "name: Operation", "identity: operation", "---", "",
  "# Operation", "", "An operation is a unit of work with explicit input and output.", ""].join("\n");
const invalid = ["---", "name: Broken", "identity: forged-identity", "---", "",
  "# Broken", "", "A term whose filename identity does not match its asserted identity.", ""].join("\n");

test("all three original glossary projector CLIs refuse a success exit for unadmitted source", t => {
  const root = mkdtempSync(join(tmpdir(), "glossary-refusal-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = join(root, "services/alpha-services-section/content/text/glossary/terms");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "operation.md"), valid);
  const args = script => script === "project-set-of-term-records.mjs"
    ? ["--root", root, "--out", join(root, "index.json")]
    : ["--root", root, "--index", join(root, "index.json"), "--out", join(root, script.includes("skos") ? "skos.jsonld" : "foam.json")];
  const scripts = ["project-set-of-term-records.mjs", "project-glossary-skos.mjs", "project-glossary-foam.mjs"];
  for (const script of scripts) {
    const passed = invoke(script, args(script));
    assert.equal(passed.status, 0, script + ": " + passed.stderr);
    assert.doesNotMatch(passed.stderr, /refused:/);
  }
  writeFileSync(join(directory, "broken.md"), invalid);
  for (const script of scripts) {
    const denied = invoke(script, args(script));
    assert.equal(denied.status, 1, script + " must not accept a partial glossary as successful: " + denied.stderr);
    assert.match(denied.stderr, /refused:/);
    assert.match(denied.stderr, /broken\.md/);
    assert.match(denied.stderr, /identity/);
  }
  const output = JSON.parse(readFileSync(join(root, "index.json"), "utf8"));
  assert.deepEqual(output.records.map(entry => entry.identity), ["operation"],
    "the original index still keeps admitted records and exposes the exact refused source separately");
  assert.equal(output.refused.length, 1);
  assert.match(output.refused[0].path, /broken\.md/);
});
