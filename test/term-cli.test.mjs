import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CLI = join(ROOT, "apps/term-cli.mjs");

/** @returns {import("node:child_process").SpawnSyncReturns<string>} */
function run(args) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", input: "" });
}

test("--help, -h, and no arguments print usage to stdout and exit 0", () => {
  for (const args of [["--help"], ["-h"], []]) {
    const result = run(args);
    assert.equal(result.status, 0, args.join(" "));
    assert.match(result.stdout, /^usage: term </u, args.join(" "));
    assert.equal(result.stderr, "", args.join(" "));
  }
});

test("an unknown verb prints usage to stderr and exits 2, no stack trace", () => {
  const result = run(["bogus"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /^usage: term </u);
  assert.equal(result.stdout, "");
  assert.doesNotMatch(result.stderr, /TypeError|at file:/u);
});
