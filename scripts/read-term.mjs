#!/usr/bin/env node
import { readTerm } from "../src/term-operations.mjs";
export { readTerm } from "../src/term-operations.mjs";
if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write(`${JSON.stringify(await readTerm(process.argv[2]), null, 2)}\n`);
