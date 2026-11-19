#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { admitTermMarkdown } from "../scripts/admit-term.mjs";
import { readTerm } from "../scripts/read-term.mjs";
import { recognizeTermMarkdown } from "../scripts/recognize-term.mjs";
import { renderTermMarkdown } from "../scripts/render-term.mjs";
import { writeSetOfTerms } from "../scripts/write-set-of-terms.mjs";
import { writeTerm } from "../scripts/write-term.mjs";

/** @returns {string} the usage block, one verb per line, each stating what it reads on stdin */
function usage() {
  return [
    "usage: term <render|read|recognize|admit|write|write-set> [path]",
    "",
    "  render      renders a term record to Markdown; reads a term record JSON object on stdin",
    "  read        reads one admitted term by path, given as argv[3]; reads nothing on stdin",
    "  recognize   parses a term Markdown carrier without admitting it; reads {text, filename} JSON on stdin",
    "  admit       recognizes and semantically admits a term Markdown carrier; reads {text, filename, authorizedRelationKeys} JSON on stdin",
    "  write       admits and durably writes one term carrier; reads a term write request JSON object on stdin",
    "  write-set   writes each term in an array of write requests, then derives one loss-accounted web; reads a JSON array on stdin",
    "",
    "  -h, --help  print this usage block and exit 0",
  ].join("\n");
}

const input = () => JSON.parse(readFileSync(0, "utf8"));
const command = process.argv[2];
if (command === undefined || command === "--help" || command === "-h") {
  process.stdout.write(`${usage()}\n`);
  process.exit(0);
}
let result;
switch (command) {
  case "render": result = renderTermMarkdown(input()); break;
  case "read": result = await readTerm(process.argv[3]); break;
  case "recognize": result = recognizeTermMarkdown(input()); break;
  case "admit": result = admitTermMarkdown(input()); break;
  case "write": result = await writeTerm(input()); break;
  case "write-set": {
    const written = await writeSetOfTerms(input());
    result = written;
    if (written.counts.refused > 0) process.exitCode = 1;
    break;
  }
  default:
    process.stderr.write(`${usage()}\n`);
    process.exit(2);
}
process.stdout.write(typeof result === "string" ? result : `${JSON.stringify(result, null, 2)}\n`);
