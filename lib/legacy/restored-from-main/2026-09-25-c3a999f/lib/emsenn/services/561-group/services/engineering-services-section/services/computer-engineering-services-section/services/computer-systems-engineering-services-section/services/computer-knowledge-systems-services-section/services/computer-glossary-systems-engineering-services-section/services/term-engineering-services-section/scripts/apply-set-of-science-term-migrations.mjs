#!/usr/bin/env node
import { writeFileText } from "@red-cup-engineering/file-services/write-file";
import { argument } from "@red-cup-engineering/javascript-node-services-section/argv";
import { confinePath } from "@red-cup-engineering/filepath-services-section";
import { isMain } from "@red-cup-engineering/javascript-file-services-section/javascript-file-main-guard";
import { selectMarkdownCorpusCleanupTransactionsByActionKinds } from "../src/term-migration.mjs";
import { applyMarkdownCorpusCleanupPlan } from "./apply-set-of-terms.mjs";
import { DEFAULT_SCIENCE_RECORDS_OUT_DIR, DEFAULT_SCIENCE_ROOT, TERM_PACKAGE_REPO_ROOT } from "./census-set-of-term-admissions.mjs";
import { excludeLegacyAndDependencyPaths, planMarkdownCorpusCleanup } from "./plan-set-of-science-term-migrations.mjs";
import { readMarkdownCorpus } from "./plan-set-of-terms.mjs";

const DEFAULT_ROOT = DEFAULT_SCIENCE_ROOT;
const DEFAULT_OUT_DIR = DEFAULT_SCIENCE_RECORDS_OUT_DIR;
const APPLIED_ACTION_KINDS = Object.freeze(["normalize-date-frontmatter-value", "migrate-references-list-to-map"]);

function repoRelative(absolutePath) {
  try { return confinePath({ root: TERM_PACKAGE_REPO_ROOT, path: absolutePath }).relativePath; } catch { return absolutePath; }
}

/**
 * Apply exactly the date-normalization and references-list-to-map migrations (ruling 2 and
 * ruling 6) to the term-directory carriers under `root`, over the same legacy/triage-excluded
 * scope the migration plan and the term-admission census use. Every other planned or refused
 * transaction (identity renames, ALWAYS_DELETE_KEYS cleanup, H1 de-duplication, ...) is left
 * untouched this pass.
 * @param {string} root
 * @param {{backupDirectory?: string}} [options]
 */
export async function applyScienceTermDateAndReferenceMigrations(root, options = {}) {
  const documents = excludeLegacyAndDependencyPaths(readMarkdownCorpus(root));
  const plan = planMarkdownCorpusCleanup(documents);
  const selected = selectMarkdownCorpusCleanupTransactionsByActionKinds(plan, APPLIED_ACTION_KINDS);
  return applyMarkdownCorpusCleanupPlan({ root, documents, plan: selected, backupDirectory: options.backupDirectory });
}

/** @param {string[]} argv @returns {{root: string, outDir: string, date: string, suffix: string|undefined}} */
function parseArgs(argv) {
  const root = argument("--root", argv);
  const outDir = argument("--out-dir", argv);
  return {
    root: root === undefined ? DEFAULT_ROOT : confinePath({ root }).path,
    outDir: outDir === undefined ? DEFAULT_OUT_DIR : confinePath({ root: outDir }).path,
    date: argument("--date", argv) ?? new Date().toISOString().slice(0, 10),
    suffix: argument("--suffix", argv),
  };
}

if (isMain(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  const result = await applyScienceTermDateAndReferenceMigrations(options.root, {});
  const stem = `${options.date}-science-term-migration-apply${options.suffix ? `-${options.suffix}` : ""}`;
  const recordPath = `${options.outDir}/${stem}.json`;
  const record = {
    checkedAt: new Date().toISOString(),
    root: repoRelative(options.root),
    actionKinds: APPLIED_ACTION_KINDS,
    disposition: result.disposition,
    counts: result.counts,
    backupDirectory: result.backup?.directory,
  };
  await writeFileText(recordPath, `${JSON.stringify(record, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(record, null, 2)}\n\nrecord: ${recordPath}\n`);
  if (result.disposition !== "applied") process.exitCode = 2;
}
