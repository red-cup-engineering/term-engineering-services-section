import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath as projectFileUrlFilepath } from "node:url";
import { readPredicateIdentifications } from "../src/predicate-identifications.mjs";
import { pricePredicateIdentificationInLedger } from "../scripts/price-predicate-identification-in-ledger.mjs";
import RELATION_PREDICATES from "../data/records/schema/glossary/term/relation-predicates.json" with { type: "json" };

const ROOT = projectFileUrlFilepath(new URL("..", import.meta.url).href).replace(/\/$/u, "");

test("the ledger seeds exactly the part-of/component-of mld identification the authorized predicate list supports", async () => {
  const ledger = await readPredicateIdentifications({ root: ROOT });
  assert.equal(ledger.type, "predicate-identification-ledger");
  assert.equal(ledger.declarations.length, 1);
  const [declaration] = ledger.declarations;
  assert.equal(declaration.a, "part-of");
  assert.equal(declaration.kind, "mld");
  assert.equal(declaration.b, "component-of");
  assert.equal(typeof declaration.carrier, "string");
});

test("the ledger reads the bundled seeded declaration when called with no root, for consumers bundled without a filesystem", async () => {
  const ledger = await readPredicateIdentifications();
  assert.equal(ledger.type, "predicate-identification-ledger");
  assert.equal(ledger.declarations.length, 1);
  const [declaration] = ledger.declarations;
  assert.equal(declaration.a, "part-of");
  assert.equal(declaration.kind, "mld");
  assert.equal(declaration.b, "component-of");
  assert.equal(typeof declaration.carrier, "string");
});

test("every declared predicate name is authorized by the term contract's relation-predicates list", async () => {
  const ledger = await readPredicateIdentifications({ root: ROOT });
  for (const { a, b } of ledger.declarations) {
    assert.equal(a in RELATION_PREDICATES, true, a);
    assert.equal(b in RELATION_PREDICATES, true, b);
  }
});

test("the ledger never identifies see-also with anything, and cites is never identified with references (references is not an authorized relation predicate)", async () => {
  const ledger = await readPredicateIdentifications({ root: ROOT });
  for (const { a, b } of ledger.declarations) {
    assert.notEqual(a, "see-also");
    assert.notEqual(b, "see-also");
  }
  assert.equal("references" in RELATION_PREDICATES, false);
});

test("pricing part-of to component-of through the ledger prices as mld at 1", async () => {
  const price = await pricePredicateIdentificationInLedger({ root: ROOT, from: "part-of", to: "component-of" });
  assert.equal(price.price, 1);
  assert.equal(price.kind, "mld");
  assert.equal(price.type, "PredicateIdentificationPrice");
});

test("pricing an unrelated pair through the ledger is unreachable", async () => {
  const price = await pricePredicateIdentificationInLedger({ root: ROOT, from: "cites", to: "see-also" });
  assert.equal(price.price, null);
  assert.equal(price.path, null);
  assert.equal(price.kind, null);
});
