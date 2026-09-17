import assert from "node:assert/strict";
import test from "node:test";

import {
  extractSubscriberCandidates,
  selectBusiness,
  summarizePaymentMapping,
  summarizePayments,
  validateDateRange,
} from "../supabase/functions/clinicorp-sync/clinicorp.mjs";
import {
  eligibleAutomaticPayments,
  externalPaymentId,
  paymentChanged,
} from "../supabase/functions/clinicorp-auto-sync/clinicorp.mjs";

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

test("automatic sync keeps only confirmed boleto and card rows", () => {
  const eligible = eligibleAutomaticPayments([
    { id: "boleto-1", PatientId: "10", PaymentConfirmed: "X", ConfirmedDate: "2026-09-17", PaymentForm: "Boleto" },
    { id: "card-1", PatientId: "11", PaymentConfirmed: "X", ConfirmedDate: "2026-09-17", PaymentForm: "Cartão de Crédito" },
    { id: "pix-1", PatientId: "12", PaymentConfirmed: "X", ConfirmedDate: "2026-09-17", PaymentForm: "Pix" },
    { id: "pending-1", PatientId: "13", PaymentConfirmed: "", ConfirmedDate: "", PaymentForm: "Boleto" },
  ]);

  assert.deepEqual(eligible.map(externalPaymentId), ["boleto-1", "card-1"]);
});

test("automatic sync ignores unchanged raw Clinicorp payloads", () => {
  const incoming = {
    id: "payment-1",
    PatientId: "10",
    Amount: 120.5,
    PaymentConfirmed: "X",
    ConfirmedDate: "2026-09-17T12:00:00Z",
    PaymentForm: "Boleto",
  };
  const reordered = {
    PaymentForm: "Boleto",
    ConfirmedDate: "2026-09-17T12:00:00Z",
    PaymentConfirmed: "X",
    Amount: 120.5,
    PatientId: "10",
    id: "payment-1",
  };

  assert.equal(paymentChanged(incoming, reordered), false);
  assert.equal(paymentChanged({ ...incoming, Amount: 121 }, reordered), true);
});
