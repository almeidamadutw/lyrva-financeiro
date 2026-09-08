import assert from "node:assert/strict";
import test from "node:test";

import {
  extractSubscriberCandidates,
  selectBusiness,
  summarizePayments,
  validateDateRange,
} from "../supabase/functions/clinicorp-sync/clinicorp.mjs";

test("keeps Clinicorp subscribers separate and selects the matching unit", () => {
  assert.deepEqual(
    extractSubscriberCandidates({ SubscriberBussinessUID: "sub-sorocaba", Namespace: "Sorocaba" }),
    [{ id: "sub-sorocaba", name: "Sorocaba" }],
  );
  assert.deepEqual(
    selectBusiness(
      [
        { id: "10", name: "Casal Odonto Sorocaba" },
        { id: "20", name: "Casal Odonto Salto de Pirapora" },
      ],
      "Salto de Pirapora",
    ),
    { id: "20", name: "Casal Odonto Salto de Pirapora" },
  );
});

test("summarizes real payment shapes without exposing patient names", () => {
  const summary = summarizePayments([
    {
      id: 101,
      PatientId: 8,
      PatientName: "Nome sensível",
      Amount: 120.5,
      DueDate: "2026-09-10",
      ReceivedDate: "2026-09-08",
      ConfirmedDate: "2026-09-08",
      PaymentReceived: "X",
      PaymentConfirmed: "X",
      PaymentForm: "Boleto",
    },
  ]);

  assert.equal(summary.totalRows, 1);
  assert.equal(summary.uniquePatients, 1);
  assert.equal(summary.totalAmount, 120.5);
  assert.equal(summary.sample[0].patientId, "8");
  assert.doesNotMatch(JSON.stringify(summary.sample), /Nome sensível/);
});

test("limits the diagnostic window to 31 days", () => {
  assert.deepEqual(validateDateRange("2026-09-01", "2026-09-30"), {
    from: "2026-09-01",
    to: "2026-09-30",
    days: 30,
  });
  assert.throws(
    () => validateDateRange("2026-08-01", "2026-09-30"),
    /no máximo 31 dias/,
  );
});
