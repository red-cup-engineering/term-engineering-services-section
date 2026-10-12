import { readFileText } from "@red-cup-engineering/file-services/read-file";
import { confinePath } from "@red-cup-engineering/filepath-services-section";
import bundledLedger from "../data/records/2026-09-04-predicate-identifications.json" with { type: "json" };

const LEDGER_RELATIVE_PATH = "data/records/2026-09-04-predicate-identifications.json";

/**
 * Read the predicate-identification ledger (kind "predicate-identification-ledger") seeded from
 * the authorized relation predicates the term contract already implies are basically or exactly
 * one another. Without a `root`, the ledger bundled into this package at publish time is
 * returned directly, so consumers bundled by esbuild or similar never need a runtime file read
 * or package resolution against this package's install location. With a `root`, the ledger is
 * read from that filesystem location instead (a caller inspecting another checkout's ledger).
 * @param {{root?: string}} [options]
 * @returns {Promise<{type: string, date: string, declarations: {a: string, kind: "mld"|"equal", b: string, carrier: string}[]}>}
 */
export async function readPredicateIdentifications({ root } = {}) {
  if (root === undefined) {
    return bundledLedger;
  }
  const { path } = confinePath({ root, path: LEDGER_RELATIVE_PATH });
  const text = await readFileText(path);
  const ledger = JSON.parse(text);
  if (ledger?.type !== "predicate-identification-ledger" || !Array.isArray(ledger.declarations)) {
    throw new TypeError("predicate-identification ledger is malformed");
  }
  return ledger;
}
