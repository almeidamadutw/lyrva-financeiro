import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Termos de Serviço | LYVRA Financeiro",
  description: "Termos de Serviço do LYVRA Financeiro.",
};

export default function TermosDeServicoPage() {
  return (
    <main className="min-h-screen bg-[#f7f7f3] px-6 py-12 text-[#102b27]">
      <article className="mx-auto max-w-3xl rounded-[28px] border border-black/5 bg-white p-8 shadow-sm sm:p-12">
        <p className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-[#00a86b]">LYVRA Financeiro</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Termos de Serviço</h1>
        <p className="mt-4 text-sm text-black/55">Última atualização: 5 de outubro de 2026</p>

        <div className="mt-10 space-y-8 text-[15px] leading-7 text-black/75">
          <section>
            <h2 className="mb-2 text-xl font-semibold text-[#102b27]">1. Finalidade</h2>
            <p>
              O LYVRA Financeiro é uma aplicação de uso interno destinada à organização de rotinas financeiras,
              cobranças, lembretes, pagamentos, documentos fiscais e comunicações administrativas da Casal Odonto.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-xl font-semibold text-[#102b27]">2. Acesso</h2>
            <p>
              O acesso é restrito a usuários autorizados. Cada usuário deve manter suas credenciais em sigilo e usar
              o sistema somente para atividades compatíveis com sua função e com as políticas internas aplicáveis.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-xl font-semibold text-[#102b27]">3. Integrações</h2>
            <p>
              O LYVRA pode integrar-se a serviços de terceiros, incluindo plataformas de gestão clínica, infraestrutura
              em nuvem e WhatsApp Business Platform. O funcionamento dessas integrações também está sujeito aos termos
              e políticas dos respectivos fornecedores.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-xl font-semibold text-[#102b27]">4. Uso do WhatsApp Business</h2>
            <p>
              O sistema pode enviar comunicações operacionais e financeiras por meio de números oficiais da Casal Odonto,
              utilizando modelos de mensagem aprovados e recursos disponibilizados pela WhatsApp Business Platform.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-xl font-semibold text-[#102b27]">5. Proteção de dados</h2>
            <p>
              O tratamento de dados pessoais deve observar a legislação aplicável e a Política de Privacidade do LYVRA.
              O acesso aos dados é limitado ao necessário para as atividades autorizadas.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-xl font-semibold text-[#102b27]">6. Disponibilidade e alterações</h2>
            <p>
              O sistema pode passar por atualizações, manutenções ou indisponibilidades temporárias. Funcionalidades e
              integrações podem ser ajustadas para refletir mudanças técnicas, operacionais, legais ou de fornecedores.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-xl font-semibold text-[#102b27]">7. Contato</h2>
            <p>
              Dúvidas sobre estes termos podem ser enviadas para{" "}
              <a className="font-medium text-[#008f5c] underline" href="mailto:diretoria.casalodonto@gmail.com">
                diretoria.casalodonto@gmail.com
              </a>.
            </p>
          </section>
        </div>
      </article>
    </main>
  );
}
