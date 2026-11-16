import assert from "node:assert/strict";
import test from "node:test";
import { migrateLegacyTermMarkdown, readTermMarkdown } from "../src/term-carrier.mjs";
import { migrateTermCarriers } from "../scripts/migrate-term-carriers.mjs";

const source = "\uFEFF---\r\ntitle: Sample # source comment\r\nkeywords: [retrieval-key, elsewhere]\r\nsee-also: another\r\nvisibility: authenticated\r\n---\r\n\r\nAn authored note.  \r\n";
const filename = "sample.md";

test("a supported rename preserves authored metadata, comment, CRLF and body regardless of selected keywords", () => {
  const first = migrateLegacyTermMarkdown({ text: source, filename, knownKeywordIdentities: new Set(["sample"]) });
  const second = migrateLegacyTermMarkdown({ text: source, filename, knownKeywordIdentities: new Set(["sample", "retrieval-key", "elsewhere"]) });
  assert.equal(first.markdown, source.replace("title:", "name:"));
  assert.equal(second.markdown, first.markdown);
  assert.deepEqual(readTermMarkdown(first.markdown).frontmatter.keywords, ["retrieval-key", "elsewhere"]);
  assert.deepEqual(first.record.relations["see-also"], "another");
  assert.equal(first.record.visibility, "authenticated");
  assert.equal(migrateLegacyTermMarkdown({ text: first.markdown, filename }).markdown, first.markdown);
});

test("authorship, ownership and source metadata refuse migration before any batch write", async () => {
  const ambiguous = source.replace("keywords:", "science-owner: science\r\nauthor: a-researcher\r\nsources: ['https://example.org/witness']\r\nkeywords:");
  const files = new Map([["first/sample.md", source], ["second/sample.md", ambiguous]]);
  let writes = 0;
  await assert.rejects(migrateTermCarriers([...files.keys()], { read: path => files.get(path), write: () => writes++ }), e => {
    assert.equal(e.code, "ERR_TERM_MIGRATION_REFUSED");
    for (const name of ["science-owner", "author", "sources"])assert.ok(e.findings.some(f => f.message.endsWith(name)));
    return true;
  });
  assert.equal(writes, 0);
  assert.equal(files.get("second/sample.md"), ambiguous);
});
