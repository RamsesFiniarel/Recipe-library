import { test } from "node:test";
import assert from "node:assert/strict";
import { assertTagKey, optionalTextureDataUrl } from "../server/middleware/validate.js";

const PNG_1PX =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const JPEG_START = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD";

test("a cover picture must be a jpg or png by its content, not only its label", () => {
  assert.equal(optionalTextureDataUrl(PNG_1PX), PNG_1PX);
  assert.equal(optionalTextureDataUrl(JPEG_START), JPEG_START);
  assert.equal(optionalTextureDataUrl(undefined), undefined);
  assert.equal(optionalTextureDataUrl(null), null);
  // HTML labelled as a picture, a png labelled as a jpeg, another type.
  const html = `data:image/png;base64,${Buffer.from("<script>alert(1)</script>").toString("base64")}`;
  for (const value of [html, PNG_1PX.replace("image/png", "image/jpeg"), "data:image/svg+xml;base64,PHN2Zz4=", 42]) {
    assert.throws(() => optionalTextureDataUrl(value), { status: 400 });
  }
});

test("a settings' tag key is c- and an id", () => {
  assert.equal(assertTagKey("c-2k7mxq9fzbn4"), "c-2k7mxq9fzbn4");
  for (const value of ["%", "repas", "c-", "c-2k7mxq9fzbn4x", "../c-2k7mxq9fzbn4"]) {
    assert.throws(() => assertTagKey(value), { status: 400 });
  }
});
