/**
 * The source-authorized glossary foam is the producer: this is only its
 * witnessed SignGraph edges read as native SignCell claims. Never turn
 * terminology into an independently asserted RDF triple or a truth verdict.
 * The attached definition token is a witness that the carrier SAYS this,
 * not independent corroboration that the proposition holds.
 *
 * Actor and visibility admission must happen before a foam is supplied here.
 * This reader neither selects another actor nor opens a hidden corpus.
 */
import { querySignGraph } from "@red-cup-engineering/signgraph/semantic-graph";
import { createSignClaim, joinClaimsKnowledge } from "@red-cup-engineering/signcell/semantic-claim";
import { address, sectionReading } from "@red-cup-engineering/signcell/cell";
import { referenceOf } from "@red-cup-engineering/signcell/typed-mark";
import { glossaryConceptToken, glossaryConceptType } from "./glossary-token.mjs";

const reject = reason => { throw new TypeError("glossary claims: " + reason); };

/**
 * Query a genuine SignCell concept token within an already-projected
 * audience-admitted semiotic foam, optionally selecting a predicate.
 * Returns canonical source-witnessed claims (FOUR presence arises naturally
 * from the original evidence sides) and each original SignGraph EAVT edge.
 * Absence is not denial; no "against" is fabricated from wording or gaps.
 * There is no second statement store and no cloned relation evaluator.
 */
export function glossaryClaimsAt(foam, selector) {
  const record = selector && typeof selector === "object" && !Array.isArray(selector);
  const tokenMode = record && Object.hasOwn(selector, "token");
  if (!foam || foam.schema !== "computer-glossary-foam.v1" ||
      !["public", "authenticated"].includes(foam.audience) || !foam.foam ||
      !record || Reflect.ownKeys(selector).some(key => typeof key !== "string" ||
        !(tokenMode ? ["token", "predicate"] : ["scheme", "identity", "predicate"]).includes(key) ||
        !Object.hasOwn(Object.getOwnPropertyDescriptor(selector, key), "value")) ||
      (tokenMode
        ? typeof selector.token !== "string" ||
          !/^ni:\/\/\/sha-256;[A-Za-z0-9_-]{43}$/u.test(selector.token)
        : typeof selector.scheme !== "string" || typeof selector.identity !== "string") ||
      (selector.predicate !== undefined &&
        (typeof selector.predicate !== "string" || !selector.predicate)))
    reject("requires admitted foam and exactly one source concept: canonical NI token OR scheme/identity, optional predicate");
  // A source-generated concept NI returned by the original lexical search
  // must select an EXISTING typed mark from the supplied admitted SignGraph
  // cut. It is not reinterpreted as text, forged from a guessed scheme or
  // treated as a privacy/access token. Other typed cells may have valid NI
  // identities but cannot serve as glossary concept subjects.
  const selectedMark = tokenMode
    ? foam.foam.cells.find(mark => mark.id === selector.token &&
        mark.type === glossaryConceptType.id)
    : glossaryConceptToken(selector.scheme, selector.identity);
  if (!selectedMark) reject("concept token not present as a typed concept in this admitted source cut");
  const concept = referenceOf(selectedMark);
  // A local cut can contain boundary-reference tokens from other schemes.
  // Seeing such a typed endpoint does not mean its definitions were included;
  // never mistake an unprojected neighbor for a claim with no testimony.
  if (foam.localConcept && foam.localConcept.token !== concept.id)
    reject("concept outside the selected source cut; no absence claim is available");
  // The SignGraph original indexed reader owns the typed-membership and
  // predicate selection: a missing/foreign concept refuses, not empty truth.
  const edges = querySignGraph(foam.foam, concept,
    selector.predicate === undefined ? {} : { predicate: selector.predicate });
  const claims = new Map(), original = new Map();
  for (const { id, edge } of edges) {
    const admitted = createSignClaim({
      subject: edge.subject, predicate: edge.predicate, object: edge.object,
      for: [edge.witness], against: [],
    });
    if (!admitted.ok) reject("original SignGraph edge did not admit a SignCell claim");
    const key = address(admitted.value);
    const prior = claims.get(key);
    if (prior) {
      const joined = joinClaimsKnowledge(prior, admitted.value);
      if (!joined.ok) reject("original SignCell knowledge join refused");
      claims.set(key, joined.value);
    } else claims.set(key, admitted.value);
    const references = original.get(key) ?? [];
    references.push(Object.freeze({ edge: id, witness: edge.witness }));
    original.set(key, references);
  }
  const keys = [...claims.keys()].sort();
  const cells = Object.freeze(keys.map(key => claims.get(key)));
  return Object.freeze({
    kind: "computer-glossary-signcell-readings.v1",
    audience: foam.audience, graph: foam.foam.id, concept,
    cells, section: sectionReading(cells),
    sources: Object.freeze(keys.map(key => Object.freeze({
      claim: key, edges: Object.freeze(original.get(key)),
    }))),
    // These edges are SOURCE TELLINGS, not verified domain truths, proof
    // of kinematic realizability, an Actor knowledge grant, or a denial.
    sourceStatementsOnly: true, knowledgeTruthEstablished: false,
    relationToKinematicPointProved: false,
  });
}
