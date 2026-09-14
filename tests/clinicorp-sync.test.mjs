import assert from "node:assert/strict";
import test from "node:test";

import {
  extractSubscriberCandidates,
  selectBusiness,
  summarizePaymentMapping,
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

test("maps only boleto and card movements for LYVRA", () => {
  const mapping = summarizePaymentMapping(
    [
      { id: 1, PatientId: 10, PaymentHeaderId: 100, PaymentForm: "Boleto" },
      { id: 2, PatientId: 11, PaymentHeaderId: 101, PaymentForm: "Cartão de Crédito" },
      { id: 3, PatientId: 12, PaymentHeaderId: 102, PaymentForm: "Pix" },
    ],
    [
      { id: 1, PatientId: 10, PaymentHeaderId: 100, PaymentForm: "Boleto" },
      { id: 4, PatientId: 13, PaymentHeaderId: 103, PaymentForm: "Dinheiro" },
    ],
  );

  assert.equal(mapping.eligiblePlans, 2);
  assert.equal(mapping.eligiblePatients, 2);
  assert.equal(mapping.eligibleInstallments, 2);
  assert.equal(mapping.eligibleReceipts, 1);
  assert.equal(mapping.skippedInstallments, 1);
  assert.equal(mapping.skippedReceipts, 1);
  assert.deepEqual(mapping.postedByMethod, { boleto: 1, card: 1, ignored: 1 });
});
