import { readFileSync } from 'node:fs'
import { assinarCorpo, montarEventoLead } from '../lib/crm/webhook'

/* Webhook de leads para CRM externo. Rodar com: npm run check:crm

   NÃO chama a OpenAI nem o banco — exercita a parte pura (payload e
   assinatura) e verifica estruturalmente os gatilhos e a ausência de CPF.

   O que está sendo protegido: o payload vai para uma URL de TERCEIRO. CPF ali
   dentro multiplicaria o perímetro da LGPD por cada CRM plugado; envio sem
   assinatura seria impossível de autenticar do outro lado; e um CRM fora do ar
   nunca pode atrasar ou derrubar o atendimento. */

function ok(rotulo: string, condicao: boolean, detalhe = '') {
  console.log(`${condicao ? 'OK  ' : 'FALHA'} ${rotulo}${condicao || !detalhe ? '' : ` — ${detalhe}`}`)
  if (!condicao) process.exitCode = 1
}

function main() {
  console.log('--- Payload e assinatura ---')

  const quando = new Date('2026-09-01T12:00:00Z')
  const lead = {
    contact_id: 'c-1',
    nome: 'Leonardo',
    telefone: '5511999999999',
    canal: 'zapi',
    funil: 'novo',
    intencao: null,
    cadastro: {
      registration_id: 'r-1',
      nome: 'Leonardo Angelos',
      email: 'leo@exemplo.com',
      papeis: ['interessado'],
    },
  }
  const payload = montarEventoLead('lead_novo', lead, quando)
  ok('payload identifica o evento e a origem', payload.evento === 'lead_novo' && payload.origem === 'lovehome')
  ok('carimbo de tempo é o instante passado', payload.ocorrido_em === '2026-09-01T12:00:00.000Z')
  ok('nenhum campo de CPF no payload', !JSON.stringify(payload).toLowerCase().includes('cpf'))
  ok('evento de teste vai com lead nulo (não vaza dado de ninguém)', montarEventoLead('teste', null, quando).lead === null)

  const corpo = JSON.stringify(payload)
  const a1 = assinarCorpo(corpo, 'segredo-1')
  ok('assinatura no formato sha256=<hex>', /^sha256=[0-9a-f]{64}$/.test(a1), a1.slice(0, 20))
  ok('mesma entrada, mesma assinatura (o CRM confere do outro lado)', a1 === assinarCorpo(corpo, 'segredo-1'))
  ok('segredo diferente muda a assinatura', a1 !== assinarCorpo(corpo, 'segredo-2'))
  ok('corpo diferente muda a assinatura', a1 !== assinarCorpo(corpo + ' ', 'segredo-1'))

  console.log('\n--- Estrutural ---')

  const crm = readFileSync('lib/crm/webhook.ts', 'utf-8')
  ok('sem segredo cadastrado, nada é enviado (fail-closed)', crm.includes("motivo: 'segredo de assinatura não cadastrado'"))
  ok('a query do cadastro NÃO seleciona colunas de CPF', !crm.includes('cpf'))
  ok('envio tem timeout — CRM lento não atrasa o atendimento', crm.includes('AbortController'))
  ok('envio nunca lança (erro é engolido e logado)', crm.includes('catch'))

  const identity = readFileSync('lib/channels/identity.ts', 'utf-8')
  ok('contato NOVO dispara lead_novo', identity.includes("notificarCrm('lead_novo'"))
  const form = readFileSync('lib/registrations/form.ts', 'utf-8')
  ok('cadastro completo dispara lead_cadastro_completo', form.includes("notificarCrm('lead_cadastro_completo'"))
  const conf = readFileSync('lib/registrations/conferencia.ts', 'utf-8')
  ok('vincular na conferência também dispara', conf.includes("notificarCrm('lead_cadastro_completo'"))

  const salvar = readFileSync('lib/channels/salvar-config.ts', 'utf-8')
  ok('URL do webhook é validada na gravação', salvar.includes('precisa começar com http'))

  console.log('\n--- Registro de envios e reenvio ---')

  ok('toda tentativa real vira linha em crm_webhook_deliveries', crm.includes("from('crm_webhook_deliveries')"))
  ok('registrar nunca derruba o envio (erro engolido e logado)', crm.includes('não registrou o envio'))
  ok('reenvio usa o payload GUARDADO, não um novo', (() => {
    const fn = crm.slice(crm.indexOf('export async function reenviarEnvioCrm'))
    return fn.includes('envio.payload as PayloadCrm')
  })())
  ok('reenvio atualiza a mesma linha (tentativas +1), não cria outra', (() => {
    const fn = crm.slice(crm.indexOf('export async function reenviarEnvioCrm'))
    return fn.includes('tentativas: (envio.tentativas ?? 1) + 1') && !fn.includes(".insert(")
  })())
  const mig = readFileSync('supabase/migrations/040_crm_envios.sql', 'utf-8')
  ok('contato deletável: o log de envio CASCATEIA (payload tem dado pessoal)', mig.includes('ON DELETE CASCADE'))
  ok('tabela nasce com RLS (deny-all para anon)', mig.includes('ENABLE ROW LEVEL SECURITY'))

  console.log(process.exitCode ? '\nHouve falhas.' : '\nTudo certo.')
}

main()
