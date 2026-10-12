#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { admitTermMarkdown } from "../src/term-carrier.mjs";
export { admitTermMarkdown } from "../src/term-carrier.mjs";
if (import.meta.url === `file://${process.argv[1]}`) {
  try { process.stdout.write(`${JSON.stringify(admitTermMarkdown(JSON.parse(readFileSync(0, "utf8"))), null, 2)}\n`); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
