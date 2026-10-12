import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

test("term section exposes schema, law, singular scripts, set lift, and composed app", () => {
  for (const relative of [
    "schemas/glossary/term/term.schema.mjs",
    "schemas/glossary/term/term.schema.json",
    "src/term-carrier.mjs",
    "src/term-operations.mjs",
    "src/term-migration.mjs",
    "src/term-relation-keys.mjs",
    "scripts/admit-term.mjs",
    "scripts/write-term.mjs",
    "scripts/write-set-of-terms.mjs",
    "apps/term-cli.mjs",
  ]) assert.equal(existsSync(join(ROOT, relative)), true, relative);
});

test("the executable schema projection equals its term-science source", () => {
  const source = join(ROOT, "../../../../../../../../../../../science-services-section/services/information-science-services-section/services/communication-science-services-section/services/glossary-science-services-section/services/term-science-services-section/schemas/glossary/terms/term.schema.json");
  assert.deepEqual(JSON.parse(readFileSync(join(ROOT, "schemas/glossary/term/term.schema.json"), "utf8")), JSON.parse(readFileSync(source, "utf8")));
});

test("imports descend from apps to scripts and never rise from src or scripts to apps", () => {
  for (const directory of ["src", "scripts"]) for (const entry of readdirSync(join(ROOT, directory))) {
    if (!entry.endsWith(".mjs")) continue;
    assert.doesNotMatch(readFileSync(join(ROOT, directory, entry), "utf8"), /(?:from|import\()\s*["'][^"']*\/apps\//u, `${directory}/${entry}`);
  }
  const app = readFileSync(join(ROOT, "apps/term-cli.mjs"), "utf8");
  assert.match(app, /\.\.\/scripts\/admit-term\.mjs/u);
  assert.match(app, /\.\.\/scripts\/write-set-of-terms\.mjs/u);
});
