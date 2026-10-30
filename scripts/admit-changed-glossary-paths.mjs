#!/usr/bin/env node
/**
 * Admit changed glossary carriers through the original Term Engineering reader.
 * The input is Git's NUL-delimited changed file paths, not a second knowledge store.
 */
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { confinePath } from "@red-cup-engineering/computer-filepath-engineering-services-section/filepath";
import { recognizeTermMarkdown } from "../src/term-carrier.mjs";

const GLOSSARY = /(?:^|\/)content\/text\/glossary\/(?:terms|concepts|topics)\/[^/]+\.md$/u;
const EXCLUDED = new Set(["legacy", "triage", "node_modules", "dist", "test", "fixtures"]);
const eligible = path => GLOSSARY.test(path) && !path.split("/").some(part => EXCLUDED.has(part));
const finding = (path, issue) => Object.freeze({ path, rule: issue.rule, message: issue.message });

/** Source admission only: concept-target resolution belongs to the original glossary index. */
export function admitChangedGlossaryPaths({ root, paths, read = readFileSync } = {}) {
  if (typeof root !== "string" || root.trim() === "") throw new TypeError("root must be nonempty");
  if (!Array.isArray(paths) || paths.some(path => typeof path !== "string" || path === ""))
    throw new TypeError("paths must be nonempty source paths");
  const admitted = [], refused = [], skipped = [];
  for (const path of [...new Set(paths)].sort()) {
    if (!eligible(path)) { skipped.push(path); continue; }
    try {
      const absolute = confinePath({ root: resolve(root), path }).path;
      const observed = recognizeTermMarkdown({ text: read(absolute, "utf8"), filename: basename(path) });
      if (observed.admitted) admitted.push(path);
      else refused.push(...observed.findings.map(issue => finding(path, issue)));
    } catch (error) {
      refused.push(finding(path, { rule: "source-read", message: error instanceof Error ? error.message : String(error) }));
    }
  }
  return Object.freeze({ admitted: Object.freeze(admitted), refused: Object.freeze(refused), skipped: Object.freeze(skipped) });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const paths = readFileSync(0).toString("utf8").split("\0").filter(Boolean);
    const report = admitChangedGlossaryPaths({ root: process.argv[2] ?? ".", paths });
    process.stdout.write(JSON.stringify({
      kind: "term-engineering.changed-glossary-admission/v1",
      admitted: report.admitted, refused: report.refused, skippedCount: report.skipped.length,
    }, null, 2) + "\n");
    if (report.refused.length) process.exitCode = 1;
  } catch (error) {
    process.stderr.write("Glossary admission error: " + (error instanceof Error ? error.message : String(error)) + "\n");
    process.exitCode = 1;
  }
}
