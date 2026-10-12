import assert from "node:assert/strict";
import test from "node:test";
import { pricePredicateIdentification } from "../scripts/price-predicate-identification.mjs";
const declarations = [{ a: "part-of", kind: "mld", b: "component-of" }, { a: "component-of", kind: "equal", b: "constituent-of" }, { a: "cites", kind: "equal", b: "references" }];
test("prices a mixed chain as mld with added prices", () => {
  const out = pricePredicateIdentification({ declarations, from: "part-of", to: "constituent-of" });
  assert.equal(out.price, 3);
  assert.equal(out.kind, "mld");
  assert.equal(out.path.length, 2);
});
test("prices an all-equal chain as equal and is symmetric", () => {
  assert.deepEqual(pricePredicateIdentification({ declarations, from: "references", to: "cites" }), { type: "PredicateIdentificationPrice", from: "references", to: "cites", path: [{ a: "references", kind: "equal", b: "cites" }], price: 2, kind: "equal" });
});
test("a predicate reaches itself at price 0 as equal, and an unrelated one is unreachable", () => {
  assert.equal(pricePredicateIdentification({ declarations, from: "cites", to: "cites" }).price, 0);
  const none = pricePredicateIdentification({ declarations, from: "cites", to: "part-of" });
  assert.equal(none.price, null); assert.equal(none.path, null); assert.equal(none.kind, null);
});
test("refuses an unknown kind", () => assert.throws(() => pricePredicateIdentification({ declarations: [{ a: "x", kind: "same", b: "y" }], from: "x", to: "y" }), /kind of mld or equal/u));
