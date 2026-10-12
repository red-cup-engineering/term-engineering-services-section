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
