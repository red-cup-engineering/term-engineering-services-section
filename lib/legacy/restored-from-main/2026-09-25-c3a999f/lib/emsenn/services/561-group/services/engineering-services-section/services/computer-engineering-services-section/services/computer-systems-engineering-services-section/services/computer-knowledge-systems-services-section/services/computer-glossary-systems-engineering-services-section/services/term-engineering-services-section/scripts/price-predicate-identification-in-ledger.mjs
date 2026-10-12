#!/usr/bin/env node
import { pricePredicateIdentification } from "@red-cup-engineering/term-engineering-services-section/price-predicate-identification";
import { isMain } from "@red-cup-engineering/javascript-file-services-section/javascript-file-main-guard";
import { readPredicateIdentifications } from "../src/predicate-identifications.mjs";

/**
 * Price the cheapest chain identifying one authorized relation predicate with another, read
 * from the term contract's predicate-identification ledger.
 * @param {{root: string, from: string, to: string}} request
 * @returns {Promise<object>} A PredicateIdentificationPrice record (see
 *   @red-cup-engineering/price-predicate-identification-service), path/price/kind null when
 *   unreachable.
 */
export async function pricePredicateIdentificationInLedger({ root, from, to } = {}) {
  const ledger = await readPredicateIdentifications({ root });
  return pricePredicateIdentification({ declarations: ledger.declarations, from, to });
}

if (isMain(import.meta.url)) {
  const [root, from, to] = process.argv.slice(2);
  const price = await pricePredicateIdentificationInLedger({ root, from, to });
  process.stdout.write(`${JSON.stringify(price, null, 2)}\n`);
  if (price.price === null) process.exitCode = 2;
}
