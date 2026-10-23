import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveTags, withTag, withoutTag } from "../shared/recipe-tags.js";

test("resolveTags applies the corrections, in display order, settings' tags last", () => {
  assert.deepEqual(resolveTags(["repas", "famille"], { add: ["pour2", "c-xyz"], remove: ["repas"] }), [
    "pour2",
    "famille",
    "c-xyz",
  ]);
  assert.deepEqual(resolveTags(["repas"], null), ["repas"]);
});

test("a tag forced by hand never takes another off", () => {
  // "Pour 2" and "En famille" together.
  assert.deepEqual(withTag(null, ["repas", "famille"], "pour2"), { add: ["pour2"], remove: [] });
});

test("corrections that undo each other leave none", () => {
  assert.equal(withTag({ add: [], remove: ["famille"] }, ["repas", "famille"], "famille"), null);
  assert.equal(withoutTag({ add: ["pour2"], remove: [] }, ["repas"], "pour2"), null);
  assert.deepEqual(withoutTag(null, ["repas"], "repas"), { add: [], remove: ["repas"] });
});
