// ==========================================
// Campos configuraveis do formulario publico (PRD 6.5) — parte compartilhada.
//
// Leaf: nao importa nada. E lido pelo navegador (o formulario publico e a tela
// de edicao) e pelo servidor (a validacao que vale). Arrastar modulo de
// servidor para o bundle e o erro que a regra do eslint sobre `components/**`
// existe para impedir.
//
// LIMITE DELIBERADO: nada aqui torna CPF, nome, e-mail, endereco ou papel
// opcional. Esses cinco definem `registration_status = 'completo'` no gate da
// secao 6.3 — deixar a tela desligar um deles faria o portao dizer "completo"
// sobre um cadastro que nao sustenta contrato nenhum. O que e configuravel sao
// perguntas ADICIONAIS.
// ==========================================

export type TipoCampo =
  | 'texto'
  | 'texto_longo'
  | 'numero'
  | 'escolha'
  | 'multipla'
  | 'sim_nao'
  | 'data'

export interface CampoFormulario {
  id: string
  form_type: 'cadastro' | 'listagem_imovel'
  chave: string
  rotulo: string
  ajuda: string | null
  tipo: TipoCampo
  opcoes: string[]
  obrigatorio: boolean
  /** Vazio = sempre visivel. Preenchido = so aparece para estes papeis. */
  papeis: string[]
  posicao: number
  is_active: boolean
}

export const TIPOS: {
  valor: TipoCampo
  rotulo: string
  descricao: string
}[] = [
  { valor: 'texto', rotulo: 'Texto curto', descricao: 'Uma linha' },
  { valor: 'texto_longo', rotulo: 'Texto longo', descricao: 'Vários parágrafos' },
  { valor: 'numero', rotulo: 'Número', descricao: 'Só dígitos' },
  { valor: 'escolha', rotulo: 'Escolha uma', descricao: 'Lista suspensa' },
  { valor: 'multipla', rotulo: 'Escolha várias', descricao: 'Caixas de marcação' },
  { valor: 'sim_nao', rotulo: 'Sim ou não', descricao: 'Duas opções' },
  { valor: 'data', rotulo: 'Data', descricao: 'Calendário' },
]

export const TIPOS_COM_OPCOES: TipoCampo[] = ['escolha', 'multipla']

/* Chaves que colidiriam com o cadastro em si. `cpf` e as suas variantes estao
   aqui por motivo diferente das outras: a regra do projeto e que CPF vive em
   tres colunas dedicadas, criptografado, e NUNCA em payload solto. Um campo
   extra chamado `cpf` guardaria o numero em texto plano dentro de um jsonb —
   exatamente o que a secao 6.2 proibe. */
export const CHAVES_RESERVADAS = [
  'cpf',
  'cpf_hash',
  'cpf_encrypted',
  'cpf_last4',
  'full_name',
  'nome',
  'email',
  'address',
  'endereco',
  'birth_date',
  'roles',
  'papeis',
  'senha',
  'password',
  'token',
]

/** Aceita `renda_mensal`, recusa `Renda Mensal` e `renda-mensal`. */
export const FORMATO_CHAVE = /^[a-z][a-z0-9_]{1,39}$/

export function sugerirChave(rotulo: string): string {
  return rotulo
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^(\d)/, 'campo_$1')
    .slice(0, 40)
}

export interface ProblemaCampo {
  campo: string
  mensagem: string
}

/** Valida a DEFINICAO do campo (a tela de admin e a rota usam a mesma). */
export function validarDefinicao(c: Partial<CampoFormulario>): ProblemaCampo[] {
  const problemas: ProblemaCampo[] = []

  if (!c.rotulo?.trim()) {
    problemas.push({ campo: 'rotulo', mensagem: 'A pergunta precisa de um texto.' })
  }

  const chave = c.chave?.trim() ?? ''
  if (!FORMATO_CHAVE.test(chave)) {
    problemas.push({
      campo: 'chave',
      mensagem: 'Use letras minúsculas, números e _ (ex.: renda_mensal), começando por letra.',
    })
  } else if (CHAVES_RESERVADAS.includes(chave)) {
    problemas.push({
      campo: 'chave',
      mensagem: `"${chave}" é um dado do cadastro e já é coletado em campo próprio.`,
    })
  }

  if (c.tipo && TIPOS_COM_OPCOES.includes(c.tipo)) {
    const opcoes = (c.opcoes ?? []).map((o) => o.trim()).filter(Boolean)
    if (opcoes.length < 2) {
      problemas.push({ campo: 'opcoes', mensagem: 'Liste ao menos duas opções.' })
    } else if (new Set(opcoes).size !== opcoes.length) {
      problemas.push({ campo: 'opcoes', mensagem: 'Há opções repetidas.' })
    }
  }

  return problemas
}

/** Um campo restrito a papeis so aparece — e so e cobrado — se a pessoa marcou um deles. */
export function campoVisivel(campo: CampoFormulario, papeisMarcados: string[]): boolean {
  if (!campo.papeis?.length) return true
  return campo.papeis.some((p) => papeisMarcados.includes(p))
}

export function respostaVazia(v: unknown): boolean {
  if (v === null || v === undefined) return true
  if (typeof v === 'string') return v.trim() === ''
  if (Array.isArray(v)) return v.length === 0
  return false
}

export interface ErroResposta {
  chave: string
  mensagem: string
}

/**
 * Valida as RESPOSTAS contra as definicoes. Roda no navegador (para a pessoa
 * ver o erro antes de enviar) e no servidor (a que vale).
 *
 * Devolve tambem `limpas`: so as chaves de campos ativos e VISIVEIS. Copiar o
 * objeto que veio do navegador guardaria qualquer chave que alguem inventasse
 * no devtools, dentro do cadastro, para sempre.
 */
export function validarRespostas(
  campos: CampoFormulario[],
  respostas: Record<string, unknown>,
  papeisMarcados: string[]
): { erros: ErroResposta[]; limpas: Record<string, unknown> } {
  const erros: ErroResposta[] = []
  const limpas: Record<string, unknown> = {}

  for (const campo of campos) {
    if (!campo.is_active) continue

    /* Campo escondido nao e cobrado: exigir resposta de pergunta que a pessoa
       nunca viu deixaria o formulario impossivel de enviar, sem dizer por que. */
    if (!campoVisivel(campo, papeisMarcados)) continue

    const bruta = respostas?.[campo.chave]

    if (respostaVazia(bruta)) {
      if (campo.obrigatorio) {
        erros.push({ chave: campo.chave, mensagem: `Preencha "${campo.rotulo}".` })
      }
      continue
    }

    switch (campo.tipo) {
      case 'numero': {
        const n = Number(String(bruta).replace(',', '.'))
        if (!Number.isFinite(n)) {
          erros.push({ chave: campo.chave, mensagem: `"${campo.rotulo}" deve ser um número.` })
        } else {
          limpas[campo.chave] = n
        }
        break
      }
      case 'escolha': {
        const v = String(bruta)
        if (!campo.opcoes.includes(v)) {
          erros.push({ chave: campo.chave, mensagem: `Escolha uma opção de "${campo.rotulo}".` })
        } else {
          limpas[campo.chave] = v
        }
        break
      }
      case 'multipla': {
        const lista = (Array.isArray(bruta) ? bruta : [bruta]).map(String)
        const foraDaLista = lista.filter((v) => !campo.opcoes.includes(v))
        if (foraDaLista.length) {
          erros.push({ chave: campo.chave, mensagem: `Opção inválida em "${campo.rotulo}".` })
        } else {
          limpas[campo.chave] = lista
        }
        break
      }
      case 'sim_nao': {
        limpas[campo.chave] = bruta === true || bruta === 'sim' || bruta === 'true'
        break
      }
      case 'data': {
        const v = String(bruta)
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
          erros.push({ chave: campo.chave, mensagem: `Data inválida em "${campo.rotulo}".` })
        } else {
          limpas[campo.chave] = v
        }
        break
      }
      default: {
        /* Texto tem teto: um jsonb sem limite e um jeito silencioso de encher
           a linha do cadastro com o que o navegador quiser mandar. */
        limpas[campo.chave] = String(bruta).trim().slice(0, 2000)
      }
    }
  }

  return { erros, limpas }
}

/** Mostra a resposta guardada em `registrations.extra` no painel. */
export function formatarResposta(campo: CampoFormulario, valor: unknown): string {
  if (respostaVazia(valor)) return '—'
  if (campo.tipo === 'sim_nao') return valor ? 'Sim' : 'Não'
  if (Array.isArray(valor)) return valor.join(', ')
  if (campo.tipo === 'data') {
    const [a, m, d] = String(valor).split('-')
    return `${d}/${m}/${a}`
  }
  return String(valor)
}
