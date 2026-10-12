// friction (term-engineering-services-section-node-import-migration, 2026-09-04): file-services
// only offers an async readFileText; this census's public contract (censusTermAdmissions,
// consumed synchronously by scripts/census-set-of-term-admissions.mjs and its tests) stays
// synchronous, so readFileSync is kept here for the per-term body read.
import { readFileSync } from "node:fs";
import { confinePath } from "@red-cup-engineering/filepath-services-section";
import { walkPosixPathsSync } from "@red-cup-engineering/filepath-services-section/walk-posix-paths";
import { recognizeTermMarkdown } from "./term-carrier.mjs";

const EXCLUDED_DIRECTORY_NAMES = ["legacy", "triage", "node_modules", "dist"];
const TERMS_SUFFIX_PATTERN = /(^|\/)content\/text\/glossary\/terms\/[^/]+$/u;

/**
 * Every glossary term Markdown carrier under `root`, excluding any path passing through a
 * legacy, triage, node_modules, or dist directory.
 * @param {string} root
 * @returns {string[]} absolute paths, sorted
 */
export function findGlossaryTermMarkdownPaths(root) {
  const walk = walkPosixPathsSync({ root, extensions: [".md"], excludes: EXCLUDED_DIRECTORY_NAMES });
  const found = walk.files
    .filter(({ kind, path }) => kind === "file" && TERMS_SUFFIX_PATTERN.test(path))
    .map(({ path }) => `${walk.root}/${path}`);
  return found.sort();
}

/**
 * The science subsection owning a term path: the first `services/<name>` segment beneath
 * `root`, or `"science-root"` for a term carried directly under the root section (matches the
 * subsection naming already used by the science-carrier-provenance census in this data/records/).
 * @param {string} root
 * @param {string} absolutePath
 * @returns {string}
 */
export function subsectionOf(root, absolutePath) {
  const parts = confinePath({ root, path: absolutePath }).relativePath.split("/");
  return parts[0] === "services" && parts[1] ? parts[1] : "science-root";
}

/**
 * Group a finding into one refusal-histogram bucket.
 * @param {{rule: string, message: string}} item
 * @returns {string}
 */
function refusalKey({ rule, message }) { return `${rule}: ${message}`; }

/**
 * Recognize every glossary term carrier under `root` through the admission path
 * (`recognizeTermMarkdown`) and account admitted/refused counts, a refusal-cause histogram, and
 * a per-subsection breakdown. A read or recognition failure on one term is its own refused row;
 * the census never throws on one term.
 * @param {string} root
 * @param {{limit?: number}} [options]
 * @returns {{root: string, counts: {total: number, admitted: number, refused: number}, admittedFraction: number|null, refusalHistogram: Record<string, number>, bySubsection: Record<string, {admitted: number, refused: number, total: number, admittedFraction: number|null}>, rows: Array<{relativePath: string, subsection: string, admitted: boolean, findings: Array<{rule: string, message: string}>}>}}
 */
export function censusTermAdmissions(root, { limit } = {}) {
  const allPaths = findGlossaryTermMarkdownPaths(root);
  const paths = typeof limit === "number" ? allPaths.slice(0, limit) : allPaths;
  const rows = [];
  const histogram = new Map();
  const bySubsection = new Map();
  for (const path of paths) {
    const filename = path.split("/").pop();
    const subsection = subsectionOf(root, path);
    let recognized;
    try {
      const text = readFileSync(path, "utf8");
      recognized = recognizeTermMarkdown({ text, filename });
    } catch (error) {
      recognized = { admitted: false, findings: [Object.freeze({ rule: "read", message: error.message })] };
    }
    const findings = recognized.findings ?? [];
    for (const item of findings) { const key = refusalKey(item); histogram.set(key, (histogram.get(key) ?? 0) + 1); }
    const relativePath = confinePath({ root, path }).relativePath;
    rows.push(Object.freeze({ relativePath, subsection, admitted: recognized.admitted === true, findings: Object.freeze(findings.map(({ rule, message }) => Object.freeze({ rule, message }))) }));
    const bucket = bySubsection.get(subsection) ?? { admitted: 0, refused: 0 };
    if (recognized.admitted) bucket.admitted += 1; else bucket.refused += 1;
    bySubsection.set(subsection, bucket);
  }
  const admitted = rows.filter((row) => row.admitted).length;
  const refused = rows.length - admitted;
  return Object.freeze({
    root,
    counts: Object.freeze({ total: rows.length, admitted, refused }),
    admittedFraction: rows.length === 0 ? null : admitted / rows.length,
    refusalHistogram: Object.freeze(Object.fromEntries([...histogram.entries()].sort((left, right) => right[1] - left[1]))),
    bySubsection: Object.freeze(Object.fromEntries(
      [...bySubsection.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([name, stats]) => [name, Object.freeze({
        admitted: stats.admitted,
        refused: stats.refused,
        total: stats.admitted + stats.refused,
        admittedFraction: stats.admitted + stats.refused === 0 ? null : stats.admitted / (stats.admitted + stats.refused),
      })]),
    )),
    rows: Object.freeze(rows),
  });
}
