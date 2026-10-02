import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Política de Privacidade | LYVRA Financeiro",
  description:
    "Política de Privacidade do LYVRA Financeiro, sistema de gestão financeira utilizado pela Casal Odonto.",
};

export default function PoliticaDePrivacidadePage() {
  return (
    <main className="min-h-screen bg-[#f7f7f3] px-6 py-12 text-[#102b27]">
      <article className="mx-auto max-w-3xl rounded-[28px] border border-black/5 bg-white p-8 shadow-sm sm:p-12">
        <div className="mb-10">
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-[#00a86b]">
            LYVRA Financeiro
          </p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Política de Privacidade
          </h1>
          <p className="mt-4 text-sm text-black/55">Última atualização: 2 de outubro de 2026</p>
        </div>

        <div className="space-y-8 text-[15px] leading-7 text-black/75">
          <section>
            <h2 className="mb-2 text-xl font-semibold text-[#102b27]">1. Sobre esta política</h2>
            <p>
              Esta Política de Privacidade explica como o LYVRA Financeiro, sistema utilizado pela
              Casal Odonto para organização de rotinas financeiras e relacionamento com pacientes,
              trata dados pessoais no contexto de suas funcionalidades, inclusive integrações com
              serviços como WhatsApp Business e sistemas de gestão clínica.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-xl font-semibold text-[#102b27]">2. Dados tratados</h2>
            <p>
              O LYVRA pode tratar dados necessários à operação financeira e ao contato com pacientes,
              como nome, telefone, identificadores internos, informações de parcelas, vencimentos,
              status de pagamento, registros de cobrança, mensagens e eventos de entrega ou leitura
              fornecidos pelas integrações utilizadas pela clínica.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-xl font-semibold text-[#102b27]">3. Finalidades</h2>
            <p>
              Os dados são utilizados para executar rotinas administrativas e financeiras, organizar
              lembretes de vencimento, acompanhar pagamentos, registrar histórico de contatos,
              controlar emissão de documentos fiscais e permitir comunicações relacionadas ao
              atendimento e às obrigações financeiras existentes entre a clínica e seus pacientes.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-xl font-semibold text-[#102b27]">4. WhatsApp Business</h2>
            <p>
              Quando a integração com o WhatsApp Business Platform estiver habilitada, o LYVRA poderá
              enviar mensagens previamente configuradas pela clínica e receber eventos técnicos de
              mensagens, como envio, entrega, leitura e falha. O sistema utiliza esses dados somente
              para a operação da comunicação autorizada pela clínica e não vende dados pessoais a
              terceiros.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-xl font-semibold text-[#102b27]">5. Compartilhamento</h2>
            <p>
              Dados podem ser processados por fornecedores de infraestrutura e plataformas necessários
              ao funcionamento do serviço, incluindo provedores de banco de dados, hospedagem,
              WhatsApp Business Platform e sistemas integrados utilizados pela clínica. O
              compartilhamento é limitado ao necessário para a prestação das funcionalidades.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-xl font-semibold text-[#102b27]">6. Segurança e retenção</h2>
            <p>
              São adotadas medidas técnicas e organizacionais para restringir o acesso aos dados e
              reduzir riscos de uso indevido. Os registros são mantidos pelo período necessário para
              atender às finalidades operacionais, obrigações legais, fiscais e de auditoria aplicáveis,
              sendo eliminados ou anonimizados quando não houver mais necessidade legítima de
              conservação.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-xl font-semibold text-[#102b27]">7. Direitos do titular</h2>
            <p>
              Nos termos da Lei Geral de Proteção de Dados Pessoais (LGPD), o titular pode solicitar,
              quando aplicável, confirmação de tratamento, acesso, correção, informação sobre
              compartilhamentos, anonimização, bloqueio ou exclusão de dados tratados em desconformidade
              com a legislação e demais direitos previstos em lei.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-xl font-semibold text-[#102b27]">8. Solicitação de exclusão de dados</h2>
            <p>
              Para solicitar exclusão, correção ou esclarecimentos sobre dados tratados pelo LYVRA,
              entre em contato pelo e-mail{" "}
              <a className="font-medium text-[#008f5c] underline" href="mailto:diretoria.casalodonto@gmail.com">
                diretoria.casalodonto@gmail.com
              </a>
              . A solicitação será analisada considerando as obrigações legais e regulatórias que
              possam exigir a manutenção de determinados registros.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-xl font-semibold text-[#102b27]">9. Alterações</h2>
            <p>
              Esta política pode ser atualizada para refletir mudanças nas funcionalidades do LYVRA,
              nas integrações utilizadas ou na legislação aplicável. A versão vigente permanecerá
              disponível nesta página.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-xl font-semibold text-[#102b27]">10. Contato</h2>
            <p>
              Para dúvidas relacionadas a esta política ou ao tratamento de dados pessoais, escreva
              para{" "}
              <a className="font-medium text-[#008f5c] underline" href="mailto:diretoria.casalodonto@gmail.com">
                diretoria.casalodonto@gmail.com
              </a>
              .
            </p>
          </section>
        </div>
      </article>
    </main>
  );
}
