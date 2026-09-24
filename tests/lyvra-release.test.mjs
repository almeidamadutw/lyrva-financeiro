import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("keeps the visible product name as LYVRA", async () => {
  const paths = [
    "components/lyvra-app.tsx",
    "components/password-recovery.tsx",
    "supabase/templates/invite.html",
    "supabase/templates/recovery.html",
  ];
  const content = (await Promise.all(paths.map(read))).join("\n");

  assert.doesNotMatch(content, /LYRVA|lyrva/);
  assert.match(content, /LYVRA/);
});

test("keeps dashboard density and header controls inside their bounds", async () => {
  const app = await read("components/lyvra-app.tsx");

  assert.match(app, /SidebarProvider className="app-density"/);
  assert.match(app, /SidebarContent className="sidebar-scroll-clean px-2"/);
  assert.match(app, /sm:w-\[190px\]/);
  assert.match(app, /overflow-hidden text-ellipsis whitespace-nowrap/);
  assert.match(app, /placeholder="usuario@lyvrafinanceiro"/);
});

test("passes subscriber_id before asking Clinicorp for businesses", async () => {
  const integration = await read("supabase/functions/clinicorp-sync/index.ts");

  assert.doesNotMatch(integration, /clinicorpGet\("\/business\/list", \{\}, credentials\)/);
  assert.match(integration, /"\/business\/list",\s*\{ subscriber_id: subscriber\.id \}/);
  assert.match(integration, /\{ subscriber_id: credentials\.username \}/);
  assert.match(integration, /usedCredentialAsSubscriber/);
});

test("postpones due alerts while collection dictation is active", async () => {
  const [alerts, collections, activity] = await Promise.all([
    read("components/due-task-alert.tsx"),
    read("components/collections-journey-real.tsx"),
    read("lib/dictation-activity.ts"),
  ]);

  assert.match(alerts, /isDictationActive\(\)/);
  assert.match(alerts, /deferredByDictation/);
  assert.match(collections, /setDictationActive\(true\)/);
  assert.match(collections, /setDictationActive\(false\)/);
  assert.match(activity, /lyvra:dictation-state/);
});

test("lets the team close persistent collection notifications", async () => {
  const [app, alerts] = await Promise.all([
    read("components/lyvra-app.tsx"),
    read("components/due-task-alert.tsx"),
  ]);

  assert.match(app, /<Toaster[\s\S]*closeButton/);
  assert.match(app, /closeButtonAriaLabel: "Fechar notificação"/);
  assert.match(alerts, /duration: Infinity/);
});

test("keeps reminder exceptions manual and separate from settlement", async () => {
  const [review, migration] = await Promise.all([
    read("components/payment-reminder-review.tsx"),
    read("supabase/migrations/20260921143000_separate_settlement_from_reminder_exceptions.sql"),
  ]);

  assert.match(review, /MANUAL_REMINDER_EXCEPTION_REASON/);
  assert.match(review, /\.eq\("reminder_opt_out_reason", MANUAL_REMINDER_EXCEPTION_REASON\)/);
  assert.match(migration, /where reminder_opt_out_reason = 'Paciente quitado'/);
  assert.match(migration, /pu\.settled_at is not null/);
  assert.doesNotMatch(migration, /reminder_opt_out = true/);
});

test("keeps renegotiated patients easy to find", async () => {
  const collections = await read("components/collections-journey-real.tsx");

  assert.match(collections, /placeholder="Buscar paciente"/);
  assert.match(collections, /new Date\(b\.updatedAt\)/);
  assert.match(collections, /new Date\(a\.updatedAt\)/);
});

test("loads only actionable collection rows and renders them in batches", async () => {
  const collections = await read("components/collections-journey-real.tsx");

  assert.match(collections, /COLLECTION_PAGE_SIZE = 1_000/);
  assert.match(collections, /rpc\("get_collection_queue_page"/);
  assert.match(collections, /p_limit: COLLECTION_PAGE_SIZE/);
  assert.match(collections, /COLLECTION_RENDER_BATCH = 200/);
  assert.match(collections, /patients\.slice\(0, visibleCount\)/);
});

test("shows the latest collection conversation and who registered it", async () => {
  const collections = await read("components/collections-journey-real.tsx");

  assert.match(collections, /const outcomeLabels/);
  assert.match(collections, /rowInteractions\[rowInteractions\.length - 1\]/);
  assert.match(collections, /lastInteraction: latestInteraction/);
  assert.match(collections, /patient\.lastInteraction\.label} · \{patient\.lastInteraction\.author/);
  assert.match(collections, /Último: \{patient\.lastInteraction\.note\}/);
});

test("scopes settlement and operational blocking to the patient unit", async () => {
  const [migration, rollupGuard, app, workbook] = await Promise.all([
    read("supabase/migrations/20260918183039_scope_patient_settlement_by_unit.sql"),
    read("supabase/migrations/20260918185100_allow_internal_unit_settlement_rollup.sql"),
    read("components/lyvra-app.tsx"),
    read("components/nf-workbook-import.tsx"),
  ]);

  assert.match(migration, /add column if not exists settled_at timestamptz/);
  assert.match(migration, /pu\.patient_id = new\.patient_id\s+and pu\.unit_id = new\.unit_id/);
  assert.match(migration, /where pu\.settled_at is null/);
  assert.match(migration, /where pp\.patient_unit_id = v_plan\.patient_unit_id/);
  assert.match(rollupGuard, /pg_trigger_depth\(\) <= 1/);
  assert.match(app, /settledAt: row\.settled_at/);
  assert.doesNotMatch(app, /patientStateMap/);
  assert.match(workbook, /`\$\{unitKey\}::\$\{patientKey\(row\.name\)\}`/);
});

test("keeps collection imports in the Clinicorp unit", async () => {
  const [migration, importer] = await Promise.all([
    read("supabase/migrations/20260918184147_reassign_collection_imports_to_clinicorp_unit.sql"),
    read("components/collections-workbook-import.tsx"),
  ]);

  assert.match(migration, /pu_target\.clinicorp_patient_id is not null/);
  assert.match(migration, /unit_corrected_from/);
  assert.match(migration, /guard_collection_import_unit/);
  assert.match(migration, /where pu\.is_active/);
  assert.match(importer, /Unidade desta planilha/);
  assert.match(importer, /p_unit_code: unitCode/);
  assert.doesNotMatch(importer, /p_unit_code: "sorocaba"/);
});
