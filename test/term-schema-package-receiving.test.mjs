import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const SOURCE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_NAME = "@red-cup-engineering/term-engineering-services-section";
const launch = (command, args, cwd, env = process.env) =>
  spawnSync(command, args, { cwd, encoding: "utf8", timeout: 90_000, env });

test("the real npm-packed term schema admits its original vocabulary in a separate Node consumer", (t) => {
  const scratch = mkdtempSync(join(tmpdir(), "term-schema-receiving-"));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const sourceManifest = JSON.parse(readFileSync(join(SOURCE_ROOT, "package.json"), "utf8"));
  assert.equal(sourceManifest.name, PACKAGE_NAME);
  assert.equal(sourceManifest.exports["./term-schema"], "./schemas/glossary/term/term.schema.mjs");
  assert.equal(sourceManifest.exports["./term.schema.json"], "./schemas/glossary/term/term.schema.json");
  assert.equal(sourceManifest.exports["./term-admission.schema.json"], "./schemas/glossary/term/term-admission.schema.json");
  assert.equal(sourceManifest.exports["./relation-predicates.json"], "./schemas/glossary/term/relation-predicates.json");

  // npm pack is local-only: do not install unresolved private transitive dependencies,
  // consult a remote registry, run arbitrary package lifecycle scripts or publish.
  const pack = launch("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", scratch], SOURCE_ROOT, {
    ...process.env, npm_config_offline: "true", npm_config_audit: "false",
    npm_config_fund: "false", npm_config_ignore_scripts: "true",
  });
  assert.equal(pack.status, 0, "original package pack failed: " + pack.stderr);
  const files = JSON.parse(pack.stdout);
  assert.equal(files.length, 1);
  const archive = files[0];
  assert.match(archive.filename, /\.tgz$/u);
  const entries = new Set(archive.files.map((file) => file.path));
  // Retain *these exact packed bytes* for the downstream package receiver when CI
  // supplies an output destination; the test still consumes this same archive.
  const archivePath = join(scratch, archive.filename);
  if (process.env.TERM_SCHEMA_PACK_OUTPUT_DIR) {
    const out = resolve(process.env.TERM_SCHEMA_PACK_OUTPUT_DIR);
    mkdirSync(out, { recursive: true });
    const copy = join(out, archive.filename);
    copyFileSync(archivePath, copy);
    const digest = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
    assert.equal(digest(copy), digest(archivePath), "retained candidate bytes must equal the tested package");
  }

  for (const entry of [
    "schemas/glossary/term/term.schema.mjs",
    "schemas/glossary/term/term.schema.json",
    "schemas/glossary/term/term-admission.schema.json",
    "schemas/glossary/term/relation-predicates.json",
  ]) assert.ok(entries.has(entry), "the actual package must ship " + entry);

  const extraction = join(scratch, "extracted");
  mkdirSync(extraction);
  const unpack = launch("tar", ["-xzf", join(scratch, archive.filename), "-C", extraction], SOURCE_ROOT);
  assert.equal(unpack.status, 0, "actual tarball extraction failed: " + unpack.stderr);

  // This is a separate consumer with native Node package export resolution,
  // not a relative source import or a mocked evaluation of the publication file.
  const consumer = join(scratch, "consumer");
  const packageScope = join(consumer, "node_modules", "@red-cup-engineering");
  mkdirSync(packageScope, { recursive: true });
  symlinkSync(join(extraction, "package"), join(packageScope, "term-engineering-services-section"), "dir");
  writeFileSync(join(consumer, "package.json"), JSON.stringify({ type: "module", private: true }));
  const program = String.raw`
    import assert from "node:assert/strict";
    import { TERM_RECORD_SCHEMA, admitTermRecord } from "@red-cup-engineering/term-engineering-services-section/term-schema";
    import scienceSchema from "@red-cup-engineering/term-engineering-services-section/term.schema.json" with { type: "json" };
    import engineeringProfile from "@red-cup-engineering/term-engineering-services-section/term-admission.schema.json" with { type: "json" };
    import vocabulary from "@red-cup-engineering/term-engineering-services-section/relation-predicates.json" with { type: "json" };
    const keys = Object.keys(vocabulary);
    assert.equal(TERM_RECORD_SCHEMA.$schema, "https://json-schema.org/draft/2020-12/schema");
    assert.equal(scienceSchema.$id, "glossary/terms/term");
    assert.equal(scienceSchema.additionalProperties, true);
    assert.equal(engineeringProfile.$id, "https://561.group/ns/term-engineering/admitted-term/v1");
    assert.notEqual(scienceSchema.$id, engineeringProfile.$id);
    assert.deepEqual(TERM_RECORD_SCHEMA, engineeringProfile);
    assert.equal(TERM_RECORD_SCHEMA.additionalProperties, false);
    assert.deepEqual(TERM_RECORD_SCHEMA.properties.relations.propertyNames.enum, keys);
    assert.equal(keys.length, 94);
    assert.equal(Object.values(vocabulary).filter((x) => x.range === "carrier").length, 81);
    assert.equal(Object.values(vocabulary).filter((x) => x.range === "literal").length, 13);
    const source = { identity: "model", name: "Model", body: "A source-qualified abstraction.", relations: { "acts-on": "system", symbol: "λ" } };
    assert.equal(admitTermRecord(source), source);
    assert.throws(() => admitTermRecord({ ...source, relations: { "unvetted-key": "system" } }), /predicate is not authorized/u);
    const composite = { identity: "simion", name: "Simion", body: "A constituted Thing.", relations: { "composed-of": ["actor", "character", "player", "agent"] } };
    assert.equal(admitTermRecord(composite), composite);
    assert.deepEqual(engineeringProfile.properties.relations.properties["composed-of"].oneOf[0],
      { type: "string", pattern: scienceSchema.properties.identity.pattern });
    assert.deepEqual(engineeringProfile.properties.relations.properties.symbol.oneOf[0],
      { type: "string", minLength: 1 });
    assert.throws(() => admitTermRecord({ ...composite, relations: { "composed-of": ["actor", "Actor + Character"] } }),
      /relation composed-of must name a kebab-case carrier identity/u);
    assert.equal(admitTermRecord({ ...composite, relations: { symbol: "Actor + Character" } }).identity, "simion");
    assert.throws(() => admitTermRecord({ ...source, untypedResource: true }), /term record does not admit/u);
    process.stdout.write(JSON.stringify({ kind: "term-schema-package-receipt.v1", admitted: true, refusedUnvettedPredicate: true, refusedUnknownResource: true, vocabularySize: keys.length }));
  `;
  writeFileSync(join(consumer, "consume.mjs"), program);
  const receipt = launch(process.execPath, ["consume.mjs"], consumer);
  assert.equal(receipt.status, 0, "the installed-style external package consumer refused: " + receipt.stderr);
  assert.deepEqual(JSON.parse(receipt.stdout), {
    kind: "term-schema-package-receipt.v1",
    admitted: true,
    refusedUnvettedPredicate: true,
    refusedUnknownResource: true,
    vocabularySize: 94,
  });
});
