// ==========================================
// Registro dos agentes editáveis pelo painel (PRD 12).
//
// A LISTA VEM DO CÓDIGO, não do banco. `agent_configs` nasce vazia e continua
// vazia até alguém editar algo: o prompt embutido em cada agente é o padrão, e
// a linha no banco é uma SOBRESCRITA. Montar a tela a partir da tabela mostraria
// uma lista vazia com todos os agentes funcionando — o oposto da verdade.
//
// Consequência prática: restaurar o padrão é APAGAR a linha, não copiar o texto
// do código para dentro dela. Copiar congelaria a versão de hoje e faria o
// agente parar de acompanhar as melhorias do prompt no código.
// ==========================================

import { PROMPT as PROMPT_SDR } from './sdr'
import { PROMPT as PROMPT_INVESTIDOR } from './investidor'
import { PROMPT as PROMPT_PROPRIETARIO } from './proprietario'
import { PROMPT as PROMPT_AGENDAMENTO } from './agendamento'
import { PROMPT as PROMPT_CLOSER } from './closer'
import { PROMPT as PROMPT_SUPORTE } from './suporte'
import { PROMPT_PADRAO as PROMPT_ORQUESTRADOR } from './orchestrator'

export interface AgenteRegistrado {
  key: string
  nome: string
  descricao: string
  promptPadrao: string
  modeloPadrao: string
  temperaturaPadrao: number
}

export const AGENTES: AgenteRegistrado[] = [
  {
    key: 'orchestrator',
    nome: 'Orquestrador',
    descricao:
      'Decide qual agente atende cada mensagem. Não fala com o cliente — devolve JSON. ' +
      'Mexer aqui muda o roteamento de tudo.',
    promptPadrao: PROMPT_ORQUESTRADOR,
    modeloPadrao: 'gpt-4o-mini',
    temperaturaPadrao: 0.1,
  },
  {
    key: 'sdr',
    nome: 'SDR',
    descricao: 'Atende quem procura imóvel para comprar ou alugar. É a porta de entrada.',
    promptPadrao: PROMPT_SDR,
    modeloPadrao: 'gpt-4o',
    temperaturaPadrao: 0.7,
  },
  {
    key: 'investidor',
    nome: 'Investidor',
    descricao: 'Atende quem compra para renda — fala de rentabilidade, não de moradia.',
    promptPadrao: PROMPT_INVESTIDOR,
    modeloPadrao: 'gpt-4o',
    temperaturaPadrao: 0.7,
  },
  {
    key: 'proprietario',
    nome: 'Proprietário',
    descricao: 'Atende quem quer disponibilizar um imóvel. Coleta o rascunho e a faixa de preço.',
    promptPadrao: PROMPT_PROPRIETARIO,
    modeloPadrao: 'gpt-4o',
    temperaturaPadrao: 0.7,
  },
  {
    key: 'agendamento',
    nome: 'Agendamento',
    descricao: 'Marca visitas. Exige cadastro completo antes de criar a visita (§6.3).',
    promptPadrao: PROMPT_AGENDAMENTO,
    modeloPadrao: 'gpt-4o',
    temperaturaPadrao: 0.7,
  },
  {
    key: 'suporte',
    nome: 'Suporte',
    descricao:
      'Atende quem já é inquilino: boleto, contrato e rescisão. Exige confirmação de CPF ' +
      'antes de expor qualquer dado — e isso é código, não prompt.',
    promptPadrao: PROMPT_SUPORTE,
    modeloPadrao: 'gpt-4o',
    temperaturaPadrao: 0.7,
  },
  {
    key: 'closer',
    nome: 'Closer',
    descricao:
      'Reserva o imóvel e pede documentos. Não aprova nada — quem aprova é humano (§15.2).',
    promptPadrao: PROMPT_CLOSER,
    modeloPadrao: 'gpt-4o',
    temperaturaPadrao: 0.7,
  },
]

export function acharAgente(key: string): AgenteRegistrado | undefined {
  return AGENTES.find((a) => a.key === key)
}

/* Reexportado de lib/ui/rotulos. A tela de Agentes é 'use client' e importar
   MODELOS daqui arrastava os prompts → base-agent → cliente da OpenAI para o
   navegador, quebrando a página inteira. */
export { MODELOS } from '@/lib/ui/rotulos'
