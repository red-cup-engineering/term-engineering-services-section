import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { deriveTermAdmissionSchema, projectTermAdmissionSchema, TERM_ADMISSION_SCHEMA_ID } from "../src/term-science-schema.mjs";

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

test("the Engineering admission is a source-derived refinement of the separately identified Science term schema", async () => {
  const base = join(ROOT, "schemas/glossary/term");
  const science = JSON.parse(readFileSync(join(base, "term.schema.json"), "utf8"));
  const vocabulary = JSON.parse(readFileSync(join(base, "relation-predicates.json"), "utf8"));
  const profile = JSON.parse(readFileSync(join(base, "term-admission.schema.json"), "utf8"));
  assert.equal(science.$id, "glossary/terms/term");
  assert.equal(science.additionalProperties, true,
    "Science's broader term record remains its own type, never silently tightened under the same $id");
  assert.equal(profile.$id, TERM_ADMISSION_SCHEMA_ID);
  assert.notEqual(profile.$id, science.$id);
  assert.equal(profile.additionalProperties, false);
  assert.deepEqual(profile, deriveTermAdmissionSchema(science, vocabulary),
    "the original Engineering admission profile must be derived from the original scientific schema and typed predicates");

  const output = new Map();
  const sciencePath = join(base, "term.schema.json");
  const vocabularyPath = join(base, "relation-predicates.json");
  const target = join(base, "generated-admission.schema.json");
  const received = await projectTermAdmissionSchema({
    source: sciencePath, vocabulary: vocabularyPath, destination: target,
  }, { write: async (path, text) => output.set(path, text) });
  assert.equal(received.destination, target);
  assert.deepEqual(JSON.parse(output.get(target)), profile, "the actual original projection writer produces the shipped standard JSON Schema");

  // The isolated public Engineering checkout has no authority to silently assume
  // a neighbouring private Science filesystem mount. If one is supplied by the
  // scientific source receiver, require exact semantic agreement instead.
  if (process.env.TERM_SCIENCE_SCHEMA_SOURCE) {
    const receivedScience = JSON.parse(readFileSync(process.env.TERM_SCIENCE_SCHEMA_SOURCE, "utf8"));
    assert.deepEqual(science, receivedScience,
      "the independently selected Science schema must agree with this source-attributed projection");
  }
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
