#!/usr/bin/env node
import { writeFileText } from "@red-cup-engineering/file-services/write-file";
import { argument } from "@red-cup-engineering/javascript-node-services-section/argv";
import { confinePath } from "@red-cup-engineering/filepath-services-section";
import { isMain } from "@red-cup-engineering/javascript-file-services-section/javascript-file-main-guard";
import { planIdentityRenames, planMarkdownCorpusCleanup } from "../src/term-migration.mjs";
import { DEFAULT_SCIENCE_RECORDS_OUT_DIR, DEFAULT_SCIENCE_ROOT, TERM_PACKAGE_REPO_ROOT } from "./census-set-of-term-admissions.mjs";
import { readMarkdownCorpus } from "./plan-set-of-terms.mjs";

export { planIdentityRenames, planMarkdownCorpusCleanup } from "../src/term-migration.mjs";

const DEFAULT_ROOT = DEFAULT_SCIENCE_ROOT;
const DEFAULT_OUT_DIR = DEFAULT_SCIENCE_RECORDS_OUT_DIR;
const EXCLUDED_DIRECTORY_NAMES = new Set(["legacy", "triage", "node_modules", "dist"]);

/** Repo-relative form of an absolute path when it sits under the term package's repo root, else the path unchanged. @param {string} absolutePath @returns {string} */
function repoRelative(absolutePath) {
  try {
    return confinePath({ root: TERM_PACKAGE_REPO_ROOT, path: absolutePath }).relativePath;
  } catch {
    return absolutePath;
  }
}

/** Same scope the term-admission census walks: drops legacy/triage/node_modules/dist paths so migration counts stay comparable to the census. @param {Array<{relativePath: string}>} documents @returns {Array<{relativePath: string}>} */
export function excludeLegacyAndDependencyPaths(documents) {
  return documents.filter(({ relativePath }) => !relativePath.split("/").some((segment) => EXCLUDED_DIRECTORY_NAMES.has(segment)));
}

/** @param {string[]} argv @returns {{root: string, outDir: string, date: string, suffix: string|undefined}} */
export function parseMigrationPlanArgs(argv) {
  const root = argument("--root", argv);
  const outDir = argument("--out-dir", argv);
  return {
    root: root === undefined ? DEFAULT_ROOT : confinePath({ root }).path,
    outDir: outDir === undefined ? DEFAULT_OUT_DIR : confinePath({ root: outDir }).path,
    date: argument("--date", argv) ?? new Date().toISOString().slice(0, 10),
    suffix: argument("--suffix", argv),
  };
}

function countActionsByOperation(plan) {
  const counts = new Map();
  for (const transaction of plan.transactions) for (const action of transaction.actions) counts.set(action.operation, (counts.get(action.operation) ?? 0) + 1);
  return Object.fromEntries([...counts.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function countTransactionsWithOperation(plan, operation) {
  return plan.transactions.filter((transaction) => transaction.actions.some((action) => action.operation === operation)).length;
}

/**
 * Plan the term-carrier migrations named in the 2026-09-04 term-contract step-two rulings: date
 * normalization and references-list-to-map (both content transactions, from
 * planMarkdownCorpusCleanup), plus identity kebab-case renames (a separate, apply-never-this-lot
 * plan from planIdentityRenames). Never writes to any source carrier.
 * @param {string} root
 * @returns {{root: string, cleanupPlan: ReturnType<typeof planMarkdownCorpusCleanup>, renamePlan: ReturnType<typeof planIdentityRenames>, counts: object}}
 */
export function planSetOfScienceTermMigrations(root) {
  const documents = excludeLegacyAndDependencyPaths(readMarkdownCorpus(root));
  const cleanupPlan = planMarkdownCorpusCleanup(documents);
  const renamePlan = planIdentityRenames(documents);
  const counts = {
    documentsConsidered: documents.length,
    cleanupPlan: cleanupPlan.counts,
    actionsByOperation: countActionsByOperation(cleanupPlan),
    dateNormalization: { transactionsWithAction: countTransactionsWithOperation(cleanupPlan, "normalize-date-frontmatter-value") },
    referencesMigration: { transactionsWithAction: countTransactionsWithOperation(cleanupPlan, "migrate-references-list-to-map") },
    identityRenames: renamePlan.counts,
  };
  return { root, cleanupPlan, renamePlan, counts };
}

/**
 * Run the migration plan and write it as a dated record under `outDir`.
 * @param {{root: string, outDir: string, date: string, suffix?: string}} options
 * @returns {{recordPath: string, plan: ReturnType<typeof planSetOfScienceTermMigrations>}}
 */
export async function runScienceTermMigrationPlan({ root, outDir, date, suffix }) {
  const plan = planSetOfScienceTermMigrations(root);
  const stem = `${date}-science-term-migration-plan${suffix ? `-${suffix}` : ""}`;
  const recordPath = `${outDir}/${stem}.json`;
  const record = {
    checkedAt: new Date().toISOString(),
    root: repoRelative(plan.root),
    counts: plan.counts,
    renames: plan.renamePlan.renames,
  };
  await writeFileText(recordPath, `${JSON.stringify(record, null, 2)}\n`);
  return { recordPath, plan };
}

if (isMain(import.meta.url)) {
  const options = parseMigrationPlanArgs(process.argv.slice(2));
  const { recordPath, plan } = await runScienceTermMigrationPlan(options);
  process.stdout.write(`${JSON.stringify(plan.counts, null, 2)}\n\nrecord: ${recordPath}\n`);
}
