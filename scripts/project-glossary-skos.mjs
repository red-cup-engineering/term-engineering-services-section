#!/usr/bin/env node
import { writeFileText } from "@red-cup-engineering/computer-file-engineering-services-section/write-file";
import { argument } from "@red-cup-engineering/javascript-node-services-section/argv";
import { isMain } from "@red-cup-engineering/javascript-file-services-section/javascript-file-main-guard";
import { projectSetOfTermRecords } from "./project-set-of-term-records.mjs";
import { DEFAULT_KNOWLEDGE_BASE, projectGlossarySkos } from "../src/glossary-skos.mjs";

/**
 * Parse `--root <dir> --index <file.json> --out <file.jsonld> [--base <iri/>] [--audience public|authenticated]`.
 * @param {string[]} argv
 * @returns {{root: string, index: string, out: string, base: string, audience: string}}
 */
export function parseProjectGlossarySkosArgs(argv) {
  const options = { root: argument("--root", argv), index: argument("--index", argv), out: argument("--out", argv), base: argument("--base", argv) ?? DEFAULT_KNOWLEDGE_BASE, audience: argument("--audience", argv) ?? "public" };
  for (const flag of ["root", "index", "out"]) if (typeof options[flag] !== "string" || options[flag] === "") throw new TypeError(`--${flag} is required`);
  return options;
}

/**
 * Index every glossary term under `root` (written to `index`), then project the admitted terms
 * `audience` may see as one SKOS vocabulary in JSON-LD (written to `out`).
 * @param {ReturnType<typeof parseProjectGlossarySkosArgs>} options
 */
export async function projectGlossarySkosFromRoot({ root, index: indexOut, out, base, audience }) {
  const { index } = await projectSetOfTermRecords({ root, out: indexOut });
  const skos = projectGlossarySkos(index, { base, audience });
  await writeFileText(out, `${JSON.stringify(skos, null, 1)}\n`);
  return { out, accounting: skos.accounting, refused: index.refused.length };
}

if (isMain(import.meta.url)) {
  const { out, accounting, refused } = await projectGlossarySkosFromRoot(parseProjectGlossarySkosArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify({ ...accounting, refusedCarriers: refused })}\nwrote: ${out}\n`);
}
