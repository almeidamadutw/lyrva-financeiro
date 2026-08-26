export type D1PreparedStatementLike = {
  bind: (...values: unknown[]) => D1PreparedStatementLike;
  all: <T = Record<string, unknown>>() => Promise<{ results: T[] }>;
  run: () => Promise<unknown>;
};

export type D1DatabaseLike = {
  prepare: (query: string) => D1PreparedStatementLike;
  batch: (statements: D1PreparedStatementLike[]) => Promise<unknown>;
};

export async function getD1(): Promise<D1DatabaseLike | null> {
  // D1 é injetado pelo runtime Cloudflare/Sites. Na Vercel, a interface roda
  // normalmente em modo demonstrativo até conectarmos o banco definitivo.
  if (process.env.VERCEL) return null;

  const cloudflareRuntime = "cloudflare:workers";
  const workers = await import(cloudflareRuntime) as { env?: { DB?: D1DatabaseLike } };
  return workers.env?.DB ?? null;
}
