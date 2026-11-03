import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { admitChangedGlossaryPaths } from "../scripts/admit-changed-glossary-paths.mjs";

const source = relation => [
  "---", "name: Simion", "identity: simion", "type: composite-thing",
  "relations:", "  composed-of: " + relation, "---", "",
  "# Simion", "", "A Simion is a world-inhabiting composite Thing with an Actor, Character, Player and Agent.",
].join("\n");
const path = "services/engineering-services-section/content/text/glossary/terms/simion.md";

test("changed carrier admission uses native term rules, ignores non-glossary files and deduplicates paths", () => {
  const report = admitChangedGlossaryPaths({
    root: "/test-corpus", paths: ["README.md", path, path, "services/a/triage/content/text/glossary/terms/legacy.md"],
    read: absolute => { assert.equal(absolute, resolve("/test-corpus", path)); return source("[actor, character, player, agent]"); },
  });
  assert.deepEqual(report.admitted, [path]);
  assert.deepEqual(report.refused, []);
  assert.deepEqual(report.skipped, ["README.md", "services/a/triage/content/text/glossary/terms/legacy.md"]);
});

test("bad carrier targets and unknown frontmatter are refused at the original source", () => {
  for (const invalid of ['"Actor + Character"', "https://example.org/actor"]) {
    const report = admitChangedGlossaryPaths({ root: "/test-corpus", paths: [path],
      read: () => source("[actor, " + invalid + "]") });
    assert.deepEqual(report.admitted, []);
    assert.equal(report.refused[0].path, path);
    assert.match(report.refused[0].message, /composed-of/);
  }
  const unknown = admitChangedGlossaryPaths({
    root: "/test-corpus", paths: [path],
    read: () => source("[actor]").replace("type: composite-thing", "invented-field: invented"),
  });
  assert.ok(unknown.refused.some(({ rule }) => rule === "unknown-key"));
});

test("real stdin command rejects invalid sources then receives a corrected glossary carrier", t => {
  const root = mkdtempSync(join(tmpdir(), "term-corpus-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  const command = resolve("scripts/admit-changed-glossary-paths.mjs");
  const run = () => spawnSync(process.execPath, [command, root], {
    encoding: "utf8", input: path + "\0", timeout: 10000,
  });
  writeFileSync(target, source('["Actor + Character"]'));
  const denied = run();
  assert.equal(denied.status, 1, denied.stderr);
  assert.equal(JSON.parse(denied.stdout).refused[0].rule, "record");
  writeFileSync(target, source("[actor, character, player, agent]"));
  const accepted = run();
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.deepEqual(JSON.parse(accepted.stdout).admitted, [path]);
});
