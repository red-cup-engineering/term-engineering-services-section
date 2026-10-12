import TERM_RECORD_SCHEMA from "./term.schema.json" with { type: "json" };

export { TERM_RECORD_SCHEMA };

const IDENTITY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const NI = /^ni:\/\/\/sha-256;[A-Za-z0-9_-]{43}$/u;
function nonempty(value, label) { if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${label} must be nonempty text`); }

/** Admit the exact executable projection of the term-science record contract. */
export function admitTermRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError("term record must be an object");
  const allowed = new Set(Object.keys(TERM_RECORD_SCHEMA.properties));
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new RangeError(`term record does not admit ${key}`);
  for (const key of TERM_RECORD_SCHEMA.required) if (!(key in value)) throw new TypeError(`term record requires ${key}`);
  if (!IDENTITY.test(value.identity)) throw new TypeError("identity must be a kebab-case carrier identity");
  nonempty(value.name, "name"); nonempty(value.body, "body");
  if (value.description !== undefined) nonempty(value.description, "description");
  if (value["consent-status"] !== undefined) nonempty(value["consent-status"], "consent-status");
  if (value.visibility !== undefined && !TERM_RECORD_SCHEMA.properties.visibility.enum.includes(value.visibility)) throw new TypeError(`visibility must be one of ${TERM_RECORD_SCHEMA.properties.visibility.enum.join(", ")}`);
  for (const key of ["type", "creator"]) if (value[key] !== undefined) nonempty(value[key], key);
  for (const key of ["aliases", "keywords"]) if (value[key] !== undefined) {
    if (!Array.isArray(value[key]) || new Set(value[key]).size !== value[key].length) throw new TypeError(`${key} must be a unique array`);
    for (const item of value[key]) nonempty(item, key.slice(0, -1));
  }
  if (value.keywords?.some((item) => !IDENTITY.test(item))) throw new TypeError("keywords must be carrier identities");
  if (value.relations !== undefined) {
    if (value.relations === null || typeof value.relations !== "object" || Array.isArray(value.relations)) throw new TypeError("relations must be an object");
    for (const [predicate, assertion] of Object.entries(value.relations)) {
      if (!IDENTITY.test(predicate)) throw new TypeError(`invalid relation predicate ${predicate}`);
      const assertions = Array.isArray(assertion) ? assertion : [assertion];
      if (assertions.length === 0 || new Set(assertions).size !== assertions.length) throw new TypeError(`relation ${predicate} must contain unique assertions`);
      for (const item of assertions) nonempty(item, `relation ${predicate}`);
    }
  }
  if (value.references !== undefined) {
    if (value.references === null || typeof value.references !== "object" || Array.isArray(value.references)) throw new TypeError("references must be an object");
    const referenceKeys = new Set(Object.keys(TERM_RECORD_SCHEMA.properties.references.additionalProperties.properties));
    for (const [citekey, reference] of Object.entries(value.references)) {
      if (!/^[a-z][a-z0-9-]*[0-9]{4}[a-z0-9-]*$/u.test(citekey)) throw new TypeError(`invalid citekey ${citekey}`);
      for (const key of ["authors", "title", "year"]) if (!(key in reference)) throw new TypeError(`reference ${citekey} requires ${key}`);
      if (!Array.isArray(reference.authors) || reference.authors.length === 0) throw new TypeError(`reference ${citekey} authors must be nonempty`);
      for (const author of reference.authors) nonempty(author, "reference author");
      nonempty(reference.title, "reference title");
      if (!Number.isInteger(reference.year) || reference.year < 1) throw new TypeError(`reference ${citekey} year must be positive`);
      for (const key of Object.keys(reference)) if (!referenceKeys.has(key)) throw new RangeError(`reference ${citekey} does not admit ${key}`);
      for (const key of ["publication", "publisher", "url", "doi", "note", "eprint", "volume", "issue", "pages", "edition"]) if (reference[key] !== undefined) nonempty(String(reference[key]), `reference ${key}`);
      if (reference.url !== undefined) { try { new URL(reference.url); } catch { throw new TypeError(`reference ${citekey} url must be a URI`); } }
    }
  }
  if (value.provenance !== undefined) {
    if (value.provenance === null || typeof value.provenance !== "object" || Array.isArray(value.provenance)) throw new TypeError("provenance must be an object");
    for (const key of Object.keys(value.provenance)) if (!Object.hasOwn(TERM_RECORD_SCHEMA.properties.provenance.properties, key)) throw new RangeError(`provenance does not admit ${key}`);
    for (const key of ["date-created", "date-modified", "date-updated"]) if (value.provenance[key] !== undefined && !DATE.test(value.provenance[key])) throw new TypeError(`${key} must be a date`);
    for (const key of ["sources", "authors", "tags", "utterances"]) if (value.provenance[key] !== undefined) {
      if (!Array.isArray(value.provenance[key]) || new Set(value.provenance[key]).size !== value.provenance[key].length) throw new TypeError(`provenance ${key} must be a unique array`);
      for (const item of value.provenance[key]) nonempty(item, `provenance ${key}`);
    }
    if (value.provenance.utterances?.some((item) => !NI.test(item))) throw new TypeError("provenance utterances must be ni:///sha-256 content addresses");
    for (const key of ["id", "domain", "scheme", "status"]) if (value.provenance[key] !== undefined) nonempty(value.provenance[key], `provenance ${key}`);
  }
  if (value["status-function"] !== undefined) {
    const statusFunction = value["status-function"];
    if (statusFunction === null || typeof statusFunction !== "object" || Array.isArray(statusFunction)) throw new TypeError("status-function must be an object");
    for (const key of Object.keys(statusFunction)) if (!Object.hasOwn(TERM_RECORD_SCHEMA.properties["status-function"].properties, key)) throw new RangeError(`status-function does not admit ${key}`);
    if (statusFunction.params !== undefined && (statusFunction.params === null || typeof statusFunction.params !== "object" || Array.isArray(statusFunction.params))) throw new TypeError("status-function params must be an object");
  }
  return Object.freeze(value);
}
