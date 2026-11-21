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
    assert.deepEqual(engineeringProfile.properties.provenance.properties.sources,
      scienceSchema.properties.provenance.properties.sources);
    const sources = ["https://example.org/record", "[cite:@record2024]", { path: "notes/primary.md", date: "2024-02-29" },
      { path: "notes/primary.md" }, { path: "notes/primary.md", date: "2024-03-01" }, { path: "notes/比 較.md" }];
    assert.deepEqual(admitTermRecord({ ...source, provenance: { sources } }).provenance.sources, sources);
    const malformed = [
      ["", "blank string"], [42, "non-text primitive"], [null, "null record"], [[], "array record"],
      [{}, "missing path"], [{ path: "", date: "2024-02-29" }, "empty path"],
      [{ path: "/notes/x.md" }, "absolute path"], [{ path: "notes/../x.md" }, "parent segment"],
      [{ path: "./notes/x.md" }, "dot segment"], [{ path: "notes//x.md" }, "empty segment"],
      [{ path: "notes/x.md/" }, "trailing slash"], [{ path: "notes\\x.md" }, "backslash"],
      [{ path: " notes/x.md" }, "initial space"], [{ path: "notes/x.md " }, "final space"],
      [{ path: "notes/x\t.md" }, "control"], [{ path: "notes/\uD800.md" }, "unpaired surrogate"],
      [{ path: "https://example.org" }, "IRI belongs in string representation"],
      [{ path: "urn:example:x" }, "URI-like locator"],
      [{ path: "notes/x.md", date: "0000-01-01" }, "out-of-range calendar year"],
      [{ path: "notes/x.md", date: "2023-02-29" }, "nonexistent leap day"],
      [{ path: "notes/x.md", date: "2024-02-30" }, "nonexistent day"],
      [{ path: "notes/x.md", date: "2024-2-9" }, "noncanonical date"],
      [{ path: "notes/x.md", date: null }, "null date"], [{ path: "notes/x.md", date: undefined }, "undefined date"],
      [{ path: "notes/x.md", date: "2024-02-29", repository: "guessed" }, "unowned field"],
    ];
    for (const [item, label] of malformed)
      assert.throws(() => admitTermRecord({ ...source, provenance: { sources: [item] } }), /provenance source/u, label);
    for (const repeat of [["duplicate", "duplicate"],
      [{ path: "notes/x.md", date: "2024-02-29" }, { date: "2024-02-29", path: "notes/x.md" }]])
      assert.throws(() => admitTermRecord({ ...source, provenance: { sources: repeat } }), /unique array/u);
    assert.throws(() => admitTermRecord({ ...source, relations: { "unvetted-key": "system" } }), /predicate is not authorized/u);
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
