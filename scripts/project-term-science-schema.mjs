#!/usr/bin/env node
import { projectTermScienceSchema } from "../src/term-science-schema.mjs";
export { projectTermScienceSchema } from "../src/term-science-schema.mjs";
if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write(`${JSON.stringify(await projectTermScienceSchema({ source: process.argv[2], destination: process.argv[3] }))}\n`);
