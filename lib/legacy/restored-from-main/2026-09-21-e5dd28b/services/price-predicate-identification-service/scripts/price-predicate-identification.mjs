#!/usr/bin/env node
import { runJavascriptNodeOperation } from "../../../../../../../../../../computer-code-engineering-services-section/services/javascript-engineering-services-section/services/javascript-node-services-section/src/operation.mjs";
const PRICE = Object.freeze({ mld: 1, equal: 2 });

/**
 * Prices the cheapest chain of mld or equal declarations identifying one predicate with another.
 * @param {object} request A record with declarations ([{a, kind, b}]), from, and to.
 * @returns {object} A PredicateIdentificationPrice record with path, price, and kind (null when unreachable).
 * @throws {TypeError} When from, to, or declarations are malformed or a declaration kind is unknown.
 */
export function pricePredicateIdentification(request) {
  if (typeof request?.from !== "string" || request.from.length === 0 || typeof request?.to !== "string" || request.to.length === 0 || !Array.isArray(request?.declarations)) {
    throw new TypeError("from, to, and declarations are required");
  }
  const edges = new Map();
  const add = (a, kind, b) => { if (!edges.has(a)) edges.set(a, []); edges.get(a).push({ to: b, kind }); };
  for (const declaration of request.declarations) {
    if (typeof declaration?.a !== "string" || typeof declaration?.b !== "string" || PRICE[declaration?.kind] === undefined) throw new TypeError("a declaration needs a, b, and a kind of mld or equal");
    add(declaration.a, declaration.kind, declaration.b);
    add(declaration.b, declaration.kind, declaration.a);
  }
  const best = new Map([[request.from, { price: 0, path: [], allEqual: true }]]);
  const queue = [request.from];
  while (queue.length > 0) {
    queue.sort((x, y) => best.get(x).price - best.get(y).price);
    const current = queue.shift();
    const state = best.get(current);
    for (const edge of edges.get(current) ?? []) {
      const price = state.price + PRICE[edge.kind];
      const known = best.get(edge.to);
      if (known === undefined || price < known.price) {
        best.set(edge.to, { price, path: [...state.path, { a: current, kind: edge.kind, b: edge.to }], allEqual: state.allEqual && edge.kind === "equal" });
        queue.push(edge.to);
      }
    }
  }
  const found = best.get(request.to);
  return {
    type: "PredicateIdentificationPrice",
    from: request.from,
    to: request.to,
    path: found === undefined ? null : found.path,
    price: found === undefined ? null : found.price,
    kind: found === undefined ? null : (found.allEqual ? "equal" : "mld"),
  };
}

if (import.meta.main) {
  const result = await runJavascriptNodeOperation({ name: "price-predicate-identification", description: "Prices the cheapest chain of mld or equal declarations identifying one predicate with another.", operation: pricePredicateIdentification }, { arguments: process.argv.slice(2), standardInput: process.stdin, standardOutput: process.stdout });
  process.exitCode = result.exitCode;
}
