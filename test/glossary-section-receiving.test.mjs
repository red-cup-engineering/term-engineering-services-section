import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createGlossaryIndexReader, projectGlossaryIndex } from "@red-cup-engineering/term-engineering-services-section/glossary-index";
import { projectGlossarySkos } from "@red-cup-engineering/term-engineering-services-section/glossary-skos";
import { admitSemanticEvidence } from "@red-cup-engineering/term-engineering-services-section/term-operations";
import { observeTermRelations, readTermMarkdown, recognizeTermDocument, renderTermMarkdown }
  from "@red-cup-engineering/term-engineering-services-section/term-carrier";

const SOURCE = "content/text/glossary/concepts/structure.md";
const first = "services/philosophy-science-services-section/services/relationality-science-services-section";
const second = "services/social-science-services-section/services/sociology-science-services-section";
const note = (name) => ({ filename:"structure.md",path:SOURCE,text:`---\nidentity: structure\nname: ${name}\ntype: concept\ndescription: A distinct sense of structure.\n---\n\nA maintained source definition.\n` });

test("same sign in separately checked-out owners is distinct; mounting does not change its token",()=>{
  const inputs = [[first,note("Relational structure")],[second,note("Social structure")]];
  const detached = inputs.map(([sectionPath,doc])=>projectGlossaryIndex({root:"unrelated-workspace-name",sectionPath,documents:[doc]}));
  const aggregate = projectGlossaryIndex({root:"science-root",documents:inputs.map(([mount,doc])=>({...doc,path:mount+"/"+SOURCE}))});
  const records = detached.flatMap(i=>i.records);
  assert.equal(records.length,2);
  assert.equal(new Set(records.map(r=>r.token)).size,2);
  for (const record of records) {
    assert.equal(record.path,SOURCE);
    assert.equal(aggregate.records.find(r=>r.scheme===record.scheme).token,record.token);
  }
  const reader = createGlossaryIndexReader({...aggregate,records});
  assert.equal(reader.readings("structure").length,2);
  assert.throws(()=>reader.resolve("structure"),/ambiguous/);
  assert.equal(reader.resolve({identity:"structure",scheme:first}).name,"Relational structure");
  assert.equal(reader.resolve({identity:"structure",scheme:second}).name,"Social structure");
  const skos = projectGlossarySkos({...aggregate,records},{audience:"authenticated"});
  assert.equal(skos.accounting.concepts,2);
  assert.equal(new Set(skos["@graph"].filter(r=>r["dct:identifier"]).map(r=>r["@id"])).size,2);
});

test("refuse traversal, strings that name other repositories, and partial mount paths",()=>{
  for(const sectionPath of ["/services/science","services/../science","science","services/science/notes","services/science/","https://github.com/acme/science"]){
    assert.throws(()=>projectGlossaryIndex({root:"fixture",sectionPath,documents:[note("Structure")]}),/exact aggregate-relative/);
  }
});

test("structured provenance survives Term carrier and index without acquiring a concept identity", () => {
  const sources = ["https://example.org/authored", { path: "notes/unresolved-α.md", date: "2024-02-29" }];
  const input = note("Structure");
  const text = renderTermMarkdown({ identity: "structure", name: "Structure", body: "A source definition.",
    provenance: { sources } });
  assert.deepEqual(readTermMarkdown(text).frontmatter.provenance.sources, sources);
  const index = projectGlossaryIndex({ root: "fixture", sectionPath: first, documents: [{ ...input, text }] });
  assert.deepEqual(index.records[0].provenance.sources, sources);
  const skos = projectGlossarySkos(index, { audience: "authenticated" });
  assert.equal(skos.accounting.concepts, 1);
  assert.doesNotMatch(JSON.stringify(skos["@graph"]), /unresolved-α|2024-02-29/u);
  const body = "A definition. A distinction. A consequence.";
  const claims = { definition: "A definition.", distinction: "A distinction.", consequence: "A consequence." };
  assert.throws(() => admitSemanticEvidence({ sources, claims }, body), /semanticEvidence\.sources/u);
  assert.doesNotThrow(() => admitSemanticEvidence({ sources: [sources[0]], claims }, body));
});

test("shipped native index, SKOS and foam commands keep the verified detached mount",t=>{
  const dir=mkdtempSync(join(tmpdir(),"term-mount-"));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const source=join(dir,SOURCE);
  mkdirSync(dirname(source),{recursive:true});
  writeFileSync(source,note("Social structure").text);
  const index=join(dir,"native-index.json"),skos=join(dir,"native-skos.json");
  const run=(name,options)=>execFileSync(process.execPath,[fileURLToPath(new URL("../scripts/"+name,import.meta.url)),...options]);
  run("project-set-of-term-records.mjs",["--root",dir,"--section-path",second,"--out",index]);
  const native=JSON.parse(readFileSync(index));
  assert.equal(native.records[0].scheme,second);
  assert.equal(native.records[0].path,SOURCE);
  run("project-glossary-skos.mjs",["--root",dir,"--section-path",second,"--index",index,"--out",skos,"--audience","authenticated"]);
  const projected=JSON.parse(readFileSync(skos));
  assert.equal(projected.accounting.concepts,1);
  assert.match(projected["@graph"].find(r=>r["dct:identifier"])["@id"],/sociology-science-services-section\/structure$/u);
  const foam=join(dir,"native-foam.json");
  run("project-glossary-foam.mjs",["--root",dir,"--section-path",second,"--index",index,"--out",foam,"--audience","authenticated"]);
  const cut=JSON.parse(readFileSync(foam));
  assert.equal(cut.accounting.concepts,1);
  assert.equal(JSON.parse(readFileSync(index)).records[0].token,native.records[0].token);
});

test("the installed Term carrier shares original relation declarations with strict admission", () => {
  const input = note("Structure");
  const text = input.text.replace("type: concept\n", 'type: concept\nrequires: [" evidence-record ", question, question]\nautonomy: "  finite  operation  "\n');
  const parsed = readTermMarkdown(text);
  const record = projectGlossaryIndex({ root: "science-root", documents: [{ ...input, text }] }).records[0];
  assert.deepEqual(record.relations.requires, ["evidence-record", "question"]);
  const rows = observeTermRelations({ frontmatter: parsed.frontmatter, admittedRelations: record.relations });
  assert.deepEqual(rows, [
    { key: "requires", raw: " evidence-record ", placement: "frontmatter", range: "carrier", admittedValue: "evidence-record" },
    { key: "requires", raw: "question", placement: "frontmatter", range: "carrier", admittedValue: "question" },
    { key: "requires", raw: "question", placement: "frontmatter", range: "carrier", admittedValue: "question" },
    { key: "autonomy", raw: "  finite  operation  ", placement: "frontmatter", range: "literal", admittedValue: "finite operation" },
  ]);
  assert.equal(Object.isFrozen(rows), true);
  assert.ok(rows.every(Object.isFrozen));
});

test("refused relations retain both conflicting declarations and exact historical spellings", () => {
  const text = note("Structure").text.replace("type: concept\n", [
    "type: concept",
    "relations:",
    '  produces: "[[differential accumulation function]]"',
    '  folk-predicate: ["nested prose", 42]',
    "produces: evidence",
    "another-unknown-key: unrelated text",
    "",
  ].join("\n"));
  const parsed = readTermMarkdown(text);
  const refused = recognizeTermDocument({ ...parsed, filename: "structure.md" });
  assert.equal(refused.admitted, false);
  assert.ok(refused.findings.some(({ rule }) => rule === "relation-conflict"));
  assert.deepEqual(observeTermRelations({ frontmatter: parsed.frontmatter }), [
    { key: "produces", raw: "[[differential accumulation function]]", placement: "relations", range: "carrier", admittedValue: null },
    { key: "folk-predicate", raw: "nested prose", placement: "relations", range: null, admittedValue: null },
    { key: "produces", raw: "evidence", placement: "frontmatter", range: "carrier", admittedValue: null },
  ]);
});
