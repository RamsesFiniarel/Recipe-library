import { test } from "node:test";
import assert from "node:assert/strict";
import { checkedUrl, fetchPage, isPublicAddress } from "../server/services/page-fetch.service.js";
import { findWebAddress } from "../shared/web-address.js";

test("findWebAddress takes the link out of what was typed or pasted", () => {
  assert.equal(findWebAddress("https://www.marmiton.org/recettes/a.aspx"), "https://www.marmiton.org/recettes/a.aspx");
  assert.equal(findWebAddress("marmiton.org/recettes/a.aspx"), "https://marmiton.org/recettes/a.aspx");
  assert.equal(findWebAddress("Regarde ça : https://iamafoodblog.com/soup/ !"), "https://iamafoodblog.com/soup/");
  // Pasted twice, end to end.
  assert.equal(
    findWebAddress("https://www.allrecipes.com/recipe/86649/pizzas/https://www.allrecipes.com/recipe/86649/pizzas/"),
    "https://www.allrecipes.com/recipe/86649/pizzas/"
  );
  assert.equal(findWebAddress("(voir https://example.com/a)"), "https://example.com/a");
  for (const text of ["", "pâtes au pesto", "ftp://example.com/a", "javascript:alert(1)", null]) {
    assert.equal(findWebAddress(text), null, String(text));
  }
});

test("only addresses on the internet are public", () => {
  for (const address of ["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946", "::ffff:93.184.216.34"]) {
    assert.ok(isPublicAddress(address), address);
  }
  for (const address of [
    "127.0.0.1", "10.0.0.8", "172.16.4.1", "192.168.1.20", "169.254.169.254", "100.64.0.1", "0.0.0.0",
    "224.0.0.1", "::1", "::", "fd00::1", "fe80::1", "::ffff:192.168.1.20", "::ffff:127.0.0.1", "64:ff9b::a00:1",
    "pas une adresse",
  ]) {
    assert.ok(!isPublicAddress(address), address);
  }
});

test("checkedUrl refuses what the server mustn't fetch", () => {
  assert.equal(checkedUrl("https://www.marmiton.org/a").hostname, "www.marmiton.org");
  const refused = (address, code) => assert.throws(() => checkedUrl(address), { status: 400, code }, address);
  for (const address of ["ftp://example.com/", "file:///etc/passwd", "https://user:pass@example.com/", "https://example.com:8080/", "pas une adresse"]) {
    refused(address, "invalid-address");
  }
  refused(`https://example.com/${"a".repeat(2100)}`, "invalid-address");
  // LAN addresses written out (0x7f.1 and 2130706433 parse as 127.0.0.1).
  for (const address of ["http://127.0.0.1/", "http://192.168.1.1/admin", "http://[::1]/", "http://0x7f.1/", "http://2130706433/", "http://[::ffff:10.0.0.1]/"]) {
    refused(address, "private-address");
  }
});

test("a name that leads into the local network is refused once looked up", async () => {
  await assert.rejects(fetchPage("http://localhost/"), { status: 400, code: "private-address" });
});
