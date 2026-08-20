// ==========================================
// Rótulos e listas usados pela INTERFACE.
//
// ESTE ARQUIVO NÃO IMPORTA NADA, e essa é a regra que o mantém útil.
//
// Por que ele existe: componentes de cliente precisavam de constantes que
// moravam em módulos de servidor (`lib/queries/*`, `lib/rag/retriever`,
// `lib/agents/registro`). Importar uma delas arrasta o módulo inteiro para o
// bundle do navegador — e com ele `createAdminClient`, ou pior, o cliente da
// OpenAI, que é construído no escopo do módulo e QUEBRA a página com
// "It looks like you're running in a browser-like environment".
//
// Foi exatamente o que derrubou a tela de Agentes: `registro.ts` importa os
// prompts dos agentes, que importam `base-agent`, que importa o cliente OpenAI.
//
// Regra prática: se um `'use client'` precisa da constante, ela mora aqui. Os
// módulos de servidor reexportam daqui, então nada quebra do outro lado. O
// eslint.config.mjs barra o caminho antigo para isso não voltar.
// ==========================================

// ---- Canais de conversa ----
export const ROTULO_CANAL: Record<string, string> = {
  zapi: 'WhatsApp',
  meta: 'WhatsApp (Meta)',
  widget: 'Site',
}

// ---- Formulários ----
export type TipoFormulario = 'cadastro' | 'listagem_imovel'

export const ROTULO_TIPO_FORMULARIO: Record<TipoFormulario, string> = {
  cadastro: 'Cadastro do cliente',
  listagem_imovel: 'Listagem de imóvel',
}

// ---- Documentos ----
export const ROTULO_DOCUMENTO: Record<string, string> = {
  rg_cnh: 'RG ou CNH',
  comprovante_renda: 'Comprovante de renda',
  comprovante_residencia: 'Comprovante de residência',
  escritura_imovel: 'Escritura do imóvel',
  outro: 'Outro documento',
}

// ---- Materiais (RAG) ----
export type CategoriaMaterial =
  | 'financiamento'
  | 'documentacao'
  | 'glossario'
  | 'politicas'
  | 'geral'

export const CATEGORIAS: CategoriaMaterial[] = [
  'financiamento',
  'documentacao',
  'glossario',
  'politicas',
  'geral',
]

export const ROTULO_CATEGORIA: Record<CategoriaMaterial, string> = {
  financiamento: 'Financiamento',
  documentacao: 'Documentação',
  glossario: 'Glossário',
  politicas: 'Políticas',
  geral: 'Geral',
}

// ---- Funil ----
export type EstagioFunil =
  | 'novo'
  | 'qualificando'
  | 'qualificado'
  | 'visita_agendada'
  | 'em_negociacao'
  | 'convertido'
  | 'perdido'

export const ESTAGIOS: EstagioFunil[] = [
  'novo',
  'qualificando',
  'qualificado',
  'visita_agendada',
  'em_negociacao',
  'convertido',
  'perdido',
]

export const ROTULO_ESTAGIO: Record<EstagioFunil, string> = {
  novo: 'Novo',
  qualificando: 'Qualificando',
  qualificado: 'Qualificado',
  visita_agendada: 'Visita agendada',
  em_negociacao: 'Em negociação',
  convertido: 'Convertido',
  perdido: 'Perdido',
}

// ---- Agentes ----
/* Lista fechada de propósito: campo livre aceitaria um nome de modelo
   inexistente, e o agente só quebraria na próxima conversa de um cliente,
   longe de quem digitou. */
/* ---- Modelos disponíveis para os agentes ----
   A lista é FECHADA: campo livre aceitaria um nome inexistente, e o agente só
   quebraria na próxima conversa de um cliente, longe de quem digitou.

   `aceitaTemperatura` e `tetoPorCompletion` não são detalhe de catálogo — são
   diferença REAL de payload, medida contra a API (`npm run check:modelos`):

   - gpt-5, gpt-5-mini, gpt-5-nano, o4-mini e o3-mini RECUSAM `temperature`
     diferente de 1, `max_tokens` e as penalidades. Mandar qualquer um deles dá
     400 em TODA mensagem.
   - gpt-5.1 aceita `temperature` e penalidades, mas exige
     `max_completion_tokens` no lugar de `max_tokens`.

   Antes disto o `base-agent` mandava `temperature` e `max_tokens` sempre —
   escolher um modelo novo na tela de Agentes derrubaria o atendimento inteiro,
   e o sintoma seria "o bot parou de responder". */
export interface ModeloDisponivel {
  id: string
  rotulo: string
  nota: string
  /** false = só o padrão (1). A tela desabilita o controle e explica. */
  aceitaTemperatura: boolean
  /** true = usa `max_completion_tokens`; false = `max_tokens`. */
  tetoPorCompletion: boolean
  /** false = frequency_penalty / presence_penalty são recusadas. */
  aceitaPenalidades: boolean
  /** Modelo de raciocínio: responde mais devagar, custa mais na saída. */
  raciocinio?: boolean
}

export const MODELOS_DISPONIVEIS: ModeloDisponivel[] = [
  {
    id: 'gpt-5.1',
    rotulo: 'GPT-5.1',
    nota: 'O mais capaz. Aceita ajuste de temperatura.',
    aceitaTemperatura: true,
    tetoPorCompletion: true,
    aceitaPenalidades: true,
  },
  {
    id: 'gpt-5',
    rotulo: 'GPT-5',
    nota: 'Temperatura travada em 1 pela OpenAI.',
    aceitaTemperatura: false,
    tetoPorCompletion: true,
    aceitaPenalidades: false,
  },
  {
    id: 'gpt-5-mini',
    rotulo: 'GPT-5 mini',
    nota: 'Bom custo-benefício. Temperatura travada em 1.',
    aceitaTemperatura: false,
    tetoPorCompletion: true,
    aceitaPenalidades: false,
  },
  {
    id: 'gpt-5-nano',
    rotulo: 'GPT-5 nano',
    nota: 'O mais barato da família 5. Temperatura travada em 1.',
    aceitaTemperatura: false,
    tetoPorCompletion: true,
    aceitaPenalidades: false,
  },
  {
    id: 'gpt-4.1',
    rotulo: 'GPT-4.1',
    nota: 'Controle total de temperatura e penalidades.',
    aceitaTemperatura: true,
    tetoPorCompletion: false,
    aceitaPenalidades: true,
  },
  {
    id: 'gpt-4.1-mini',
    rotulo: 'GPT-4.1 mini',
    nota: 'Rápido e barato, com controle total.',
    aceitaTemperatura: true,
    tetoPorCompletion: false,
    aceitaPenalidades: true,
  },
  {
    id: 'gpt-4.1-nano',
    rotulo: 'GPT-4.1 nano',
    nota: 'O mais barato com controle total.',
    aceitaTemperatura: true,
    tetoPorCompletion: false,
    aceitaPenalidades: true,
  },
  {
    id: 'gpt-4o',
    rotulo: 'GPT-4o',
    nota: 'Geração anterior. Estável e testado neste projeto.',
    aceitaTemperatura: true,
    tetoPorCompletion: false,
    aceitaPenalidades: true,
  },
  {
    id: 'gpt-4o-mini',
    rotulo: 'GPT-4o mini',
    nota: 'Geração anterior, barato. Padrão histórico do projeto.',
    aceitaTemperatura: true,
    tetoPorCompletion: false,
    aceitaPenalidades: true,
  },
  {
    id: 'o4-mini',
    rotulo: 'o4-mini (raciocínio)',
    nota: 'Pensa antes de responder. Mais lento — evite em conversa ao vivo.',
    aceitaTemperatura: false,
    tetoPorCompletion: true,
    aceitaPenalidades: false,
    raciocinio: true,
  },
]

export const MODELOS = MODELOS_DISPONIVEIS.map((m) => m.id)

export function capacidadesDoModelo(id: string): ModeloDisponivel {
  return (
    MODELOS_DISPONIVEIS.find((m) => m.id === id) ?? {
      id,
      rotulo: id,
      nota: 'Modelo fora do catálogo.',
      /* O desconhecido cai no perfil CONSERVADOR: manda o mínimo. Assumir que
         aceita tudo transformaria um modelo novo em 400 na próxima conversa;
         assumir que aceita nada, no pior caso, ignora um ajuste fino. */
      aceitaTemperatura: false,
      tetoPorCompletion: true,
      aceitaPenalidades: false,
    }
  )
}

// ---- Uso e custo ----
export type OperacaoLLM =
  | 'agente'
  | 'roteamento'
  | 'copiloto'
  | 'resumo'
  | 'followup'
  | 'embedding_imovel'
  | 'embedding_rag'
  | 'embedding_busca'
  | 'transcricao'
  | 'visao'

export const ROTULO_OPERACAO: Record<OperacaoLLM, string> = {
  agente: 'Agentes de atendimento',
  roteamento: 'Orquestrador',
  copiloto: 'Copiloto do corretor',
  resumo: 'Resumo de lead',
  followup: 'Follow-up',
  embedding_imovel: 'Embedding de imóvel',
  embedding_rag: 'Indexação de material',
  embedding_busca: 'Busca semântica',
  transcricao: 'Transcrição de áudio',
  visao: 'Análise de imagem',
}


// ---- Status (as chaves são os valores dos CHECK do schema, §10) ----
export const ROTULOS_STATUS: Record<string, string> = {
  em_analise: 'Em análise',
  disponivel: 'Disponível',
  reservado: 'Reservado',
  vendido: 'Vendido',
  alugado: 'Alugado',
  inativo: 'Inativo',

  proposta: 'Proposta',
  em_aprovacao: 'Em aprovação',
  aprovado: 'Aprovado',
  ativo: 'Ativo',
  encerramento_solicitado: 'Encerramento solicitado',
  encerrado: 'Encerrado',
  concluido: 'Concluído',
  cancelado: 'Cancelado',

  pendente: 'Pendente',
  pago: 'Pago',
  atrasado: 'Atrasado',

  novo: 'Novo',
  qualificando: 'Qualificando',
  qualificado: 'Qualificado',
  visita_agendada: 'Visita agendada',
  em_negociacao: 'Em negociação',
  convertido: 'Convertido',
  perdido: 'Perdido',

  agendada: 'Agendada',
  confirmada: 'Confirmada',
  realizada: 'Realizada',
  no_show: 'Não compareceu',

  processando: 'Processando',
  indexado: 'Indexado',
  erro: 'Erro',

  preenchido: 'Preenchido',
  expirado: 'Expirado',

  pendente_revisao: 'Pendente de revisão',
  rejeitado: 'Rejeitado',
  info_solicitada: 'Informação solicitada',
}
