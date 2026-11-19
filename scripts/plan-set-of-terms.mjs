#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyMarkdownCorpusPath, planMarkdownCorpusCleanup } from "../src/term-migration.mjs";

function gitPaths(root, args) {
  const output = execFileSync("git", [...args, "-z", "--", "*.md"], { cwd: root, encoding: "utf8", maxBuffer: 1024 * 1024 * 256 });
  return output.split("\0").filter(Boolean);
}

/** Read the bounded repository Markdown inventory without changing it. */
export function readMarkdownCorpus(root = process.cwd()) {
  const repositoryRoot = resolve(root);
  const ignored = new Set(gitPaths(repositoryRoot, ["ls-files", "--cached", "--ignored", "--exclude-standard"]));
  const paths = gitPaths(repositoryRoot, ["ls-files", "--cached", "--others", "--exclude-standard"]);
  const documents = [];
  for (const relativePath of paths) {
    const ignoredPath = ignored.has(relativePath);
    const classification = classifyMarkdownCorpusPath(relativePath, { ignored: ignoredPath });
    if (!classification.included) {
      documents.push(Object.freeze({ relativePath, ignored: ignoredPath }));
      continue;
    }
    try {
      documents.push(Object.freeze({ relativePath, text: readFileSync(resolve(repositoryRoot, relativePath), "utf8") }));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return Object.freeze(documents);
}

/** Read the repository's source Markdown set and return a dry cleanup plan. */
export function planSetOfTerms(root = process.cwd()) {
  return planMarkdownCorpusCleanup(readMarkdownCorpus(root));
}

if (resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? "")) {
  const root = process.argv[2] ?? process.cwd();
  process.stdout.write(`${JSON.stringify(planSetOfTerms(root), null, 2)}\n`);
}
