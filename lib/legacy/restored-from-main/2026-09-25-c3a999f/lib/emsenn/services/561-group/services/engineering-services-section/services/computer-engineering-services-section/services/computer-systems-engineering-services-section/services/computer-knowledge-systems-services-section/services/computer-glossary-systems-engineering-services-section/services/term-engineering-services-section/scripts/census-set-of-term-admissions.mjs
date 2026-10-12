#!/usr/bin/env node
// friction (term-engineering-services-section-node-import-migration, 2026-09-04): no house
// service converts a file:// URL (import.meta.url) to a filesystem path, and
// filepath-services-section's confinePath refuses any ".." displacement that escapes its
// root by design (it is a confinement primitive, not a general resolver) — these module
// constants deliberately walk upward past scripts/ to the repo root, so node:path's resolve
// stays here for exactly that ancestor-escaping join.
import { resolve as resolvePath } from "node:path";
import { fileURLToPath as projectFileUrlFilepath } from "node:url";
import { writeFileText } from "@red-cup-engineering/file-services/write-file";
import { confinePath } from "@red-cup-engineering/filepath-services-section";
import { argument } from "@red-cup-engineering/javascript-node-services-section/argv";
import { isMain } from "@red-cup-engineering/javascript-file-services-section/javascript-file-main-guard";
import { censusTermAdmissions } from "../src/term-admission-census.mjs";

export { censusTermAdmissions } from "../src/term-admission-census.mjs";

const SCRIPT_DIRECTORY = projectFileUrlFilepath(new URL("./", import.meta.url).href);
const REPO_ROOT = resolvePath(SCRIPT_DIRECTORY, "../../../../../../../../../../../../../../../../..");
const DEFAULT_ROOT = resolvePath(SCRIPT_DIRECTORY, "../../../../../../../../../../../../science-services-section");
const DEFAULT_OUT_DIR = resolvePath(SCRIPT_DIRECTORY, "../../../../../../../../../../../../561-group-services-section/services/561-group-science-services-section/data/records");
/** The science-services-section root the term-admission census walks by default, reused by sibling migration-planning scripts so they need no node:path/node:url ancestor-walk of their own. */
export const DEFAULT_SCIENCE_ROOT = DEFAULT_ROOT;
/** The 561-group-science-services-section data/records directory the census writes to by default, reused by sibling migration-planning scripts. */
export const DEFAULT_SCIENCE_RECORDS_OUT_DIR = DEFAULT_OUT_DIR;
/** REPO_ROOT, reused by sibling scripts that render repo-relative paths in their own records. */
export const TERM_PACKAGE_REPO_ROOT = REPO_ROOT;
// friction (term-engineering-services-section-node-import-migration, 2026-09-04):
// semantic-record-journal-service writes an append-only JSONL log under data/logs/, never an
// exact named path under data/records/ that other carriers already cite. Kept as a
// house-file-services writer (not raw node:fs) of these exact-path carriers until the journal
// grows that shape.

/** Repo-relative form of an absolute path when it sits under REPO_ROOT, else the path unchanged. @param {string} absolutePath @returns {string} */
function repoRelative(absolutePath) {
  try {
    return confinePath({ root: REPO_ROOT, path: absolutePath }).relativePath;
  } catch {
    return absolutePath;
  }
}

/** @param {string[]} argv @returns {{root: string, outDir: string, date: string, limit: number|undefined, suffix: string|undefined}} */
export function parseCensusArgs(argv) {
  const root = argument("--root", argv);
  const outDir = argument("--out-dir", argv);
  const limitText = argument("--limit", argv);
  return {
    root: root === undefined ? DEFAULT_ROOT : confinePath({ root }).path,
    outDir: outDir === undefined ? DEFAULT_OUT_DIR : confinePath({ root: outDir }).path,
    date: argument("--date", argv) ?? new Date().toISOString().slice(0, 10),
    limit: limitText === undefined ? undefined : Number(limitText),
    suffix: argument("--suffix", argv),
  };
}

function formatFraction(value) { return value === null ? "n/a" : value.toFixed(4); }

/** @param {ReturnType<typeof censusTermAdmissions>} census @returns {string} */
export function renderCensusTable(census) {
  const lines = [
    `root: ${census.root}`,
    `total: ${census.counts.total}  admitted: ${census.counts.admitted}  refused: ${census.counts.refused}  admittedFraction: ${formatFraction(census.admittedFraction)}`,
    "",
    "by subsection (admitted/total):",
  ];
  for (const [name, stats] of Object.entries(census.bySubsection)) lines.push(`  ${name}: ${stats.admitted}/${stats.total} (${formatFraction(stats.admittedFraction)})`);
  lines.push("", "top refusal causes:");
  for (const [key, count] of Object.entries(census.refusalHistogram).slice(0, 25)) lines.push(`  ${count}\t${key}`);
  return lines.join("\n");
}

/** @param {ReturnType<typeof censusTermAdmissions>} census @returns {string} */
function renderRowsTsv(census) {
  const header = ["relativePath", "subsection", "admitted", "findingCount", "findings"];
  const lines = [header.join("\t")];
  for (const row of census.rows) {
    const findings = row.findings.map(({ rule, message }) => `${rule}: ${message}`).join(" | ");
    lines.push([row.relativePath, row.subsection, String(row.admitted), String(row.findings.length), findings].join("\t"));
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Run the census, write its dated record and rows TSV under `outDir`, and print a summary table
 * to stdout.
 * @param {{root: string, outDir: string, date: string, limit?: number, suffix?: string}} options
 * @returns {{recordPath: string, rowsPath: string, census: ReturnType<typeof censusTermAdmissions>}}
 */
export async function runTermAdmissionCensus({ root, outDir, date, limit, suffix }) {
  const census = censusTermAdmissions(root, { limit });
  const stem = `${date}-science-term-admission-census${suffix ? `-${suffix}` : ""}`;
  const recordPath = `${outDir}/${stem}.json`;
  const rowsPath = `${outDir}/${stem}.rows.tsv`;
  const record = { checkedAt: new Date().toISOString(), root: repoRelative(census.root), counts: census.counts, admittedFraction: census.admittedFraction, refusalHistogram: census.refusalHistogram, bySubsection: census.bySubsection };
  await writeFileText(recordPath, `${JSON.stringify(record, null, 2)}\n`);
  await writeFileText(rowsPath, renderRowsTsv(census));
  return { recordPath, rowsPath, census };
}

if (isMain(import.meta.url)) {
  const options = parseCensusArgs(process.argv.slice(2));
  const { recordPath, rowsPath, census } = await runTermAdmissionCensus(options);
  process.stdout.write(`${renderCensusTable(census)}\n\nrecord: ${recordPath}\nrows:   ${rowsPath}\n`);
}
