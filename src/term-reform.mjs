/**
 * Reforming a document into a glossary term: the term form's transform, owned here with the carrier it produces.
 * A document placed as a term arrives as someone else's Markdown (a byte-order mark, an inline JSON metadata line, a legacy
 * `title` key); the term that stands in the glossary is the carrier this package admits. The transform repairs only what is
 * unambiguous and refuses the rest, naming the findings; it never invents a definition.
 */
import { operation } from "@red-cup-engineering/computer-engine/rpc/operation";
import { schemaFrom } from "@red-cup-engineering/json-schema-engineering-services-section/contracts";
import { migrateLegacyTermMarkdown } from "./term-carrier.mjs";

/** A source's text as a document: one line ending, one final newline, no byte-order mark, an inline JSON metadata object expanded into the YAML lines it stands for. */
export function normalizeTermSource(source) {
  let text = source.replace(/\r\n?/gu, "\n").trimEnd() + "\n";
  if (text.startsWith("﻿")) text = text.slice(1);
  if (!text.startsWith("---\n")) return text;
  const close = text.indexOf("\n---", 4);
  if (close < 0) return text;
  const lines = [];
  for (const line of text.slice(4, close).split("\n")) {
    if (!/^\{.*\}$/u.test(line.trim())) { lines.push(line); continue; }
    try {
      const value = JSON.parse(line);
      if (!value || Array.isArray(value) || typeof value !== "object") throw new Error("not an object");
      lines.push(...Object.entries(value).map(([key, item]) => `${key}: ${JSON.stringify(item)}`));
    } catch { lines.push(line); }
  }
  return `---\n${lines.join("\n")}${text.slice(close)}`;
}

/** The term carrier a document becomes, with the name it is filed under; refuses what is not unambiguously one. */
export function reformTermMarkdown({ text, filename }) {
  const migrated = migrateLegacyTermMarkdown({ text: normalizeTermSource(text), filename });
  return Object.freeze({ markdown: migrated.markdown, identity: migrated.record.identity, removedKeys: migrated.removedKeys, changed: migrated.markdown !== text });
}

export const reformTermMarkdownOperation = operation({
  verb: "reform-term-markdown",
  summary: "Make a document the glossary term it says it is: repair its source text and migrate its legacy metadata to the term carrier.",
  description: "Normalizes line endings, the byte-order mark and inline JSON metadata, then migrates a legacy title key to the carrier's name key; a document the carrier already admits is returned as it is. Refusals: metadata the migration cannot rename without changing anything else, unknown keys, a schema finding the migration does not repair. The refusal names each finding.",
  domain: schemaFrom({ $id: "term/reform-term-markdown/input", type: "object", additionalProperties: false, required: ["text", "filename"], properties: { text: { type: "string" }, filename: { type: "string", pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*\\.md$" } } }),
  codomain: schemaFrom({ $id: "term/reform-term-markdown/output", type: "object", required: ["markdown", "identity", "changed"], properties: { markdown: { type: "string" }, identity: { type: "string" }, removedKeys: { type: "array", items: { type: "string" } }, changed: { type: "boolean" } } }),
  effects: { class: "host-read", replay: "safe", coordination: "coordination-free", deterministic: true, totality: "partial" },
  run: reformTermMarkdown,
});
