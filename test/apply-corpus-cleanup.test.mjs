import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { writeMarkdownFile } from "@red-cup-engineering/markdown-engineering-services-section/write-markdown-file";
import { applyMarkdownCorpusCleanupPlan } from "../scripts/apply-set-of-terms.mjs";
import { planMarkdownCorpusCleanup, selectMarkdownCorpusCleanupTransactionsByActionKinds } from "../src/term-migration.mjs";

const dirty = "---\nslug: model\nname: Model\n---\n# Model\nBody.\n";
const clean = "---\nname: Model\n---\nBody.\n";

async function fixture() {
  const root = await mkdtemp("/tmp/tess-apply-root-");
  const backup = await mkdtemp("/tmp/tess-apply-backup-");
  await writeFile(join(root, "model.md"), dirty);
  await writeFile(join(root, "plain.md"), "Plain.\n");
  await chmod(join(root, "model.md"), 0o640);
  const documents = [
    { relativePath: "model.md", text: dirty },
    { relativePath: "plain.md", text: "Plain.\n" },
  ];
  return { root, backup, documents, plan: planMarkdownCorpusCleanup(documents) };
}

test("backs up, validates, revision-guards, and applies exactly the planned set", async () => {
  const value = await fixture();
  try {
    const result = await applyMarkdownCorpusCleanupPlan({ root: value.root, documents: value.documents, plan: value.plan, backupDirectory: value.backup });
    assert.equal(result.disposition, "applied");
    assert.deepEqual(result.counts, { planned: 1, admitted: 1, drifted: 0, changed: 1, unmentionedDrift: 0 });
    assert.equal(await readFile(join(value.root, "model.md"), "utf8"), clean);
    assert.equal(await readFile(join(value.backup, "model.md"), "utf8"), dirty);
    assert.equal(JSON.parse(await readFile(join(value.backup, "manifest.json"), "utf8")).count, 1);
    assert.equal((await stat(join(value.backup, "model.md"))).mode & 0o777, 0o640);
    assert.equal(await readFile(join(value.root, "plain.md"), "utf8"), "Plain.\n");
  } finally {
    await rm(value.root, { recursive: true, force: true });
    await rm(value.backup, { recursive: true, force: true });
  }
});

test("refuses a drifted planned file before any write", async () => {
  const value = await fixture();
  try {
    await writeFile(join(value.root, "model.md"), `${dirty}Concurrent.\n`);
    const result = await applyMarkdownCorpusCleanupPlan({ root: value.root, documents: value.documents, plan: value.plan, backupDirectory: value.backup });
    assert.equal(result.disposition, "applied");
    assert.equal(result.counts.changed, 0);
    assert.equal(result.counts.drifted, 1);
    assert.equal(result.counts.unmentionedDrift, 1);
    assert.equal(await readFile(join(value.root, "model.md"), "utf8"), `${dirty}Concurrent.\n`);
  } finally {
    await rm(value.root, { recursive: true, force: true });
    await rm(value.backup, { recursive: true, force: true });
  }
});

test("restores only completed operation writes after a later write failure", async () => {
  const value = await fixture();
  try {
    await writeFile(join(value.root, "second.md"), "---\nslug: second\nname: Second\n---\nBody.\n");
    value.documents.push({ relativePath: "second.md", text: "---\nslug: second\nname: Second\n---\nBody.\n" });
    value.plan = planMarkdownCorpusCleanup(value.documents);
    let calls = 0;
    const writeOperation = async (options) => {
      calls += 1;
      if (calls === 2) throw new Error("injected write failure");
      return writeMarkdownFile(options);
    };
    await assert.rejects(
      () => applyMarkdownCorpusCleanupPlan({ root: value.root, documents: value.documents, plan: value.plan, backupDirectory: value.backup, writeOperation }),
      (error) => error.restoration?.restored.length === 1 && error.restoration.failures.length === 0,
    );
    assert.equal(await readFile(join(value.root, "model.md"), "utf8"), dirty);
    assert.equal(await readFile(join(value.root, "second.md"), "utf8"), "---\nslug: second\nname: Second\n---\nBody.\n");
  } finally {
    await rm(value.root, { recursive: true, force: true });
    await rm(value.backup, { recursive: true, force: true });
  }
});

test("applies only a named action-kind subset of a freshly recomputed plan, leaving a mixed-kind transaction untouched", async () => {
  const dateOnly = "---\nname: Redshift\ndate-created: \"[[2025-04-27]]\"\n---\nRedshift is documented here for the fixture.\n";
  const mixed = "---\nslug: mixed\nname: Mixed\ndate-created: \"[[2025-04-27]]\"\n---\nMixed carries both a legacy key and a date to normalize.\n";
  const root = await mkdtemp("/tmp/tess-apply-kinds-root-");
  const backup = await mkdtemp("/tmp/tess-apply-kinds-backup-");
  try {
    await mkdir(join(root, "terms"), { recursive: true });
    await writeFile(join(root, "terms", "redshift.md"), dateOnly);
    await writeFile(join(root, "terms", "mixed.md"), mixed);
    const documents = [
      { relativePath: "terms/redshift.md", text: dateOnly },
      { relativePath: "terms/mixed.md", text: mixed },
    ];
    const plan = planMarkdownCorpusCleanup(documents);
    assert.equal(plan.counts.planned, 2);
    const selected = selectMarkdownCorpusCleanupTransactionsByActionKinds(plan, ["normalize-date-frontmatter-value"]);
    assert.equal(selected.transactions.length, 1);
    assert.equal(selected.transactions[0].path, "terms/redshift.md");
    const result = await applyMarkdownCorpusCleanupPlan({ root, documents, plan: selected, backupDirectory: backup });
    assert.equal(result.disposition, "applied");
    assert.deepEqual(result.counts, { planned: 1, admitted: 1, drifted: 0, changed: 1, unmentionedDrift: 0 });
    assert.match(await readFile(join(root, "terms", "redshift.md"), "utf8"), /date-created: 2025-04-27/u);
    assert.equal(await readFile(join(root, "terms", "mixed.md"), "utf8"), mixed);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(backup, { recursive: true, force: true });
  }
});
