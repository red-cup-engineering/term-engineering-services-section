import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { pricePredicateIdentification } from "../scripts/price-predicate-identification.mjs";

const examples = [
  {
    "type": "JavascriptNodeOperationExample",
    "name": "mixed chain",
    "input": {
      "declarations": [
        {
          "a": "part-of",
          "kind": "mld",
          "b": "component-of"
        },
        {
          "a": "component-of",
          "kind": "equal",
          "b": "constituent-of"
        }
      ],
      "from": "part-of",
      "to": "constituent-of"
    },
    "output": {
      "type": "PredicateIdentificationPrice",
      "from": "part-of",
      "to": "constituent-of",
      "path": [
        {
          "a": "part-of",
          "kind": "mld",
          "b": "component-of"
        },
        {
          "a": "component-of",
          "kind": "equal",
          "b": "constituent-of"
        }
      ],
      "price": 3,
      "kind": "mld"
    }
  }
];

for (const example of examples) {
  test(example.name, async () => {
    const importedOutput = await pricePredicateIdentification(example.input);
    assert.deepEqual(importedOutput, example.output);
    const command = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/price-predicate-identification.mjs", import.meta.url))], {
      input: JSON.stringify(example.input) + "\n",
      encoding: "utf8",
    });
    assert.equal(command.status, 0, command.stderr);
    const commandOutput = JSON.parse(command.stdout.trim());
    assert.deepEqual(commandOutput, example.output);
    assert.deepEqual(commandOutput, importedOutput);
  });
}
