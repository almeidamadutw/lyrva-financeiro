from pathlib import Path

path = Path('components/lyvra-app.tsx')
s = path.read_text(encoding='utf-8')

old = '''const allowedViewsFor = (user: UserAccount) => {
  const byArea: Record<OperationalArea, View[]> = {
    none: ["patients"],
    reminders: ["journey", "patients"],
    collections: ["collections", "patients"],
    invoices: ["invoices", "patients", "import"],
    management: ["dashboard", "journey", "invoices", "collections", "patients", "import", "access"],
    support: ["support", "access", "integrations"],
  };
  return new Set<View>(byArea[user.operationalArea] ?? byArea.none);
};'''
new = '''const allowedViewsFor = (user: UserAccount) => {
  const financialViews: View[] = ["dashboard", "journey", "invoices", "collections", "patients", "import"];
  const supportViews: View[] = ["support", "access", "integrations"];
  return new Set<View>(user.role === "suporte" || user.operationalArea === "support" ? supportViews : financialViews);
};'''
if old not in s:
    raise SystemExit('allowedViewsFor antigo não encontrado')
s = s.replace(old, new, 1)

s = s.replace(
    '<SidebarGroupLabel className="text-[10px] uppercase tracking-[0.16em] text-white/35">{areaLabels[currentUser.operationalArea]}</SidebarGroupLabel>',
    '<SidebarGroupLabel className="text-[10px] uppercase tracking-[0.16em] text-white/35">{currentUser.operationalArea === "support" ? "Suporte" : "Financeiro"}</SidebarGroupLabel>',
    1,
)

s = s.replace(
    '<FinancialJourney unit={unit} mode={currentUser.operationalArea === "reminders" ? "reminders" : "management"} />',
    '<FinancialJourney unit={unit} mode="management" />',
    1,
)

s = s.replace(
    'canEdit={["invoices", "management"].includes(currentUser.operationalArea)}',
    'canEdit={currentUser.operationalArea !== "support"}',
    1,
)

path.write_text(s, encoding='utf-8')
