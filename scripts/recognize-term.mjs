#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { recognizeTermMarkdown } from "../src/term-carrier.mjs";
export { recognizeTermMarkdown } from "../src/term-carrier.mjs";
if (import.meta.url === `file://${process.argv[1]}`) {
  const input = JSON.parse(readFileSync(0, "utf8")); process.stdout.write(`${JSON.stringify(recognizeTermMarkdown(input), null, 2)}\n`);
}
