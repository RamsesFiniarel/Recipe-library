import { test } from "node:test";
import assert from "node:assert/strict";
import { rateLimit } from "../server/middleware/rate-limit.js";

function request(limiter, ip) {
  let outcome = null;
  const res = {
    set() {
      return this;
    },
    status(code) {
      outcome = code;
      return this;
    },
    json() {
      return this;
    },
  };
  limiter({ ip }, res, () => {
    outcome = "next";
  });
  return outcome;
}

test("rateLimit lets `max` requests through per address, then answers 429", (t) => {
  t.mock.method(console, "warn", () => {});
  const limiter = rateLimit({ windowMs: 60_000, max: 3, label: "test" });
  assert.deepEqual(
    [1, 2, 3, 4].map(() => request(limiter, "192.168.1.30")),
    ["next", "next", "next", 429]
  );
  // Another address has its own count.
  assert.equal(request(limiter, "192.168.1.31"), "next");
});

test("rateLimit counts again once the window has passed", (t) => {
  t.mock.method(console, "warn", () => {});
  t.mock.timers.enable({ apis: ["Date"], now: 0 });
  const limiter = rateLimit({ windowMs: 1000, max: 1, label: "test" });
  assert.equal(request(limiter, "10.0.0.1"), "next");
  assert.equal(request(limiter, "10.0.0.1"), 429);
  t.mock.timers.tick(1001);
  assert.equal(request(limiter, "10.0.0.1"), "next");
});
