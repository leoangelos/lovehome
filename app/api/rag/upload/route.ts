import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { autorizarApi } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'
import { indexarMaterial } from '@/lib/rag/indexar'
import { tipoDoArquivo, TIPOS_ACEITOS } from '@/lib/rag/extrair'
import { CATEGORIAS } from '@/lib/rag/retriever'

/* Upload e indexação de material institucional (PRD 11.1).
 *
 * Autenticado: `materiais` + `editar` — na matriz da §9.2 isso é admin e
 * editor. O que entra aqui vira resposta que o agente dá a cliente, então não é
 * upload público nem coisa que corretor faz sozinho.
 *
 * A linha em `rag_documents` nasce ANTES da indexação, com status
 * 'processando'. Se a extração falhar, o material aparece na tela com o motivo
 * do erro em vez de sumir e deixar quem enviou sem saber o que houve. */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_BYTES = 20 * 1024 * 1024

export async function POST(request: Request) {
  const auth = await autorizarApi('materiais', 'editar')
  if ('erro' in auth) return NextResponse.json({ erro: auth.erro }, { status: auth.status })

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ erro: 'Requisição inválida.' }, { status: 400 })
  }

  const arquivo = form.get('arquivo') as File | null
  const titulo = String(form.get('titulo') ?? '').trim()
  const categoria = String(form.get('categoria') ?? 'geral')

  if (!arquivo) return NextResponse.json({ erro: 'Escolha um arquivo.' }, { status: 400 })
  if (!titulo) return NextResponse.json({ erro: 'Dê um título ao material.' }, { status: 400 })

  if (!CATEGORIAS.includes(categoria as never)) {
    return NextResponse.json({ erro: 'Categoria inválida.' }, { status: 400 })
  }

  const tipo = tipoDoArquivo(arquivo.name)
  if (!TIPOS_ACEITOS.includes(tipo as never)) {
    return NextResponse.json(
      { erro: `Formato .${tipo} não é aceito. Envie PDF, TXT ou Markdown.` },
      { status: 400 }
    )
  }

  if (arquivo.size > MAX_BYTES) {
    return NextResponse.json({ erro: 'O arquivo passa de 20 MB.' }, { status: 400 })
  }

  const supabase = createAdminClient()
  const buffer = Buffer.from(await arquivo.arrayBuffer())

  /* Nome gerado, nunca o do upload: nome de arquivo pode trazer barra, `..` ou
     caracteres que quebram o caminho no storage. O original fica na coluna
     `file_name`, que é onde ele serve — para a pessoa reconhecer o material. */
  const caminho = `${categoria}/${crypto.randomUUID()}.${tipo}`

  const { error: erroUpload } = await supabase.storage
    .from('materiais')
    .upload(caminho, buffer, { contentType: arquivo.type || 'application/octet-stream' })

  if (erroUpload) {
    console.error('[rag/upload] storage falhou:', erroUpload.message)
    return NextResponse.json({ erro: 'Falha ao guardar o arquivo.' }, { status: 500 })
  }

  const { data: documento, error: erroDoc } = await supabase
    .from('rag_documents')
    .insert({
      title: titulo,
      categoria,
      file_name: arquivo.name,
      file_type: tipo,
      file_size: arquivo.size,
      storage_path: caminho,
      status: 'processando',
      created_by: auth.sessao.userId,
    })
    .select('id')
    .single()

  if (erroDoc || !documento) {
    await supabase.storage.from('materiais').remove([caminho])
    return NextResponse.json({ erro: 'Não foi possível registrar o material.' }, { status: 500 })
  }

  /* Indexação SÍNCRONA, e não em `after()`. A pessoa acabou de subir um arquivo
     e precisa saber se ele serviu — em `after()` a resposta voltaria "ok" e o
     erro de extração só apareceria num refresh que ninguém faz. O teto de 60s
     da Vercel comporta material institucional; PDF gigante volta com erro claro
     em vez de silêncio. */
  const r = await indexarMaterial({
    documentId: documento.id,
    buffer,
    nomeArquivo: arquivo.name,
  })

  if (!r.ok) {
    console.log(`[rag/upload] ${auth.sessao.email} enviou ${arquivo.name} — falhou: ${r.erro}`)
    return NextResponse.json({ erro: r.erro, documentId: documento.id }, { status: 422 })
  }

  console.log(`[rag/upload] ${auth.sessao.email} indexou "${titulo}" (${r.chunks} trechos)`)
  return NextResponse.json({ ok: true, documentId: r.documentId, trechos: r.chunks })
}
