#!/usr/bin/env node
import { chmod, copyFile, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute as isAbsoluteFilepath, join, relative, resolve, sep } from "node:path";
import { fileURLToPath as projectFileUrlFilepath } from "node:url";
import { MarkdownFileRevisionConflict, markdownFileRevision, writeMarkdownFile } from "@red-cup-engineering/markdown-engineering-services-section/write-markdown-file";
import { classifyMarkdownCorpusPath, planMarkdownCorpusCleanup, prepareMarkdownCorpusCleanupDocument, selectMarkdownCorpusCleanupTransactionsByActionKinds } from "../src/term-migration.mjs";
import { readMarkdownCorpus } from "./plan-set-of-terms.mjs";
import { sha256Hex } from "@red-cup-engineering/cryptographic-computer-data-engineering-services-section/integrity";


function confined(root, relativePath) {
  if (isAbsoluteFilepath(relativePath)) throw new TypeError(`corpus path must be relative: ${relativePath}`);
  const absolute = resolve(root, relativePath);
  const fromRoot = relative(root, absolute);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsoluteFilepath(fromRoot)) throw new TypeError(`corpus path escapes root: ${relativePath}`);
  return absolute;
}

async function createValidatedBackup(root, plan, backupDirectory) {
  // The session TMPDIR is a mounted Windows volume that cannot witness POSIX
  // modes. Backups use the native host temporary filesystem deliberately.
  const directory = backupDirectory ?? await mkdtemp("/tmp/tess-markdown-cleanup-");
  const relativeToRoot = relative(resolve(root), resolve(directory));
  if (relativeToRoot === "" || (!relativeToRoot.startsWith("..") && !isAbsoluteFilepath(relativeToRoot))) throw new TypeError("backup directory must be outside the repository");
  await mkdir(directory, { recursive: true });
  const entries = [];
  for (const transaction of plan.transactions) {
    const source = confined(root, transaction.path);
    const destination = confined(directory, transaction.path);
    const sourceStat = await stat(source);
    const bytes = await readFile(source);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
    await chmod(destination, sourceStat.mode & 0o777);
    entries.push(Object.freeze({ path: transaction.path, mode: sourceStat.mode & 0o777, bytes: bytes.byteLength, sha256: sha256Hex(bytes) }));
  }
  const manifest = Object.freeze({ schema: "computer-glossary-markdown-cleanup-backup.v1", repositoryRoot: resolve(root), count: entries.length, entries: Object.freeze(entries) });
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeFile(join(directory, "manifest.json"), manifestText, { flag: "wx" });
  const failures = [];
  for (const entry of entries) {
    const backupPath = confined(directory, entry.path);
    const [bytes, observedStat] = await Promise.all([readFile(backupPath), stat(backupPath)]);
    if (sha256Hex(bytes) !== entry.sha256) failures.push(`${entry.path}: hash`);
    if ((observedStat.mode & 0o777) !== entry.mode) failures.push(`${entry.path}: mode`);
  }
  if (entries.length !== plan.transactions.length) failures.push("backup count");
  if (failures.length > 0) throw new Error(`backup validation failed: ${failures.slice(0, 20).join(", ")}`);
  return Object.freeze({ directory, manifest, manifestSha256: sha256Hex(manifestText), validated: true });
}

async function restoreChanged(root, backup, changed) {
  const restored = [], failures = [];
  for (const receipt of [...changed].reverse()) {
    try {
      const current = await readFile(confined(root, receipt.path), "utf8");
      if (sha256Hex(current) !== receipt.afterSha256) throw new Error("current bytes drifted after operation write");
      const entry = backup.manifest.entries.find(({ path }) => path === receipt.path);
      if (entry === undefined) throw new Error("backup entry missing");
      const original = await readFile(confined(backup.directory, receipt.path), "utf8");
      await writeMarkdownFile({ root, path: receipt.path, text: original, mode: "replace", normalization: "preserve", expectedRevision: markdownFileRevision(current) });
      await chmod(confined(root, receipt.path), entry.mode);
      if (sha256Hex(await readFile(confined(root, receipt.path))) !== entry.sha256) throw new Error("restored hash mismatch");
      restored.push(receipt.path);
    } catch (error) {
      failures.push(Object.freeze({ path: receipt.path, reason: error.message }));
    }
  }
  return Object.freeze({ restored: Object.freeze(restored), failures: Object.freeze(failures) });
}

/** Apply one witnessed plan through atomic, revision-guarded Markdown writes. */
export async function applyMarkdownCorpusCleanupPlan({ root, documents, plan, backupDirectory, writeOperation = writeMarkdownFile }) {
  const repositoryRoot = resolve(root);
  if (plan?.schema !== "computer-glossary-markdown-corpus-cleanup-plan.v1" || !Array.isArray(documents)) throw new TypeError("root, documents, and cleanup plan are required");
  const recomputed = planMarkdownCorpusCleanup(documents);
  const isFullPlan = JSON.stringify(recomputed.transactions) === JSON.stringify(plan.transactions) && JSON.stringify(recomputed.refusals) === JSON.stringify(plan.refusals);
  if (!isFullPlan) {
    // A `plan` may be an explicit subset of the freshly recomputed one (see
    // selectMarkdownCorpusCleanupTransactionsByActionKinds, e.g. an action-kind-restricted
    // apply): every transaction it names must still byte-match what a fresh recomputation
    // produces for that same path, but it need not name every recomputed transaction.
    const recomputedByPath = new Map(recomputed.transactions.map((transaction) => [transaction.path, transaction]));
    for (const transaction of plan.transactions) {
      const witness = recomputedByPath.get(transaction.path);
      if (witness === undefined || JSON.stringify(witness) !== JSON.stringify(transaction)) throw new Error("cleanup plan does not match its source witnesses");
    }
  }
  const backup = await createValidatedBackup(repositoryRoot, plan, backupDirectory);
  const byPath = new Map(documents.map((document) => [document.relativePath, document]));
  const prepared = new Map(), drifted = [];
  for (const transaction of plan.transactions) {
    const current = await readFile(confined(repositoryRoot, transaction.path), "utf8");
    const currentSha256 = sha256Hex(current);
    if (currentSha256 !== transaction.beforeSha256) {
      drifted.push(Object.freeze({ path: transaction.path, expectedSha256: transaction.beforeSha256, currentSha256 }));
      continue;
    }
    const proposal = prepareMarkdownCorpusCleanupDocument({ relativePath: transaction.path, text: current });
    if (proposal.disposition !== "planned" || sha256Hex(proposal.output) !== transaction.proposedAfterSha256 || JSON.stringify(proposal.actions) !== JSON.stringify(transaction.actions)) throw new Error(`transaction recomputation mismatch: ${transaction.path}`);
    prepared.set(transaction.path, proposal.output);
  }
  const changed = [];
  try {
    for (const transaction of plan.transactions) {
      const output = prepared.get(transaction.path);
      if (output === undefined) continue;
      let receipt;
      try {
        receipt = await writeOperation({ root: repositoryRoot, path: transaction.path, text: output, mode: "replace", normalization: "preserve", expectedRevision: `sha256:${transaction.beforeSha256}` });
      } catch (error) {
        if (error instanceof MarkdownFileRevisionConflict || error?.code === "ENOENT" || /does not exist/u.test(error?.message ?? "")) {
          let currentSha256 = null;
          try { currentSha256 = sha256Hex(await readFile(confined(repositoryRoot, transaction.path))); } catch {}
          drifted.push(Object.freeze({ path: transaction.path, expectedSha256: transaction.beforeSha256, currentSha256, phase: "write" }));
          continue;
        }
        throw error;
      }
      if (!receipt.changed) throw new Error(`admitted transaction made no change: ${transaction.path}`);
      const observed = await readFile(confined(repositoryRoot, transaction.path));
      if (sha256Hex(observed) !== transaction.proposedAfterSha256) throw new Error(`after hash mismatch: ${transaction.path}`);
      changed.push(Object.freeze({ path: transaction.path, beforeSha256: transaction.beforeSha256, afterSha256: transaction.proposedAfterSha256 }));
    }
    const changedPaths = new Set(changed.map(({ path }) => path));
    const driftedPaths = new Set(drifted.map(({ path }) => path));
    const admittedPaths = plan.transactions.map(({ path }) => path).filter((path) => !driftedPaths.has(path));
    if (changedPaths.size !== admittedPaths.length || admittedPaths.some((path) => !changedPaths.has(path))) throw new Error("changed path set does not equal admitted plan");
    const unmentionedMismatches = [];
    for (const document of documents) {
      const classification = classifyMarkdownCorpusPath(document.relativePath, { ignored: document.ignored === true });
      if (!classification.included || changedPaths.has(document.relativePath)) continue;
      const before = sha256Hex(document.text);
      const after = sha256Hex(await readFile(confined(repositoryRoot, document.relativePath)));
      if (before !== after) unmentionedMismatches.push(Object.freeze({ path: document.relativePath, beforeSha256: before, afterSha256: after }));
    }
    return Object.freeze({ disposition: "applied", backup, counts: Object.freeze({ planned: plan.transactions.length, admitted: admittedPaths.length, drifted: drifted.length, changed: changed.length, unmentionedDrift: unmentionedMismatches.length }), changed: Object.freeze(changed), drifted: Object.freeze(drifted), unmentionedMismatches: Object.freeze(unmentionedMismatches), unchangedWitness: plan.unchangedWitness });
  } catch (error) {
    const restoration = await restoreChanged(repositoryRoot, backup, changed);
    const failure = new Error(`cleanup apply failed and restoration was attempted: ${error.message}`);
    failure.cause = error;
    failure.restoration = restoration;
    failure.backup = backup;
    throw failure;
  }
}

/** Recompute the repository plan, back it up, and apply it. */
export async function applySetOfTerms(root = process.cwd(), options = {}) {
  const documents = readMarkdownCorpus(root);
  const plan = planMarkdownCorpusCleanup(documents);
  return applyMarkdownCorpusCleanupPlan({ root, documents, plan, backupDirectory: options.backupDirectory });
}

/**
 * Recompute the repository plan, restrict it to transactions whose actions are entirely within
 * `kinds` (a mixed-kind transaction is skipped this pass), back up, and apply only that subset.
 * @param {string} root
 * @param {string[]} kinds `action.operation` allow-list, e.g. ["normalize-date-frontmatter-value", "migrate-references-list-to-map"]
 * @param {{backupDirectory?: string}} [options]
 */
export async function applySetOfTermsByActionKinds(root = process.cwd(), kinds, options = {}) {
  const documents = readMarkdownCorpus(root);
  const plan = planMarkdownCorpusCleanup(documents);
  const selectedPlan = selectMarkdownCorpusCleanupTransactionsByActionKinds(plan, kinds);
  return applyMarkdownCorpusCleanupPlan({ root, documents, plan: selectedPlan, backupDirectory: options.backupDirectory });
}

if (resolve(projectFileUrlFilepath(import.meta.url)) === resolve(process.argv[1] ?? "")) {
  const args = process.argv.slice(2);
  const actionKindsIndex = args.indexOf("--action-kinds");
  const actionKinds = actionKindsIndex === -1 ? undefined : args[actionKindsIndex + 1]?.split(",").filter(Boolean);
  const positional = actionKindsIndex === -1 ? args : [...args.slice(0, actionKindsIndex), ...args.slice(actionKindsIndex + 2)];
  const root = positional[0] ?? process.cwd();
  const run = actionKinds ? applySetOfTermsByActionKinds(root, actionKinds) : applySetOfTerms(root);
  run.then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.disposition !== "applied") process.exitCode = 2;
  }).catch((error) => {
    process.stderr.write(`${JSON.stringify({ error: error.message, restoration: error.restoration, backupDirectory: error.backup?.directory }, null, 2)}\n`);
    process.exitCode = 1;
  });
}
