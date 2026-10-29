import { test } from "node:test";
import assert from "node:assert/strict";
import { purchasingPower } from "../../src/lib/finance.ts";

test("core toolchain runs finance.ts with native type stripping", () => {
  const value = purchasingPower(10000, 5);
  assert.ok(Math.abs(value - 7651.34) < 0.01, `expected ~7651.34, got ${value}`);
});
