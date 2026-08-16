import { NextResponse } from 'next/server'
import { autorizarApi } from '@/lib/auth/session'
import { documentoDaCarteira } from '@/lib/auth/carteira'
import { createAdminClient } from '@/lib/supabase/admin'

/* Link de download do documento do cliente.
 *
 * O bucket é privado — RG, CNH e comprovante de renda não podem ficar
 * acessíveis por URL adivinhável. A assinatura vale 5 minutos: o suficiente
 * para abrir, não para virar link compartilhável. */

export const dynamic = 'force-dynamic'

const VALIDADE_SEGUNDOS = 300

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await autorizarApi('documentos')
  if ('erro' in auth) return NextResponse.json({ erro: auth.erro }, { status: auth.status })

  const { id } = await params

  /* Recorte por carteira (§9.3): `autorizarApi` responde se o PAPEL pode;

     isto responde se ESTE corretor pode mexer NESTE item. */

  const recorte = await documentoDaCarteira(id, auth.sessao)

  if (!recorte.ok) return NextResponse.json({ erro: recorte.erro }, { status: recorte.status })
  const supabase = createAdminClient()

  const { data: documento } = await supabase
    .from('documents')
    .select('storage_path')
    .eq('id', id)
    .maybeSingle()

  if (!documento) return NextResponse.json({ erro: 'Documento não encontrado.' }, { status: 404 })

  /* Documento registrado sem arquivo: a pessoa disse que enviou, mas o download
     falhou ou ela mandou antes de haver o quê anexar. A tela mostra isso em vez
     de oferecer um link que não abre. */
  if (documento.storage_path.startsWith('whatsapp://')) {
    return NextResponse.json(
      { erro: 'Este documento não tem arquivo guardado — abra a conversa no WhatsApp.' },
      { status: 404 }
    )
  }

  const { data: url } = await supabase.storage
    .from('documentos')
    .createSignedUrl(documento.storage_path, VALIDADE_SEGUNDOS)

  if (!url) return NextResponse.json({ erro: 'Não foi possível gerar o link.' }, { status: 500 })

  return NextResponse.json({ url: url.signedUrl })
}
