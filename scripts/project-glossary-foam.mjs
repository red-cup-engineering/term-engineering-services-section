#!/usr/bin/env node
import { writeFileText } from "@red-cup-engineering/computer-file-engineering-services-section/write-file";
import { isMain } from "@red-cup-engineering/javascript-file-engineering-services-section/javascript-file-main-guard";
import { projectSetOfTermRecords } from "./project-set-of-term-records.mjs";
import { projectGlossaryFoam } from "../src/glossary-foam.mjs";

/** The value after `flag` on a command line, or undefined. */
const argument = (flag, argv = process.argv.slice(2)) => { const at = argv.indexOf(flag); return at >= 0 && at + 1 < argv.length ? argv[at + 1] : undefined; };

/**
 * Parse `--root <dir> [--section-path <aggregate-relative mount>] --index <file.json> --out <file.json> [--audience public|authenticated]`.
 * @param {string[]} argv
 * @returns {{root: string, sectionPath: string, index: string, out: string, audience: string}}
 */
export function parseProjectGlossaryFoamArgs(argv) {
  const options = { root: argument("--root", argv), sectionPath: argument("--section-path", argv) ?? "", index: argument("--index", argv), out: argument("--out", argv), audience: argument("--audience", argv) ?? "public" };
  for (const flag of ["root", "index", "out"]) if (typeof options[flag] !== "string" || options[flag] === "") throw new TypeError(`--${flag} is required`);
  if (argv.includes("--section-path") && !options.sectionPath) throw new TypeError("--section-path requires a mount path");
  return options;
}

/**
 * Index every glossary carrier under `root` (written to `index`), then project the admitted
 * carriers `audience` may see as one semiotic foam of content-addressed tokens (written to `out`).
 * @param {ReturnType<typeof parseProjectGlossaryFoamArgs>} options
 */
export async function projectGlossaryFoamFromRoot({ root, sectionPath, index: indexOut, out, audience }) {
  const { index } = await projectSetOfTermRecords({ root, sectionPath, out: indexOut });
  const foam = projectGlossaryFoam(index, { audience });
  await writeFileText(out, `${JSON.stringify(foam, null, 1)}\n`);
  return { out, id: foam.foam.id, accounting: foam.accounting, wanted: foam.wanted.length, diagnostics: foam.diagnostics.length, obstructions: foam.obstructions.length, refused: index.refused.length, refusalDetails: index.refused };
}

if (isMain(import.meta.url)) {
  const { out, id, accounting, wanted, diagnostics, obstructions, refused, refusalDetails } = await projectGlossaryFoamFromRoot(parseProjectGlossaryFoamArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify({ foam: id, ...accounting, wantedSigns: wanted, diagnostics, obstructions, refusedCarriers: refused })}\nwrote: ${out}\n`);
  if (refused > 0) {
    for (const item of refusalDetails) process.stderr.write(`refused: ${JSON.stringify(item)}\n`);
    process.exitCode = 1;
  }
}
