#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { renderTermMarkdown } from "../src/term-carrier.mjs";
export { renderTermMarkdown } from "../src/term-carrier.mjs";
if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write(renderTermMarkdown(JSON.parse(readFileSync(0, "utf8"))));
