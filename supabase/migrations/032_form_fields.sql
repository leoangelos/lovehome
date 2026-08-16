-- ==========================================
-- 032 — Formulario configuravel (PRD 6.5, Marco 4)
--
-- O formulario publico de cadastro tinha campos fixos no componente. Esta
-- migration permite que o admin acrescente perguntas PROPRIAS sem deploy.
--
-- O que NAO fica configuravel, e por que: CPF, nome, e-mail, endereco e papel
-- sao o que define `registration_status = 'completo'` no gate da secao 6.3.
-- Torna-los opcionais pela tela deixaria alguem agendar visita e assinar
-- contrato sem os dados que sustentam o contrato — o portao continuaria
-- dizendo "completo" sobre um cadastro que nao esta. Por isso os campos extras
-- sao ADICIONAIS: eles nunca participam da decisao do gate.
-- ==========================================

CREATE TABLE form_fields (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Os dois formularios publicos que existem hoje.
  form_type TEXT NOT NULL DEFAULT 'cadastro'
    CHECK (form_type IN ('cadastro', 'listagem_imovel')),

  -- Identificador da resposta dentro de `registrations.extra`. Imutavel na
  -- pratica: mudar a chave depois de coletar orfanaria as respostas antigas.
  chave TEXT NOT NULL,

  rotulo TEXT NOT NULL,
  ajuda TEXT,

  tipo TEXT NOT NULL DEFAULT 'texto'
    CHECK (tipo IN ('texto', 'texto_longo', 'numero', 'escolha', 'multipla', 'sim_nao', 'data')),

  -- Só para 'escolha' e 'multipla'. Lista de strings.
  opcoes JSONB NOT NULL DEFAULT '[]'::jsonb,

  obrigatorio BOOLEAN NOT NULL DEFAULT false,

  -- Se preenchido, o campo só aparece quando a pessoa marca um destes papeis.
  -- Vazio = sempre visivel. Campo invisivel NUNCA é cobrado como obrigatorio.
  papeis JSONB NOT NULL DEFAULT '[]'::jsonb,

  posicao INTEGER NOT NULL DEFAULT 0,

  -- Desativar para de perguntar sem apagar as respostas ja coletadas.
  is_active BOOLEAN NOT NULL DEFAULT true,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(form_type, chave)
);

CREATE INDEX idx_form_fields_ativos ON form_fields(form_type, is_active, posicao);

-- As respostas dos campos extras. Uma coluna, e nao tabela chave/valor: sao
-- lidas sempre inteiras junto do cadastro, nunca agregadas entre pessoas.
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS extra JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN registrations.extra IS
  'Respostas dos campos configuraveis (form_fields). Nunca participa do gate de cadastro da secao 6.3.';

ALTER TABLE form_fields ENABLE ROW LEVEL SECURITY;
-- Deny-all para anon: a definicao do formulario é lida pelo servidor com
-- service_role, junto da validacao do token. Publicar em anon exporia quais
-- perguntas a imobiliaria faz — e a lista de campos inativos.
