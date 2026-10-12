#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { writeFileText } from "@red-cup-engineering/computer-file-engineering-services-section/write-file";
import { migrateLegacyTermMarkdown } from "../src/term-carrier.mjs";

export async function migrateTermCarriers(paths, operations = {}) {
  const read = operations.read ?? readFileSync; const write = operations.write ?? writeFileText;
  const knownKeywordIdentities = new Set(paths.map((path) => basename(path, ".md")));
  const migrated = [];
  for (const path of paths) {
    const result = migrateLegacyTermMarkdown({ text: read(path, "utf8"), filename: basename(path), knownKeywordIdentities });
    await write(path, result.markdown);
    migrated.push(Object.freeze({ path, removedKeys: result.removedKeys }));
  }
  return Object.freeze({ count: migrated.length, migrated: Object.freeze(migrated) });
}
if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write(`${JSON.stringify(await migrateTermCarriers(process.argv.slice(2)))}\n`);
