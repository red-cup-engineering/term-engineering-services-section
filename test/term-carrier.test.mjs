import assert from "node:assert/strict";
import test from "node:test";
import { TERM_KEYS, migrateLegacyTermMarkdown, recognizeTermDocument, recognizeTermMarkdown, renderTermMarkdown } from "../src/term-carrier.mjs";
import { TERM_RECORD_SCHEMA, admitTermRecord } from "../schemas/glossary/term/term.schema.mjs";
import RELATION_PREDICATE_VOCABULARY from "../schemas/glossary/term/relation-predicates.json" with { type: "json" };
import { writeTerm } from "../src/term-operations.mjs";

const body = "A model is a deliberately limited representation used to answer a stated class of questions about a system.";

test("the Draft 2020-12 term schema and the actual Markdown reader enforce one closed typed resource vocabulary", () => {
  assert.equal(TERM_RECORD_SCHEMA.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(TERM_RECORD_SCHEMA.additionalProperties, false,
    "a schema exported to downstream consumers must refuse what the original term reader refuses");
  assert.deepEqual(TERM_KEYS, Object.keys(TERM_RECORD_SCHEMA.properties),
    "frontmatter admission derives its canonical field names from the upstream schematic resource");

  const record = { identity: "model", name: "Model", body,
    type: "scientific-model", creator: "Original Author",
    provenance: { "date-created": "2026-10-20" },
    relations: { "acts-on": "system" } };
  assert.equal(admitTermRecord(record), record);
  assert.throws(() => admitTermRecord({ ...record, inventedKey: "undocumented authority" }),
    /term record does not admit inventedKey/);

  const recognized = recognizeTermDocument({
    filename: "model.md", body,
    frontmatter: { name: "Model", type: "scientific-model",
      creator: "Original Author", "date-created": "2026-10-20", "acts-on": "system" },
  });
  assert.equal(recognized.admitted, true, JSON.stringify(recognized.findings));
  assert.deepEqual(recognized.relations, { "acts-on": "system" });
  assert.equal(recognized.provenance["date-created"], "2026-10-20");
  assert.equal(recognized.type, "scientific-model");
  assert.equal(recognized.creator, "Original Author");

  const unknown = recognizeTermDocument({
    filename: "model.md", body,
    frontmatter: { name: "Model", "opaque-thing": "not an admitted predicate" },
  });
  assert.equal(unknown.admitted, false);
  assert.ok(unknown.findings.some(({ rule, message }) =>
    rule === "unknown-key" && message.includes("opaque-thing")));
});

test("every term relation key must be in the original typed upstream predicate vocabulary", () => {
  const predicateNames = Object.keys(RELATION_PREDICATE_VOCABULARY);
  assert.equal(predicateNames.length, 94, "source-owned predicate vocabulary must be qualified before changing it");
  assert.deepEqual(TERM_RECORD_SCHEMA.properties.relations.propertyNames.enum, predicateNames,
    "the canonical Draft 2020-12 schema must admit precisely the original lexical relation keys");
  assert.deepEqual(
    Object.values(RELATION_PREDICATE_VOCABULARY).reduce((count, spec) =>
      ({ ...count, [spec.range]: count[spec.range] + 1 }), { carrier: 0, literal: 0 }),
    { carrier: 81, literal: 13 }, "predicate ranges remain distinct carrier/literal source declarations");

  const base = { identity: "model", name: "Model", body };
  for (const key of ["acts-on", "symbol"]) {
    const candidate = { ...base, relations: { [key]: key === "acts-on" ? "system" : "λ" } };
    assert.equal(admitTermRecord(candidate), candidate, "direct term-record admission accepts original predicates");
    const text = renderTermMarkdown(candidate);
    const received = recognizeTermMarkdown({ text, filename: "model.md" });
    assert.equal(received.admitted, true, JSON.stringify(received.findings));
    assert.equal(received.relations[key], candidate.relations[key]);
  }

  const unqualified = { ...base, relations: { "invented-predicate": "system" } };
  assert.throws(() => admitTermRecord(unqualified),
    /term relation predicate is not authorized: invented-predicate/u);
  const source = renderTermMarkdown(base);
  const withUndeclaredRelation = source.replace("name: Model", "name: Model\nrelations:\n  invented-predicate: system");
  const refused = recognizeTermMarkdown({ text: withUndeclaredRelation, filename: "model.md" });
  assert.equal(refused.admitted, false);
  assert.ok(refused.findings.some(({ message }) => /invented-predicate/u.test(message)));
});

test("science record projects through Markdown with filename identity and first-class evidence", () => {
  const text = renderTermMarkdown({ identity: "model", name: "Model", aliases: ["representation"], keywords: ["system"], relations: { "acts-on": "system" }, references: { smith2024: { authors: ["A. Smith"], title: "Models", year: 2024, url: "https://example.com/models" } }, provenance: { "date-created": "2026-09-01", sources: ["smith2024"] }, body });
  const admitted = recognizeTermMarkdown({ text, filename: "model.md" });
  assert.equal(admitted.admitted, true);
  assert.equal(admitted.identity, "model");
  assert.equal(admitted.references.smith2024.url, "https://example.com/models");
  assert.deepEqual(admitted.relations, { "acts-on": "system" });
});

test("a reference carries its volume, issue, pages, and edition as bibliographic fields", () => {
  const text = renderTermMarkdown({ identity: "model", name: "Model", references: { smith2024: { authors: ["A. Smith"], title: "Models", year: 2024, publication: "Journal of Models", volume: "12", issue: "3", pages: "45-67", edition: "2nd" } }, body });
  const admitted = recognizeTermMarkdown({ text, filename: "model.md" });
  assert.equal(admitted.admitted, true, JSON.stringify(admitted.findings));
  assert.deepEqual([admitted.references.smith2024.volume, admitted.references.smith2024.issue, admitted.references.smith2024.pages, admitted.references.smith2024.edition], ["12", "3", "45-67", "2nd"]);
  const invented = text.replace("edition: 2nd", "edition: 2nd\n    isbn: 978");
  assert.equal(recognizeTermMarkdown({ text: invented, filename: "model.md" }).admitted, false);
});

test("identity must equal the filename and unknown predicates remain refused", () => {
  const wrong = renderTermMarkdown({ identity: "model", name: "Model", body });
  assert.equal(recognizeTermMarkdown({ text: wrong, filename: "copy.md" }).admitted, false);
  const invented = wrong.replace("name: Model", "name: Model\nrelations:\n  invented: thing");
  assert.equal(recognizeTermMarkdown({ text: invented, filename: "model.md" }).admitted, false);
});

test("consent-status is an optional scalar field that round-trips through render and recognize", () => {
  const text = renderTermMarkdown({ identity: "model", name: "Model", "consent-status": "kin-gated", body });
  assert.match(text, /consent-status: kin-gated/u);
  const recognized = recognizeTermMarkdown({ text, filename: "model.md" });
  assert.equal(recognized.admitted, true);
  assert.equal(recognized["consent-status"], "kin-gated");
  const withoutConsentStatus = recognizeTermMarkdown({ text: renderTermMarkdown({ identity: "model", name: "Model", body }), filename: "model.md" });
  assert.equal(withoutConsentStatus.admitted, true);
  assert.equal(withoutConsentStatus["consent-status"], undefined);
});

test("an unknown frontmatter key still refuses admission with consent-status admitted", () => {
  const withConsentStatus = renderTermMarkdown({ identity: "model", name: "Model", "consent-status": "season-gated", body });
  const withInvented = withConsentStatus.replace("name: Model", "name: Model\ninvented-key: nope");
  const recognized = recognizeTermMarkdown({ text: withInvented, filename: "model.md" });
  assert.equal(recognized.admitted, false);
  assert.ok(recognized.findings.some(({ rule, message }) => rule === "unknown-key" && message.includes("invented-key")));
});

test("identity is derived from the filename stem when the frontmatter carries none", () => {
  const text = `---\nname: Model\n---\n${body}\n`;
  const recognized = recognizeTermMarkdown({ text, filename: "model.md" });
  assert.equal(recognized.admitted, true);
  assert.equal(recognized.identity, "model");
});

test("carrier metadata keys at frontmatter top level are folded into provenance rather than refused or dropped", () => {
  const text = `---\nname: Model\ndate-created: 2026-03-29\ndate-updated: 2026-04-01\ntags:\n  - ontology\n  - epistemology\nauthors:\n  - claude\nid: legacy-model-id\ndomain: agents\nscheme: distinction-denomination\nstatus: draft\n---\n${body}\n`;
  const recognized = recognizeTermMarkdown({ text, filename: "model.md" });
  assert.equal(recognized.admitted, true);
  assert.deepEqual(recognized.findings, []);
  assert.deepEqual(recognized.provenance, {
    "date-created": "2026-03-29",
    "date-updated": "2026-04-01",
    tags: ["ontology", "epistemology"],
    authors: ["claude"],
    id: "legacy-model-id",
    domain: "agents",
    scheme: "distinction-denomination",
    status: "draft",
  });
});

test("resource type and creator remain first-class frontmatter rather than provenance", () => {
  const text = renderTermMarkdown({ identity: "artificial-intelligence", name: "Artificial intelligence", type: "intelligence", creator: "Homo sapiens", body });
  assert.match(text, /type: intelligence/u);
  assert.match(text, /creator: Homo sapiens/u);
  const recognized = recognizeTermMarkdown({ text, filename: "artificial-intelligence.md" });
  assert.equal(recognized.admitted, true);
  assert.equal(recognized.type, "intelligence");
  assert.equal(recognized.creator, "Homo sapiens");
  assert.equal(recognized.provenance, undefined);
});

test("a top-level carrier metadata key that disagrees with an explicit provenance entry is a finding, not a silent drop", () => {
  const text = `---\nname: Model\ndate-created: 2026-03-29\nprovenance:\n  date-created: 2026-01-01\n---\n${body}\n`;
  const recognized = recognizeTermMarkdown({ text, filename: "model.md" });
  assert.equal(recognized.admitted, false);
  assert.ok(recognized.findings.some(({ rule }) => rule === "provenance-conflict"));
});

test("authorized relation predicates stated at frontmatter top level (the corpus convention) are folded into relations rather than refused", () => {
  const text = `---\nname: Redshift\nrequires:\n  - light\n  - cosmic-expansion\nenables:\n  - hubble-parameter\ncontrasts-with:\n  - blueshift\n---\n${body}\n`;
  const recognized = recognizeTermMarkdown({ text, filename: "model.md" });
  assert.equal(recognized.admitted, true);
  assert.deepEqual(recognized.findings, []);
  assert.deepEqual(recognized.relations, { requires: ["light", "cosmic-expansion"], enables: ["hubble-parameter"], "contrasts-with": ["blueshift"] });
});

test("a top-level relation key that disagrees with an explicit relations entry is a finding, not a silent drop", () => {
  const text = `---\nname: Model\nrequires: light\nrelations:\n  requires: heat\n---\n${body}\n`;
  const recognized = recognizeTermMarkdown({ text, filename: "model.md" });
  assert.equal(recognized.admitted, false);
  assert.ok(recognized.findings.some(({ rule }) => rule === "relation-conflict"));
});

test("legacy migration separates relations, citations, and provenance", () => {
  const legacy = "---\nname: Model\ndomain: agents\nacts-on: system\ndate-created: 2026-03-29\ncites: [smith2024]\n---\n" + body;
  const migrated = migrateLegacyTermMarkdown({ text: legacy, filename: "model.md" });
  assert.deepEqual(migrated.record.relations, { "acts-on": "system" });
  assert.deepEqual(migrated.record.provenance, { "date-created": "2026-03-29", sources: ["smith2024"] });
  assert.ok(migrated.removedKeys.includes("domain"));
});

test("name defaults to the carrier's first H1 heading when the frontmatter states none", () => {
  const text = `---\nidentity: stellar-evolution\n---\n\n# Stellar Evolution\n\n${body}\n`;
  const recognized = recognizeTermMarkdown({ text, filename: "stellar-evolution.md" });
  assert.equal(recognized.admitted, true);
  assert.equal(recognized.name, "Stellar Evolution");
});

test("name defaults to the identity with hyphens turned to spaces when the original source carries no frontmatter or H1", () => {
  const text = `${body}\n`;
  const recognized = recognizeTermMarkdown({ text, filename: "stellar-evolution.md" });
  assert.equal(recognized.admitted, true);
  assert.equal(recognized.name, "stellar evolution");
});


test("an explicit empty YAML fence is not silently laundered into an authored term record", () => {
  const empty = recognizeTermMarkdown({ text: "---\n---\n" + body + "\n", filename: "stellar-evolution.md" });
  assert.equal(empty.admitted, false);
  assert.ok(empty.findings.some(({ rule }) => rule === "markdown"),
    "an explicit YAML null is not an object-valued term record under the upstream Markdown codec");
  const genuinelyAbsent = recognizeTermMarkdown({ text: body, filename: "stellar-evolution.md" });
  assert.equal(genuinelyAbsent.admitted, true, JSON.stringify(genuinelyAbsent.findings));
  assert.equal(genuinelyAbsent.name, "stellar evolution");
});

test("an explicit name still wins over a first H1 heading", () => {
  const text = `---\nname: Model\n---\n\n# Something Else\n\n${body}\n`;
  const recognized = recognizeTermMarkdown({ text, filename: "model.md" });
  assert.equal(recognized.admitted, true);
  assert.equal(recognized.name, "Model");
});

test("FARS status-function keys (params/ast/output) at frontmatter top level are folded into status-function, never refused, never dropped, and never relations", () => {
  const text = `---\nname: Stellar Evolution\nparams:\n  star: relational-universe\noutput: relational-history-fiber-proposition\nast:\n  relational-history-fiber-element:\n    - star\n---\n${body}\n`;
  const recognized = recognizeTermMarkdown({ text, filename: "model.md" });
  assert.equal(recognized.admitted, true);
  assert.deepEqual(recognized.findings, []);
  assert.deepEqual(recognized["status-function"], {
    params: { star: "relational-universe" },
    output: "relational-history-fiber-proposition",
    ast: { "relational-history-fiber-element": ["star"] },
  });
  assert.deepEqual(recognized.relations, {});
  const rendered = renderTermMarkdown({ identity: "model", name: "Stellar Evolution", "status-function": recognized["status-function"], body });
  const roundTripped = recognizeTermMarkdown({ text: rendered, filename: "model.md" });
  assert.equal(roundTripped.admitted, true);
  assert.deepEqual(roundTripped["status-function"], recognized["status-function"]);
});

test("a top-level status-function key that disagrees with an explicit status-function entry is a finding, not a silent drop", () => {
  const text = `---\nname: Model\noutput: a\nstatus-function:\n  output: b\n---\n${body}\n`;
  const recognized = recognizeTermMarkdown({ text, filename: "model.md" });
  assert.equal(recognized.admitted, false);
  assert.ok(recognized.findings.some(({ rule }) => rule === "status-function-conflict"));
});

test("write requires explicit filename identity and collision authority", async () => {
  const term = { filename: "model.md", identity: "model", name: "Model", body };
  const semanticEvidence = { sources: ["source.md"], claims: { definition: body, distinction: body, consequence: body } };
  await assert.rejects(writeTerm({ termDirectory: "/tmp/terms", term, semanticEvidence }, { exists: () => true }), /explicit overwrite/u);
  const writes = []; const result = await writeTerm({ termDirectory: "/tmp/terms", term, semanticEvidence }, { exists: () => false, write: (...args) => writes.push(args) });
  assert.equal(result.filename, "model.md"); assert.equal(writes.length, 1);
});

test("default term name uses canonical headings beyond fenced examples", () => {
  const text = "~~~~md\n# Wrong Name\n~~~~\n\nReal Name\n=========\n\nA precise description of the term.\n";
  assert.equal(recognizeTermMarkdown({ text, filename: "fallback.md" }).name, "Real Name");
});

test("a four-part Simion is admitted as resolvable relations, not opaque prose or a duplicated taxonomy", () => {
  const simion = {
    identity: "simion", name: "Simion",
    body: "A Simion is a Thing composed of Actor, Character, Player and Agent, participating in an inhabited World.",
    relations: { "composed-of": ["actor", "character", "player", "agent"], "requires": "world" },
  };
  assert.equal(admitTermRecord(simion), simion);
  const markdown = renderTermMarkdown(simion);
  const recognized = recognizeTermMarkdown({ text: markdown, filename: "simion.md" });
  assert.equal(recognized.admitted, true, JSON.stringify(recognized.findings));
  assert.deepEqual(recognized.relations["composed-of"], simion.relations["composed-of"]);
  for (const bad of ["Actor + Character", "https://example.org/actor", "actor?role=player", ""]) {
    assert.throws(
      () => admitTermRecord({ ...simion, relations: { "composed-of": ["actor", bad] } }),
      /relation composed-of/,
      "an invalid carrier target must be refused before index/SKOS/foam silently omit it",
    );
  }
  const malformed = markdown.replace("  - character", "  - 'Actor + Character'");
  const refusal = recognizeTermMarkdown({ text: malformed, filename: "simion.md" });
  assert.equal(refusal.admitted, false);
  assert.ok(refusal.findings.some(({ message }) => /relation composed-of/.test(message)));
  assert.equal(admitTermRecord({ ...simion, relations: { symbol: "Actor + Character" } }).identity, "simion",
    "literal-range relations must still admit readable text");
});
