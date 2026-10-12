import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import test from "node:test";
import { censusTermAdmissions, findGlossaryTermMarkdownPaths, subsectionOf } from "../src/term-admission-census.mjs";

function fixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), "term-admission-census-"));
  const good = join(root, "services", "alpha-services-section", "content", "text", "glossary", "terms");
  const bad = join(root, "services", "beta-services-section", "content", "text", "glossary", "terms");
  const legacy = join(root, "services", "beta-services-section", "content", "text", "glossary", "terms", "legacy");
  mkdirSync(good, { recursive: true }); mkdirSync(bad, { recursive: true }); mkdirSync(legacy, { recursive: true });
  writeFileSync(join(good, "light.md"), "---\nname: Light\n---\nLight is electromagnetic radiation detectable across a stated band of wavelengths.\n");
  writeFileSync(join(bad, "redshift.md"), "---\nname: Redshift\nrequires:\n  - light\ndate-created: 2026-03-31\n---\nRedshift is the stretching of light to longer wavelengths as it traverses expanding space.\n");
  writeFileSync(join(bad, "broken.md"), "---\nidentity: not-broken\nname: Broken\n---\nThis body is long enough but its identity intentionally disagrees with its filename for the fixture.\n");
  writeFileSync(join(legacy, "ignored.md"), "---\nname: Ignored\ninvented-key: nope\n---\nThis carrier sits under a legacy directory and must never be walked.\n");
  return root;
}

test("findGlossaryTermMarkdownPaths finds every glossary/terms Markdown file and excludes legacy/triage/node_modules/dist", () => {
  const root = fixtureRoot();
  try {
    const paths = findGlossaryTermMarkdownPaths(root);
    assert.equal(paths.length, 3);
    assert.ok(paths.every((path) => !path.split(sep).includes("legacy")));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("subsectionOf names the first services/<name> segment beneath root, else science-root", () => {
  const root = "/science-services-section";
  assert.equal(subsectionOf(root, "/science-services-section/services/alpha-services-section/content/text/glossary/terms/x.md"), "alpha-services-section");
  assert.equal(subsectionOf(root, "/science-services-section/content/text/glossary/terms/x.md"), "science-root");
});

test("censusTermAdmissions never throws on a refused term, accounts it in counts, histogram, and bySubsection", () => {
  const root = fixtureRoot();
  try {
    const census = censusTermAdmissions(root);
    assert.equal(census.counts.total, 3);
    assert.equal(census.counts.admitted, 2);
    assert.equal(census.counts.refused, 1);
    assert.equal(census.admittedFraction, 2 / 3);
    assert.equal(census.bySubsection["alpha-services-section"].admitted, 1);
    assert.equal(census.bySubsection["beta-services-section"].admitted, 1);
    assert.equal(census.bySubsection["beta-services-section"].refused, 1);
    assert.equal(census.refusalHistogram["identity: identity must equal the Markdown filename stem"], 1);
    const refusedRow = census.rows.find((row) => row.relativePath.endsWith("broken.md"));
    assert.equal(refusedRow.admitted, false);
    assert.ok(refusedRow.findings.some(({ rule }) => rule === "identity"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a --limit bounds how many discovered term carriers are recognized", () => {
  const root = fixtureRoot();
  try {
    const census = censusTermAdmissions(root, { limit: 1 });
    assert.equal(census.counts.total, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
