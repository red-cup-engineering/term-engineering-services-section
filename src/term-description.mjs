const COMPOUND_POSITION = /\b(?:constituent|component|word)\s+of\b|\bin\s+the\s+(?:phrase|acronym)\b/iu;

/** Admit an independently useful concise description without imposing a sentence count. */
export function admitTermDescription(value) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError("description must be nonempty text");
  const text = value.replace(/\r\n?/gu, "\n").trim().replace(/[\t ]+/gu, " ");
  if (text.includes("\n")) throw new TypeError("description must occupy one line");
  if (COMPOUND_POSITION.test(text)) throw new RangeError("description must define the concept independently, not its position in a compound");
  return Object.freeze({ type: "Description", text });
}
