import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Exclusão de Dados | LYVRA Financeiro",
  description: "Instruções para solicitar exclusão de dados no LYVRA Financeiro.",
};

export default function ExclusaoDeDadosPage() {
  return (
    <main className="min-h-screen bg-[#f7f7f3] px-6 py-12 text-[#102b27]">
      <article className="mx-auto max-w-3xl rounded-[28px] border border-black/5 bg-white p-8 shadow-sm sm:p-12">
        <p className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-[#00a86b]">LYVRA Financeiro</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Solicitação de exclusão de dados</h1>
        <p className="mt-4 text-sm text-black/55">Última atualização: 5 de outubro de 2026</p>

        <div className="mt-10 space-y-8 text-[15px] leading-7 text-black/75">
          <section>
            <h2 className="mb-2 text-xl font-semibold text-[#102b27]">Como solicitar</h2>
            <p>
              Para solicitar exclusão, correção ou esclarecimentos sobre dados pessoais tratados pelo LYVRA,
              envie um e-mail para{" "}
              <a className="font-medium text-[#008f5c] underline" href="mailto:diretoria.casalodonto@gmail.com">
                diretoria.casalodonto@gmail.com
              </a>{" "}
              com o assunto <strong>Solicitação de exclusão de dados</strong>.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-xl font-semibold text-[#102b27]">Informações necessárias</h2>
            <p>
              Informe nome completo, telefone ou outro dado necessário para localizar o cadastro e descreva a solicitação.
              Podemos solicitar confirmação de identidade antes de executar a exclusão para proteger os dados do titular.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-xl font-semibold text-[#102b27]">Prazo e limitações</h2>
            <p>
              A solicitação será analisada conforme a legislação aplicável. Determinados registros poderão ser mantidos
              quando houver obrigação legal, regulatória, fiscal, contratual ou necessidade de exercício regular de direitos.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-xl font-semibold text-[#102b27]">Dados da Meta e WhatsApp</h2>
            <p>
              Quando a solicitação envolver dados processados por integrações com a Meta ou WhatsApp Business Platform,
              a análise considerará os registros efetivamente mantidos pelo LYVRA e as obrigações aplicáveis ao tratamento.
            </p>
          </section>
        </div>
      </article>
    </main>
  );
}
