#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { writeTerm } from "../src/term-operations.mjs";
export { writeTerm } from "../src/term-operations.mjs";
if (import.meta.url === `file://${process.argv[1]}`) {
  try { process.stdout.write(`${JSON.stringify(await writeTerm(JSON.parse(readFileSync(0, "utf8"))), null, 2)}\n`); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
