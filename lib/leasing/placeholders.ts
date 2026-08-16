// ==========================================
// Catálogo de placeholders de contrato (PRD 15.1).
//
// FONTE ÚNICA. `preencherContrato` monta os valores a partir daqui, e a tela de
// templates mostra a mesma lista. Sem isso, editar um template pelo painel
// permitiria escrever `{{valor_aluguel}}` (que não existe) e o contrato sairia
// com `[valor_aluguel]` no lugar — em documento legal, entregue ao cliente.
//
// Não importa nada: é lido pelo servidor (preenchimento) e pelo navegador
// (editor), e arrastar módulo de servidor para o bundle é o erro que a regra do
// eslint sobre `components/**` existe para impedir.
// ==========================================

export interface Placeholder {
  chave: string
  rotulo: string
  exemplo: string
  /** Em qual tipo de contrato faz sentido. */
  onde: 'locacao' | 'venda' | 'ambos'
  /** Falta dele vira lacuna no contrato — quem revisa precisa saber. */
  obrigatorio?: boolean
}

export const PLACEHOLDERS: Placeholder[] = [
  // ---- Cliente ----
  { chave: 'tenant_name', rotulo: 'Nome do cliente', exemplo: 'Maria Souza Lima', onde: 'ambos', obrigatorio: true },
  { chave: 'tenant_cpf', rotulo: 'CPF do cliente', exemplo: '123.456.789-09', onde: 'ambos', obrigatorio: true },
  { chave: 'tenant_email', rotulo: 'E-mail do cliente', exemplo: 'maria@exemplo.com', onde: 'ambos' },
  { chave: 'tenant_address', rotulo: 'Endereço do cliente', exemplo: 'Rua A, 100 — Centro, São Paulo/SP', onde: 'ambos' },

  // ---- Proprietário ----
  { chave: 'owner_name', rotulo: 'Nome do proprietário', exemplo: 'João Pereira', onde: 'ambos', obrigatorio: true },
  { chave: 'owner_cpf', rotulo: 'CPF do proprietário', exemplo: '987.654.321-00', onde: 'ambos', obrigatorio: true },

  // ---- Imóvel ----
  { chave: 'property_code', rotulo: 'Código do imóvel', exemplo: 'LH-1001', onde: 'ambos' },
  { chave: 'property_type', rotulo: 'Tipo do imóvel', exemplo: 'apartamento', onde: 'ambos' },
  { chave: 'property_address', rotulo: 'Endereço do imóvel', exemplo: 'Rua Vergueiro, 500, ap. 72', onde: 'ambos', obrigatorio: true },
  { chave: 'property_region', rotulo: 'Bairro', exemplo: 'Vila Mariana', onde: 'ambos' },
  { chave: 'property_city', rotulo: 'Cidade', exemplo: 'São Paulo', onde: 'ambos' },
  { chave: 'property_area', rotulo: 'Área', exemplo: '64 m²', onde: 'ambos' },
  { chave: 'property_bedrooms', rotulo: 'Dormitórios', exemplo: '2', onde: 'ambos' },

  // ---- Locação ----
  { chave: 'rent_price', rotulo: 'Valor do aluguel', exemplo: 'R$ 3.200,00', onde: 'locacao', obrigatorio: true },
  { chave: 'condo_fee', rotulo: 'Condomínio', exemplo: 'R$ 700,00', onde: 'locacao' },
  { chave: 'start_date', rotulo: 'Início da vigência', exemplo: '1 de setembro de 2026', onde: 'locacao', obrigatorio: true },
  { chave: 'end_date', rotulo: 'Fim da vigência', exemplo: '31 de agosto de 2028', onde: 'locacao', obrigatorio: true },
  { chave: 'notice_period_days', rotulo: 'Aviso prévio (dias)', exemplo: '30', onde: 'locacao' },

  // ---- Venda ----
  { chave: 'sale_price', rotulo: 'Valor da venda', exemplo: 'R$ 850.000,00', onde: 'venda', obrigatorio: true },
  { chave: 'down_payment', rotulo: 'Sinal', exemplo: 'R$ 85.000,00', onde: 'venda', obrigatorio: true },
  { chave: 'financing_type', rotulo: 'Forma de pagamento', exemplo: 'financiado', onde: 'venda', obrigatorio: true },
  { chave: 'itbi_status', rotulo: 'Situação do ITBI', exemplo: 'pendente', onde: 'venda' },

  // ---- Documento ----
  { chave: 'today', rotulo: 'Data de hoje', exemplo: '16 de agosto de 2026', onde: 'ambos' },
]

export const CHAVES_VALIDAS = new Set(PLACEHOLDERS.map((p) => p.chave))

/** Todos os `{{...}}` que aparecem no texto, na ordem. */
export function extrairPlaceholders(corpo: string): string[] {
  return [...corpo.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1])
}

export interface AnalisePlaceholders {
  usados: string[]
  /** Escritos no template e que o sistema não sabe preencher. */
  desconhecidos: string[]
  /** Do tipo errado — `{{rent_price}}` num contrato de venda. */
  foraDeContexto: string[]
  /** Obrigatórios do tipo que o template esqueceu. */
  faltando: string[]
}

export function analisarTemplate(
  corpo: string,
  dealType: 'locacao' | 'venda'
): AnalisePlaceholders {
  const usados = [...new Set(extrairPlaceholders(corpo))]

  /* Placeholder desconhecido é o defeito mais caro deste arquivo: hoje ele sai
     no PDF como `[valor_aluguel]`, literal, dentro de um documento legal que
     vai para o cliente. Melhor barrar na hora de salvar. */
  const desconhecidos = usados.filter((c) => !CHAVES_VALIDAS.has(c))

  const foraDeContexto = usados.filter((c) => {
    const p = PLACEHOLDERS.find((x) => x.chave === c)
    return p && p.onde !== 'ambos' && p.onde !== dealType
  })

  const faltando = PLACEHOLDERS.filter(
    (p) => p.obrigatorio && (p.onde === 'ambos' || p.onde === dealType) && !usados.includes(p.chave)
  ).map((p) => p.chave)

  return { usados, desconhecidos, foraDeContexto, faltando }
}

/** Preenche com os exemplos — a prévia da tela, sem tocar em dado real. */
export function previewComExemplos(corpo: string): string {
  const exemplos = Object.fromEntries(PLACEHOLDERS.map((p) => [p.chave, p.exemplo]))
  return corpo.replace(/\{\{(\w+)\}\}/g, (_o, chave: string) => exemplos[chave] ?? `[${chave}]`)
}
