import { readFileSync } from "node:fs";
import { writeFileText } from "@red-cup-engineering/computer-file-engineering-services-section/write-file";

export async function projectTermScienceSchema({ source, destination }, operations = {}) {
  if (typeof source !== "string" || typeof destination !== "string") throw new TypeError("source and destination are required");
  const schema = JSON.parse((operations.read ?? readFileSync)(source, "utf8"));
  if (schema?.$id !== "glossary/terms/term") throw new TypeError("source is not the canonical term-science schema");
  const bytes = `${JSON.stringify(schema, null, 2)}\n`;
  await (operations.write ?? writeFileText)(destination, bytes);
  return Object.freeze({ source, destination, bytes });
}

/**
 * Term Science owns the broader community term record and its original
 * `glossary/terms/term` identity. Engineering admits a bounded subset.
 * The engineered schema must have a *different* $id: identical identifiers
 * for different admission predicates make downstream JSON Schema equivocal.
 * Both source documents are explicit inputs; there is no hidden filesystem,
 * registry, network call or second manually maintained term vocabulary.
 */
export const TERM_ADMISSION_SCHEMA_ID = "https://561.group/ns/term-engineering/admitted-term/v1";
const ADMISSION_TITLE = "Engineering-admitted glossary term";
const ADMISSION_DESCRIPTION = "A bounded Engineering admission profile derived from the Science term record: the same source fields and assertion values, with a closed carrier field set and only source-declared relation predicates. This profile is not the scientific source type.";
const ADMISSION_RELATION_DESCRIPTION = "An Engineering admission of Science term relations: the only legal keys are original source-owned relation predicates, whose ranges are declared as carrier or literal in relation-predicates.json.";

export function deriveTermAdmissionSchema(scienceSchema, relationVocabulary) {
  if (scienceSchema?.$schema !== "https://json-schema.org/draft/2020-12/schema"
      || scienceSchema.$id !== "glossary/terms/term"
      || scienceSchema.type !== "object"
      || scienceSchema.additionalProperties !== true
      || !scienceSchema.properties?.relations?.propertyNames) {
    throw new TypeError("the original Science term schema must be explicitly selected and admitted");
  }
  if (!relationVocabulary || typeof relationVocabulary !== "object" || Array.isArray(relationVocabulary)) {
    throw new TypeError("the original typed relation vocabulary is required");
  }
  const predicates = Object.entries(relationVocabulary);
  if (!predicates.length || predicates.some(([key, spec]) =>
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(key)
      || !spec || (spec.range !== "carrier" && spec.range !== "literal"))) {
    throw new TypeError("each original relation predicate must have a valid name and declared carrier/literal range");
  }
  const schema = JSON.parse(JSON.stringify(scienceSchema));
  schema.$id = TERM_ADMISSION_SCHEMA_ID;
  schema.title = ADMISSION_TITLE;
  schema.description = ADMISSION_DESCRIPTION;
  schema.additionalProperties = false;
  // The original Science identity pattern also constrains Engineering's carrier-range
  // relation objects. Before this, an admitted "composed-of: Actor + Character"
  // could never resolve to any glossary concept and simply disappeared from the graph.
  // Keep literal-range predicates as plain strings; do not make them fake concept links.
  const carrierPattern = scienceSchema.properties.identity?.pattern;
  if (typeof carrierPattern !== "string" || carrierPattern.length === 0) {
    throw new TypeError("the original Science carrier identity pattern is required");
  }
  const relationValues = (spec) => {
    const target = spec.range === "carrier"
      ? { type: "string", pattern: carrierPattern }
      : { type: "string", minLength: 1 };
    return {
      oneOf: [
        { ...target },
        { type: "array", minItems: 1, uniqueItems: true, items: { ...target } },
      ],
    };
  };
  schema.properties.relations.propertyNames.enum = predicates.map(([name]) => name);
  schema.properties.relations.properties = Object.fromEntries(
    predicates.map(([name, spec]) => [name, relationValues(spec)]),
  );
  schema.properties.relations.additionalProperties = false;
  schema.properties.relations.description = ADMISSION_RELATION_DESCRIPTION;
  return Object.freeze(schema);
}

/** Project the independent Engineering admission profile from exact caller-selected
 * Science schema and original predicate vocabulary source bytes. The caller is
 * responsible for qualifying both authoritative source revisions beforehand. */
export async function projectTermAdmissionSchema({ source, vocabulary, destination }, operations = {}) {
  if (![source, vocabulary, destination].every((item) => typeof item === "string" && item.length > 0)) {
    throw new TypeError("source, vocabulary and destination are required");
  }
  const read = operations.read ?? readFileSync;
  const science = JSON.parse(read(source, "utf8"));
  const predicates = JSON.parse(read(vocabulary, "utf8"));
  const schema = deriveTermAdmissionSchema(science, predicates);
  const bytes = `${JSON.stringify(schema, null, 2)}\n`;
  await (operations.write ?? writeFileText)(destination, bytes);
  return Object.freeze({ source, vocabulary, destination, bytes });
}
