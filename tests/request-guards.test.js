import { test } from "node:test";
import assert from "node:assert/strict";
import { hostGuard, sameOriginGuard } from "../server/middleware/request-guards.js";

// Runs a middleware on a fake request: "next" if let through, else the status.
function run(middleware, { method = "GET", headers = {} } = {}) {
  let outcome = null;
  const res = {
    status(code) {
      outcome = code;
      return this;
    },
    json() {
      return this;
    },
  };
  const req = { method, headers, ip: "192.168.1.30", originalUrl: "/api/books" };
  middleware(req, res, () => {
    outcome = "next";
  });
  return outcome;
}

test("hostGuard answers this machine's names and IP addresses only (DNS rebinding)", (t) => {
  t.mock.method(console, "warn", () => {});
  const guard = hostGuard({ allowedHosts: ["cuisine.maison"], machineName: "homeserver" });
  for (const host of ["localhost:3000", "127.0.0.1:3000", "192.168.1.20", "[::1]:3000", "homeserver:3000", "homeserver.local", "Cuisine.Maison:3000"]) {
    assert.equal(run(guard, { headers: { host } }), "next", host);
  }
  for (const host of ["attaquant.example:3000", "homeserver.attaquant.example", undefined]) {
    assert.equal(run(guard, { headers: { host } }), 421, String(host));
  }
});

test("sameOriginGuard lets reading through and changes only from the site's own pages", (t) => {
  t.mock.method(console, "warn", () => {});
  const host = "192.168.1.20:3000";
  assert.equal(run(sameOriginGuard, { method: "GET", headers: { host, "sec-fetch-site": "cross-site" } }), "next");
  assert.equal(run(sameOriginGuard, { method: "POST", headers: { host, "sec-fetch-site": "same-origin" } }), "next");
  assert.equal(run(sameOriginGuard, { method: "DELETE", headers: { host, "sec-fetch-site": "cross-site" } }), 403);
  assert.equal(run(sameOriginGuard, { method: "PATCH", headers: { host, "sec-fetch-site": "same-site" } }), 403);
  // Older browsers: the Origin, port included.
  assert.equal(run(sameOriginGuard, { method: "POST", headers: { host, origin: "http://192.168.1.20:3000" } }), "next");
  assert.equal(run(sameOriginGuard, { method: "POST", headers: { host, origin: "http://192.168.1.20:8080" } }), 403);
  assert.equal(run(sameOriginGuard, { method: "POST", headers: { host, origin: "null" } }), 403);
  // Not from a web page at all.
  assert.equal(run(sameOriginGuard, { method: "POST", headers: { host } }), "next");
});
