import 'dotenv/config'
import OpenAI from 'openai'
import { MODELOS_DISPONIVEIS, capacidadesDoModelo } from '../lib/ui/rotulos'
import { montarParametros } from '../lib/agents/parametros'
import { calcularCusto } from '../lib/observabilidade/uso'

/* Catálogo de modelos (§12). Rodar com: npm run check:modelos

   CHAMA A OPENAI — uma requisição minúscula por modelo, alguns centavos de
   milésimo no total. Roda quando o catálogo muda, não em laço.

   O que está sendo protegido: a tela de Agentes deixa escolher o modelo, e os
   modelos NÃO aceitam o mesmo payload. gpt-5 e os de raciocínio recusam
   `temperature` e `max_tokens` com 400 — não com aviso. Um catálogo que mente
   sobre isso derruba o atendimento inteiro na primeira mensagem depois de
   alguém trocar o modelo, e o sintoma é "o bot parou de responder".

   Este teste bate o catálogo contra a API DE VERDADE. Se a OpenAI mudar o
   contrato ou tirar um modelo do ar, é aqui que aparece. */

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 30000, maxRetries: 0 })

function ok(rotulo: string, condicao: boolean, detalhe = '') {
  console.log(`${condicao ? 'OK  ' : 'FALHA'} ${rotulo}${condicao || !detalhe ? '' : ` — ${detalhe}`}`)
  if (!condicao) process.exitCode = 1
}

async function tentar(modelo: string, extra: Record<string, unknown>) {
  try {
    await client.chat.completions.create({
      model: modelo,
      messages: [{ role: 'user', content: 'oi' }],
      ...extra,
    } as never)
    return { ok: true, erro: '' }
  } catch (e) {
    return { ok: false, erro: (e as Error).message.replace(/\s+/g, ' ').slice(0, 110) }
  }
}

async function main() {
  console.log('--- Estrutura do catálogo ---')

  ok('o catálogo tem modelos', MODELOS_DISPONIVEIS.length > 3, `${MODELOS_DISPONIVEIS.length}`)
  ok(
    'nenhum id repetido',
    new Set(MODELOS_DISPONIVEIS.map((m) => m.id)).size === MODELOS_DISPONIVEIS.length
  )

  /* Modelo sem preço aparece como custo zero na tela de Uso — número errado
     apresentado como certo, que é pior do que número ausente. */
  const semPreco = MODELOS_DISPONIVEIS.filter(
    (m) => calcularCusto({ modelo: m.id, tokensEntrada: 1_000_000, tokensSaida: 0 }) === 0
  )
  ok('todo modelo do catálogo tem preço', semPreco.length === 0, semPreco.map((m) => m.id).join(', '))

  const desconhecido = capacidadesDoModelo('modelo-que-nao-existe')
  /* Perfil conservador: assumir que um modelo novo aceita tudo o transformaria
     em 400 na próxima conversa. */
  ok(
    'modelo fora do catálogo cai no perfil conservador',
    !desconhecido.aceitaTemperatura && desconhecido.tetoPorCompletion && !desconhecido.aceitaPenalidades
  )

  console.log('\n--- montarParametros respeita as capacidades ---')

  const ajustes = {
    temperature: 0.5,
    top_p: 0.9,
    max_tokens: 500,
    frequency_penalty: 0.2,
    presence_penalty: 0.1,
  }

  for (const m of MODELOS_DISPONIVEIS) {
    const p = montarParametros(m.id, ajustes)

    const temTemp = 'temperature' in p
    const chaveTeto = 'max_completion_tokens' in p ? 'max_completion_tokens' : 'max_tokens' in p ? 'max_tokens' : 'nenhuma'
    const temPenalidade = 'presence_penalty' in p

    const certo =
      temTemp === m.aceitaTemperatura &&
      chaveTeto === (m.tetoPorCompletion ? 'max_completion_tokens' : 'max_tokens') &&
      temPenalidade === m.aceitaPenalidades

    ok(
      `${m.id}: payload montado conforme o catálogo`,
      certo,
      `temperature=${temTemp} teto=${chaveTeto} penalidade=${temPenalidade}`
    )
  }

  console.log('\n--- Contra a API de verdade ---')

  for (const m of MODELOS_DISPONIVEIS) {
    const cap = capacidadesDoModelo(m.id)

    /* Exatamente o payload que o base-agent montaria, mais o teto mínimo para
       a resposta não sair vazia. */
    const params = montarParametros(m.id, { ...ajustes, max_tokens: 16 })
    const r = await tentar(m.id, params)
    ok(`${m.id}: a chamada real passa`, r.ok, r.erro)

    if (!r.ok) continue

    // A capacidade declarada bate com o que a API aceita?
    if (!cap.aceitaTemperatura) {
      const comTemp = await tentar(m.id, { ...params, temperature: 0.5 })
      /* Se isto começar a passar, a OpenAI liberou o parâmetro e o catálogo
         está tirando um controle que já existe. */
      ok(`${m.id}: confirma que recusa temperature`, !comTemp.ok, 'a API aceitou — atualize o catálogo')
    }
    if (cap.tetoPorCompletion) {
      const comMaxTokens = await tentar(m.id, { max_tokens: 16 })
      ok(`${m.id}: confirma que exige max_completion_tokens`, !comMaxTokens.ok, 'a API aceitou max_tokens')
    }
  }

  console.log('\n--- Tool calling ---')

  /* Todo agente do projeto depende de tool calling. Um modelo no catálogo que
     não suporte tools passaria no teste acima e falharia na primeira busca de
     imóvel. */
  const ferramenta = {
    tools: [
      {
        type: 'function',
        function: {
          name: 'ping',
          description: 'teste',
          parameters: { type: 'object', properties: {}, additionalProperties: false },
        },
      },
    ],
  }

  for (const m of MODELOS_DISPONIVEIS) {
    const params = montarParametros(m.id, { ...ajustes, max_tokens: 16 })
    const r = await tentar(m.id, { ...params, ...ferramenta })
    ok(`${m.id}: aceita tool calling`, r.ok, r.erro)
  }
}

main().catch((e) => {
  console.error('erro:', e.message ?? e)
  process.exit(1)
})
