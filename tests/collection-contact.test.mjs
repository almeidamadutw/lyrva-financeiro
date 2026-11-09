import assert from "node:assert/strict";
import test from "node:test";
import { collectionContactStage } from "../lib/collection-contact.ts";

const scheduledDate = "2026-11-20T12:00:00Z";
const emptyContact = {
  last_action_outcome: null,
  last_action_next_at: null,
  has_patient_contact: false,
  patient_contact_outcome: null,
};

test("an automatic action date keeps an untouched case in first contact", () => {
  assert.deepEqual(collectionContactStage("pending_contact", scheduledDate, emptyContact), { stage: "call" });
});

test("a contact or unanswered attempt waits for a reply regardless of the return date", () => {
  for (const outcome of ["contact", "no_contact"]) {
    assert.deepEqual(collectionContactStage("negotiating", scheduledDate, {
      ...emptyContact,
      last_action_outcome: outcome,
      last_action_next_at: scheduledDate,
    }), { stage: "waiting" });
  }
  assert.deepEqual(collectionContactStage("negotiating", scheduledDate, {
    ...emptyContact,
    last_action_outcome: "negotiation",
  }), { stage: "negotiation" });
});

test("only an actual dated payment promise goes to Promessas", () => {
  assert.deepEqual(collectionContactStage("pending_contact", "2026-11-09T03:00:00Z", {
    ...emptyContact,
    last_action_outcome: "promise",
    last_action_next_at: scheduledDate,
  }), { stage: "promise", promisedPaymentAt: scheduledDate });
  assert.deepEqual(collectionContactStage("promise", scheduledDate, emptyContact), { stage: "promise", promisedPaymentAt: scheduledDate });
  for (const outcome of ["payment_reported", "promise"]) {
    assert.deepEqual(collectionContactStage("promise", scheduledDate, {
      ...emptyContact,
      last_action_outcome: outcome,
    }), { stage: "negotiation" });
  }
});

test("another open bill keeps the patient out of first contact without copying a promise", () => {
  assert.deepEqual(collectionContactStage("pending_contact", null, {
    ...emptyContact,
    has_patient_contact: true,
    patient_contact_outcome: "no_contact",
  }), { stage: "waiting", contactOnAnotherBill: true });
  assert.deepEqual(collectionContactStage("pending_contact", null, {
    ...emptyContact,
    has_patient_contact: true,
    patient_contact_outcome: "promise",
  }), { stage: "negotiation", contactOnAnotherBill: true });
  assert.deepEqual(collectionContactStage("protested", null, {
    ...emptyContact,
    has_patient_contact: true,
    patient_contact_outcome: "contact",
  }), { stage: "protested" });
});
