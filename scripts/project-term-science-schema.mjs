#!/usr/bin/env node
import { projectTermAdmissionSchema, projectTermScienceSchema } from "../src/term-science-schema.mjs";
export { projectTermAdmissionSchema, projectTermScienceSchema } from "../src/term-science-schema.mjs";

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const result = args[0] === "--admission"
    ? await projectTermAdmissionSchema({ source: args[1], vocabulary: args[2], destination: args[3] })
    : await projectTermScienceSchema({ source: args[0], destination: args[1] });
  process.stdout.write(`${JSON.stringify({ ...result, bytes: undefined })}\n`);
}
