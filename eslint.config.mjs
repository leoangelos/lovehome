import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
  ]),

  /* ======================================================================
     Componente de cliente não importa módulo de servidor.

     Importar UMA constante de `lib/queries/*`, `lib/agents/*` ou
     `lib/rag/retriever` arrasta o módulo inteiro para o bundle do navegador —
     e com ele `createAdminClient` ou, pior, o cliente da OpenAI, que é
     construído no escopo do módulo e QUEBRA a página com "It looks like you're
     running in a browser-like environment".

     Foi assim que a tela de Agentes quebrou: `MODELOS` vinha de
     `lib/agents/registro`, que importa os prompts, que importam `base-agent`,
     que importa o cliente da OpenAI.

     Rótulos e listas para a interface moram em `lib/ui/rotulos.ts`, que não
     importa nada. Tipo pode vir de qualquer lugar (`import type` é apagado na
     compilação) — por isso a regra usa `allowTypeImports`.
     ====================================================================== */
  {
    /* Só `components/`: as páginas em `app/` são server components por padrão
       e importam módulos de servidor de propósito. Os cinco componentes sem
       'use client' aqui (AppHeader, BarList, ChartCard, StatCard, StatusBadge)
       são de apresentação e não importam nada disso. */
    files: ['components/**/*.tsx'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@/lib/queries/*',
                '@/lib/agents/*',
                '@/lib/rag/*',
                '@/lib/channels/*',
                '@/lib/supabase/admin',
                '@/lib/openai/*',
                '@/lib/observabilidade/*',
                '@/lib/pipeline/*',
                '@/lib/conversas/*',
                '@/lib/leads/*',
                '@/lib/imoveis/*',
                '@/lib/leasing/*',
                // `placeholders` é leaf sem dependência: o catálogo de campos do
                // contrato é lido pelo preenchimento (servidor) e pelo editor de
                // modelos (navegador). Fonte única dos dois lados.
                '!@/lib/leasing/placeholders',
                '@/lib/registrations/*',
                // `cpf-formato` é leaf sem dependência: o formulário público
                // valida o dígito enquanto a pessoa digita, e isso é navegador.
                '!@/lib/registrations/cpf-formato',
                // `campos-formato` também: a MESMA validação roda no navegador
                // (mostrar o erro antes de enviar) e no servidor (a que vale).
                '!@/lib/registrations/campos-formato',
                '@/lib/documentos/*',
                '@/lib/widget/*',
                '@/lib/followup/*',
              ],
              allowTypeImports: true,
              message:
                'Componente não importa valor de módulo de servidor — o bundle do navegador levaria junto o cliente da OpenAI/Supabase. Rótulos e listas: @/lib/ui/rotulos. Tipos podem, com `import type`.',
            },
          ],
        },
      ],
    },
  },
])

export default eslintConfig
