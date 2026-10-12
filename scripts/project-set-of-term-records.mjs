#!/usr/bin/env node
import { readFileText } from "@red-cup-engineering/computer-file-engineering-services-section/read-file";
import { writeFileText } from "@red-cup-engineering/computer-file-engineering-services-section/write-file";
import { confinePath } from "@red-cup-engineering/computer-filepath-engineering-services-section/filepath";
import { argument } from "@red-cup-engineering/javascript-node-services-section/argv";
import { isMain } from "@red-cup-engineering/javascript-file-services-section/javascript-file-main-guard";
import { projectGlossaryIndex } from "../src/glossary-index.mjs";
import { findGlossaryTermMarkdownPaths } from "../src/glossary-index.mjs";

export { projectGlossaryIndex } from "../src/glossary-index.mjs";

/**
 * Parse `--root <dir> --out <file.json>`.
 * @param {string[]} argv
 * @returns {{root: string, out: string}}
 */
export function parseProjectSetOfTermRecordsArgs(argv) {
  const options = { root: argument("--root", argv), out: argument("--out", argv) };
  if (typeof options.root !== "string" || options.root === "") throw new TypeError("--root is required");
  if (typeof options.out !== "string" || options.out === "") throw new TypeError("--out is required");
  return options;
}

/**
 * Walk `root` for glossary term Markdown carriers (excluding legacy/triage/node_modules/dist),
 * read each through the house file-read service, project the glossary index, and write it as
 * 2-space JSON with a trailing newline to `out`.
 * @param {{root: string, out: string}} options
 * @returns {Promise<{root: string, out: string, index: ReturnType<typeof projectGlossaryIndex>}>}
 */
export async function projectSetOfTermRecords({ root, out }) {
  const absoluteRoot = confinePath({ root }).path;
  const paths = findGlossaryTermMarkdownPaths(absoluteRoot);
  const documents = [];
  for (const path of paths) {
    const text = await readFileText(path);
    const relativePath = confinePath({ root: absoluteRoot, path }).relativePath;
    documents.push({ path: relativePath, filename: relativePath.split("/").pop(), text });
  }
  const index = projectGlossaryIndex({ root: absoluteRoot, documents });
  await writeFileText(out, `${JSON.stringify(index, null, 2)}\n`);
  return { root: absoluteRoot, out, index };
}

if (isMain(import.meta.url)) {
  const options = parseProjectSetOfTermRecordsArgs(process.argv.slice(2));
  const { out, index } = await projectSetOfTermRecords(options);
  process.stdout.write(`records: ${index.records.length}  refused: ${index.refused.length}\nwrote: ${out}\n`);
}
