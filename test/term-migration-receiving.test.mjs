import assert from "node:assert/strict";
import { test } from "node:test";
import { recognizeTermMarkdown } from "@red-cup-engineering/term-engineering-services-section/carrier";
import { planTermMigration, prepareDescriptionBridge, seatDescriptionOverlay, verifyMigrationMaterialization }
  from "@red-cup-engineering/term-engineering-services-section/migration";

test("migration hands canonical term fields, not recognition diagnostics, to its strict writer", () => {
  const text="---\nname: Runoff\ndate-created: 2026-01-02\naliases: [Surface runoff]\n---\n\nWater flowing over land.\n";
  const source={relativePath:"runoff.md",format:"md",text};
  const plan=planTermMigration([source]);
  const [result]=plan.transactions;
  const parsed=recognizeTermMarkdown({filename:result.output,text:result.markdown});
  assert.equal(parsed.admitted,true);
  assert.equal(parsed.identity,"runoff");
  assert.deepEqual(parsed.provenance,{"date-created":"2026-01-02"});
  assert.deepEqual(parsed.aliases,["Surface runoff"]);
  assert.equal(parsed.description,undefined);
  assert(!/^\s*(term|admitted|kind|findings):/mu.test(result.markdown));
  assert.equal(verifyMigrationMaterialization(plan,new Map([[result.output,result.markdown]])).valid,true);
  assert.equal(verifyMigrationMaterialization(plan,new Map([[result.output,result.markdown+"drift"]])).valid,false);
  assert.throws(()=>planTermMigration([{...source,text:text.replace("name:","unrecognized:")}]),{code:"ERR_TERM_MIGRATION_REFUSED"});
});

test("a description can be seated without weakening original term source binding",()=>{
  const migration=planTermMigration([{relativePath:"runoff.md",format:"md",text:"---\nname: Runoff\n---\nWater flowing.\n"}]);
  const [carrier]=migration.transactions;
  const terms=[{filename:carrier.output,text:carrier.markdown}];
  const [request]=prepareDescriptionBridge(terms);
  const description="Water flowing over land after rainfall.";
  const result=seatDescriptionOverlay(terms,[{...request,description}]);
  const admitted=recognizeTermMarkdown({filename:carrier.output,text:result.outputs.get(carrier.output)});
  assert.equal(admitted.description,description);
  assert.equal(admitted.body,"Water flowing.");
  assert.throws(()=>seatDescriptionOverlay(terms,[{...request,sourceSha256:"0".repeat(64),description}]),/witness mismatch/u);
});
