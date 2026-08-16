// ==========================================
// Matriz de permissões do painel (PRD 9.2).
//
// ATENÇÃO — este arquivo é o ponto de aplicação real, não a RLS.
// O painel lê pelo service_role (lib/supabase/admin.ts), que IGNORA row level
// security. As policies da migration 009/010 continuam valendo como defesa em
// profundidade caso a chave anon vaze, mas NÃO barram nada aqui dentro. Quem
// autoriza é este módulo, chamado no servidor a cada página e rota.
//
// Corolário prático: esconder item de menu é conveniência, nunca proteção.
// Toda tela precisa chamar exigirAcesso() no servidor.
// ==========================================

export type Role = 'admin' | 'corretor' | 'editor' | 'viewer'

export type Recurso =
  | 'dashboard'
  | 'painel'
  | 'conversas'
  | 'leads'
  | 'resumos'
  | 'imoveis'
  | 'proprietarios'
  | 'visitas'
  | 'contratos'
  | 'pagamentos'
  | 'documentos'
  | 'formularios'
  | 'corretores'
  | 'copiloto'
  | 'agentes'
  | 'canais'
  | 'materiais'
  | 'configuracoes'
  | 'uso'
  | 'usuarios'

/* A fonte da expansão de `'tudo'`. Um recurso novo precisa entrar aqui também
   — se esquecer, o admin deixa de receber a ferramenta correspondente no
   Copiloto, o que é o lado seguro do erro. */
export const TODOS_OS_RECURSOS: Recurso[] = [
  'dashboard',
  'painel',
  'conversas',
  'leads',
  'resumos',
  'imoveis',
  'proprietarios',
  'visitas',
  'contratos',
  'pagamentos',
  'documentos',
  'formularios',
  'corretores',
  'copiloto',
  'agentes',
  'canais',
  'materiais',
  'configuracoes',
  'uso',
  'usuarios',
]

export type Acao = 'ver' | 'editar'

/* Cada papel lista o que pode VER e, dentro disso, o que pode EDITAR.
   Editar sem ver é incoerente e o `pode()` trata como erro de configuração. */
interface Permissoes {
  ver: Recurso[] | 'tudo'
  editar: Recurso[] | 'tudo'
}

const MATRIZ: Record<Role, Permissoes> = {
  /* Admin sempre tem acesso a tudo — inclusive a recursos criados depois deste
     arquivo. Por isso 'tudo' em vez de uma lista: lista precisaria ser lembrada
     a cada recurso novo, e o esquecimento tiraria acesso do admin em silêncio. */
  admin: { ver: 'tudo', editar: 'tudo' },

  /* Corretor: opera a própria carteira. O recorte por corretor NÃO está aqui —
     é filtro de consulta (ver `escopoProprio`). Esta matriz diz a QUE telas ele
     chega; o escopo diz QUAIS LINHAS ele enxerga dentro delas. */
  corretor: {
    ver: [
      'dashboard',
      'painel',
      'conversas',
      'leads',
      'resumos',
      'imoveis',
      'visitas',
      'contratos',
      'documentos',
      'corretores',
      'copiloto',
    ],
    /* Revisa documento e aprova negócio: a seção 15.2 diz "um corretor/admin
       revisa os documents anexados e só então aprova". O escopo por carteira
       garante que ele só alcança os negócios dele. */
    editar: [
      'painel',
      'conversas',
      'visitas',
      'copiloto',
      'contratos',
      'documentos',
      // A policy properties_scope da §9.3 dá ao corretor FOR ALL nos imóveis
      // dele — a API filtra por broker_id para valer o mesmo recorte.
      'imoveis',
    ],
  },

  /* Editor cuida do acervo, não do comercial. Sem leads e sem contratos por
     decisão explícita da seção 9.2 — o que tira também o dashboard, que é feito
     de funil de leads e cobrança. */
  editor: {
    /* `copiloto` entra para todo papel: ele é um jeito de PERGUNTAR sobre o que
       a pessoa já pode abrir, e as ferramentas dele são filtradas por esta
       mesma matriz. Um editor pergunta do acervo e não alcança inadimplência,
       porque a tool de pagamentos nem é oferecida ao modelo. */
    ver: ['imoveis', 'proprietarios', 'materiais', 'copiloto'],
    editar: ['imoveis', 'proprietarios', 'materiais'],
  },

  /* Viewer lê a operação e não altera nada. Fica fora de canais (guarda
     credenciais cifradas), usuários e configurações. */
  viewer: {
    ver: [
      'dashboard',
      'painel',
      'conversas',
      'leads',
      'resumos',
      'imoveis',
      'proprietarios',
      'visitas',
      'contratos',
      'pagamentos',
      'documentos',
      'formularios',
      'corretores',
      'copiloto',
    ],
    editar: [],
  },
}

export function pode(role: Role, recurso: Recurso, acao: Acao = 'ver'): boolean {
  const p = MATRIZ[role]
  if (!p) return false

  const permitido = (lista: Recurso[] | 'tudo') => lista === 'tudo' || lista.includes(recurso)

  if (acao === 'ver') return permitido(p.ver)

  // Editar exige também poder ver — sem isso um papel poderia alterar o que
  // não consegue abrir, e a tela de edição quebraria ao carregar os dados.
  return permitido(p.editar) && permitido(p.ver)
}

/**
 * Tudo o que o papel pode VER, como lista concreta.
 *
 * `admin` é `'tudo'` na matriz de propósito — com lista, todo recurso novo
 * exigiria lembrar de incluí-lo. Aqui a lista precisa ser concreta (o Copiloto
 * decide quais ferramentas oferecer a partir dela), então `'tudo'` é expandido
 * para o enum inteiro no momento do uso.
 */
export function recursosVisiveis(role: Role): Recurso[] {
  const p = MATRIZ[role]
  if (!p) return []
  if (p.ver === 'tudo') return [...TODOS_OS_RECURSOS]
  return p.ver
}

/** Papéis cujas consultas devem ser filtradas pelo próprio corretor. */
export function escopoProprio(role: Role): boolean {
  return role === 'corretor'
}

/**
 * Primeira tela depois do login. Depende do papel: mandar um editor para o
 * dashboard renderizaria um 403 no rosto dele logo ao entrar, já que o
 * dashboard é feito de dados de lead e cobrança.
 */
export function rotaInicial(role: Role): string {
  if (pode(role, 'dashboard')) return '/admin/dashboard'
  if (pode(role, 'imoveis')) return '/admin/imoveis'
  return '/admin/perfil'
}

export const ROTULO_PAPEL: Record<Role, string> = {
  admin: 'Administrador',
  corretor: 'Corretor',
  editor: 'Editor',
  viewer: 'Visualização',
}

export const DESCRICAO_PAPEL: Record<Role, string> = {
  admin: 'Acesso total, incluindo convites, canais e configurações.',
  corretor: 'Atende a própria carteira: leads, visitas e contratos atribuídos a ele.',
  editor: 'Cuida do acervo de imóveis e dos materiais. Não vê leads nem contratos.',
  viewer: 'Lê a operação inteira e não altera nada.',
}

export const PAPEIS: Role[] = ['admin', 'corretor', 'editor', 'viewer']
