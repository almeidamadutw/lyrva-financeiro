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

test("keeps renegotiated patients easy to find", async () => {
  const collections = await read("components/collections-journey-real.tsx");

  assert.match(collections, /placeholder="Buscar paciente"/);
  assert.match(collections, /new Date\(b\.updatedAt\)/);
  assert.match(collections, /new Date\(a\.updatedAt\)/);
});
