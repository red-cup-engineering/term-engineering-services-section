#!/usr/bin/env node
import { admitTermMarkdown } from "./admit-term.mjs";
import { renderTermMarkdown } from "./render-term.mjs";
import { writeTerm } from "./write-term.mjs";
import { runJavascriptNodeOperation } from "@red-cup-engineering/javascript-node-services-section/operation";

/** Write each independently admitted term, accounting for every one refused. */
export async function writeSetOfTerms(requests, operations = {}) {
  if (!Array.isArray(requests) || requests.length === 0) throw new TypeError("a nonempty array of term write requests is required");
  const attempts = [];
  for (const request of requests) {
    const identity = request?.term?.filename ?? null;
    try {
      const authorizedRelationKeys = request.authorizedRelationKeys ?? [];
      const { filename, ...record } = request.term;
      const markdown = renderTermMarkdown(record, { authorizedRelationKeys });
      admitTermMarkdown({ text: markdown, filename: identity, authorizedRelationKeys });
      const written = await writeTerm(request, operations);
      attempts.push(Object.freeze({ identity, disposition: "written", path: written.path }));
    } catch (error) {
      attempts.push(Object.freeze({ identity, disposition: "refused", reason: error.message, findings: Object.freeze(error.findings ?? []) }));
    }
  }
  const written = attempts.filter(({ disposition }) => disposition === "written").length;
  return Object.freeze({
    disposition: written === requests.length ? "written" : written === 0 ? "refused" : "partially-written",
    counts: Object.freeze({ input: requests.length, written, refused: requests.length - written }),
    attempts: Object.freeze(attempts),
  });
}

if (import.meta.main) {
  const result = await runJavascriptNodeOperation({ name: "write-set-of-terms", description: "Write each independently admitted term, accounting for every one refused.", operation: writeSetOfTerms }, { arguments: process.argv.slice(2), standardInput: process.stdin, standardOutput: process.stdout });
  process.exitCode = result.exitCode;
}
