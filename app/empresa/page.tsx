import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Informações da empresa | LYVRA",
  description: "Informações legais da empresa responsável pelo LYVRA Financeiro.",
};

const companyDetails = [
  ["Razão social", "CASAL ODONTO LTDA"],
  ["CNPJ", "57.678.903/0001-43"],
  ["Endereço", "Avenida Antônio Carlos Comitre, 1393, sala 22, Parque Campolim, Sorocaba - SP, CEP 18047-620"],
];

export default function CompanyPage() {
  return (
    <main className="min-h-screen bg-[#f4f7f5] px-5 py-10 text-[#213128] sm:px-8 sm:py-16">
      <section className="mx-auto max-w-3xl overflow-hidden rounded-3xl border border-[#dce4de] bg-white shadow-[0_20px_70px_rgba(22,56,37,0.08)]">
        <header className="border-b border-[#e5ebe7] bg-[#153f2b] px-6 py-8 text-white sm:px-10 sm:py-10">
          <p className="text-sm font-semibold uppercase tracking-[0.22em] text-[#8be2ad]">LYVRA Financeiro</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Informações da empresa</h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-[#d7e7dd]">
            O LYVRA é o sistema financeiro interno da Casal Odonto, desenvolvido para apoiar a gestão das unidades.
          </p>
        </header>

        <div className="px-6 py-8 sm:px-10 sm:py-10">
          <dl className="divide-y divide-[#e5ebe7]">
            {companyDetails.map(([label, value]) => (
              <div key={label} className="grid gap-2 py-5 first:pt-0 sm:grid-cols-[9rem_1fr] sm:gap-6">
                <dt className="text-sm font-semibold text-[#597064]">{label}</dt>
                <dd className="text-base leading-7 text-[#213128]">{value}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-8 rounded-2xl border border-[#cfe9d9] bg-[#f0faf4] p-5 text-sm leading-6 text-[#365744]">
            Este domínio é administrado pela empresa para a operação do LYVRA Financeiro e para integrações oficiais de atendimento e cobrança.
          </div>

          <nav className="mt-8 flex flex-wrap gap-4 text-sm font-semibold" aria-label="Links institucionais">
            <Link className="text-[#08783e] underline-offset-4 hover:underline" href="/">
              Acessar o LYVRA
            </Link>
            <a
              className="text-[#08783e] underline-offset-4 hover:underline"
              href="https://www.casalodonto.com"
              rel="noreferrer"
              target="_blank"
            >
              Site da Casal Odonto
            </a>
          </nav>
        </div>
      </section>
    </main>
  );
}
