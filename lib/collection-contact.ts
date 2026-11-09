export type CollectionStage = "call" | "waiting" | "negotiation" | "promise" | "protested";

export type CollectionContact = {
  last_action_outcome: string | null;
  last_action_next_at: string | null;
  has_patient_contact: boolean;
  patient_contact_outcome: string | null;
};

function isWaitingForReply(outcome: string | null | undefined) {
  return outcome === "contact" || outcome === "no_contact";
}

export function collectionContactStage(status: string, nextActionAt: string | null, contact?: CollectionContact): {
  stage: CollectionStage;
  promisedPaymentAt?: string;
  contactOnAnotherBill?: boolean;
} {
  if (status === "protested") return { stage: "protested" };

  const outcome = contact?.last_action_outcome;
  const promisedPaymentAt = outcome === "promise"
    ? contact?.last_action_next_at
    : !outcome && status === "promise" ? nextActionAt : null;
  if (promisedPaymentAt) return { stage: "promise", promisedPaymentAt };
  if (isWaitingForReply(outcome)) return { stage: "waiting" };
  if (outcome || status !== "pending_contact") return { stage: "negotiation" };

  if (contact?.has_patient_contact) {
    return {
      stage: isWaitingForReply(contact.patient_contact_outcome) ? "waiting" : "negotiation",
      contactOnAnotherBill: true,
    };
  }
  return { stage: "call" };
}
