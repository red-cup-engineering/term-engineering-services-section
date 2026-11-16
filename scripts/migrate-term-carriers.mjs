#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { writeFileText } from "@red-cup-engineering/computer-file-engineering-services-section/write-file";
import { migrateLegacyTermMarkdown } from "../src/term-carrier.mjs";

export async function migrateTermCarriers(paths, operations = {}) {
  const read = operations.read ?? readFileSync; const write = operations.write ?? writeFileText;
  // A refusing carrier must not leave earlier files in a partially migrated batch.
  const planned = paths.map(path => {
    const source = read(path, "utf8");
    const result = migrateLegacyTermMarkdown({ text: source, filename: basename(path) });
    return { path, result, changed: result.markdown !== source };
  });
  for (const { path, result, changed } of planned) if (changed) await write(path, result.markdown);
  return Object.freeze({ count: planned.length, migrated: Object.freeze(planned.map(({ path, result, changed }) =>
    Object.freeze({ path, removedKeys: result.removedKeys, changed }))) });
}
if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write(`${JSON.stringify(await migrateTermCarriers(process.argv.slice(2)))}\n`);
