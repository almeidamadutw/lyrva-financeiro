import assert from "node:assert/strict";
import test from "node:test";
import { analyticsDateRange, analyticsUnitCode } from "../lib/collection-analytics.ts";

test("analytics periods include complete calendar months across years and leap years", () => {
  assert.deepEqual(analyticsDateRange("2026-10", 6), { from: "2026-05-01", to: "2026-10-31" });
  assert.deepEqual(analyticsDateRange("2026-10", 1), { from: "2026-10-01", to: "2026-10-31" });
  assert.deepEqual(analyticsDateRange("2026-02", 3), { from: "2025-12-01", to: "2026-02-28" });
  assert.deepEqual(analyticsDateRange("2024-02", 12), { from: "2023-03-01", to: "2024-02-29" });
  for (const month of ["", "2026-00", "2026-13", "2026-2", "2026-01-01"]) {
    assert.throws(() => analyticsDateRange(month, 6));
  }
  assert.throws(() => analyticsDateRange("2026-10", 24));
});

test("the Salto UI selector addresses its real database unit without broadening scope", () => {
  assert.equal(analyticsUnitCode("salto"), "salto_de_pirapora");
  assert.equal(analyticsUnitCode("sorocaba"), "sorocaba");
  assert.equal(analyticsUnitCode("todas"), null);
  assert.equal(analyticsUnitCode("unknown"), "unknown");
});
