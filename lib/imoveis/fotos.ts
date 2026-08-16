// ==========================================
// Fotos do imóvel: ordem, capa e remoção.
//
// Fora da rota HTTP para ser testável sem subir sessão — mesma razão de
// lib/registrations/conferencia.ts e lib/conversas/takeover.ts.
//
// A CAPA É O ÍNDICE 0. Não existe coluna "is_cover": o card da vitrine e a
// imagem do Open Graph já leem `photos[0]`, e um sinalizador à parte criaria
// dois lugares para a mesma verdade, com o risco clássico de divergirem.
// Definir capa é mover para o começo.
// ==========================================

import { createAdminClient } from '@/lib/supabase/admin'

export const BUCKET_IMOVEIS = 'imoveis'
export const MAX_FOTOS = 20
export const MAX_BYTES_FOTO = 5 * 1024 * 1024
export const TIPOS_FOTO = ['image/jpeg', 'image/png', 'image/webp']

export type ResultadoFotos =
  | { ok: true; fotos: string[]; removidas: number }
  | { ok: false; erro: string; status: number }

/** Caminho no bucket a partir da URL pública. */
export function caminhoDaUrl(url: string): string | null {
  const marca = `/object/public/${BUCKET_IMOVEIS}/`
  const i = url.indexOf(marca)
  if (i === -1) return null
  const caminho = url.slice(i + marca.length)
  return caminho ? decodeURIComponent(caminho) : null
}

/**
 * Aplica a lista inteira: ordem, capa e remoção saem daqui.
 *
 * Receber o array completo em vez de operações separadas evita estado
 * intermediário inconsistente — não existe "removi mas ainda não reordenei".
 */
export async function salvarOrdemFotos(
  propertyId: string,
  novas: string[]
): Promise<ResultadoFotos> {
  const supabase = createAdminClient()

  const { data: imovel } = await supabase
    .from('properties')
    .select('id, reference_code, photos')
    .eq('id', propertyId)
    .maybeSingle()

  if (!imovel) return { ok: false, erro: 'Imóvel não encontrado.', status: 404 }

  const atuais = (imovel.photos ?? []) as string[]
  const semRepetir = [...new Set(novas)]

  /* Só reordena e remove o que JÁ ERA do imóvel. Aceitar URL de fora deixaria
     alguém apontar a foto para um endereço qualquer — e essas imagens são
     renderizadas na VITRINE PÚBLICA, para quem nunca fez login. */
  const forasteiras = semRepetir.filter((f) => !atuais.includes(f))
  if (forasteiras.length) {
    return {
      ok: false,
      erro: 'Só é possível reordenar ou remover fotos já enviadas.',
      status: 400,
    }
  }

  const removidas = atuais.filter((f) => !semRepetir.includes(f))

  const { error } = await supabase
    .from('properties')
    .update({ photos: semRepetir, updated_at: new Date().toISOString() })
    .eq('id', propertyId)

  if (error) {
    console.error('[fotos] gravação falhou:', error.message)
    return { ok: false, erro: 'Não foi possível salvar.', status: 500 }
  }

  /* O arquivo é apagado DEPOIS da linha: na ordem inversa, uma falha ao gravar
     deixaria o imóvel apontando para uma imagem que já não existe — quebrado na
     vitrine. Assim o pior caso é um arquivo órfão, que não aparece para ninguém. */
  if (removidas.length) {
    const caminhos = removidas.map(caminhoDaUrl).filter((c): c is string => Boolean(c))
    if (caminhos.length) {
      const { error: erroStorage } = await supabase.storage.from(BUCKET_IMOVEIS).remove(caminhos)
      if (erroStorage) console.error('[fotos] arquivos não removidos:', erroStorage.message)
    }
  }

  return { ok: true, fotos: semRepetir, removidas: removidas.length }
}

/** Sobe fotos novas e as acrescenta ao fim da lista (a capa não muda sozinha). */
export async function adicionarFotos(
  propertyId: string,
  arquivos: File[]
): Promise<ResultadoFotos> {
  const supabase = createAdminClient()

  const { data: imovel } = await supabase
    .from('properties')
    .select('id, reference_code, photos')
    .eq('id', propertyId)
    .maybeSingle()

  if (!imovel) return { ok: false, erro: 'Imóvel não encontrado.', status: 404 }
  if (!arquivos.length) return { ok: false, erro: 'Escolha ao menos uma foto.', status: 400 }

  const atuais = (imovel.photos ?? []) as string[]
  if (atuais.length + arquivos.length > MAX_FOTOS) {
    return {
      ok: false,
      erro: `Máximo de ${MAX_FOTOS} fotos por imóvel (já tem ${atuais.length}).`,
      status: 400,
    }
  }

  const enviadas: string[] = []

  async function desfazer() {
    const caminhos = enviadas.map(caminhoDaUrl).filter((c): c is string => Boolean(c))
    if (caminhos.length) await supabase.storage.from(BUCKET_IMOVEIS).remove(caminhos)
  }

  for (const [i, arquivo] of arquivos.entries()) {
    /* Validação no servidor mesmo com o bucket restringindo: o que o navegador
       manda não é confiável, e a mensagem de erro do storage não serve para
       mostrar a ninguém. */
    if (!TIPOS_FOTO.includes(arquivo.type)) {
      await desfazer()
      return { ok: false, erro: 'Envie apenas JPG, PNG ou WebP.', status: 400 }
    }
    if (arquivo.size > MAX_BYTES_FOTO) {
      await desfazer()
      return { ok: false, erro: 'Cada foto precisa ter no máximo 5 MB.', status: 400 }
    }

    const extensao = arquivo.type.split('/')[1].replace('jpeg', 'jpg')
    /* Nome gerado, nunca o do upload: nome de arquivo pode trazer barra, `..`
       ou caracteres que quebram o caminho no storage. */
    const caminho = `${propertyId}/${Date.now()}-${i}.${extensao}`

    const { error } = await supabase.storage
      .from(BUCKET_IMOVEIS)
      .upload(caminho, arquivo, { contentType: arquivo.type, upsert: false })

    if (error) {
      /* Metade das fotos gravada e a outra metade perdida no bucket é pior do
         que nenhuma: desfaz o que subiu nesta rodada. */
      await desfazer()
      console.error('[fotos] upload falhou:', error.message)
      return { ok: false, erro: 'Falha ao enviar as fotos.', status: 500 }
    }

    enviadas.push(supabase.storage.from(BUCKET_IMOVEIS).getPublicUrl(caminho).data.publicUrl)
  }

  const todas = [...atuais, ...enviadas]
  const { error } = await supabase
    .from('properties')
    .update({ photos: todas, updated_at: new Date().toISOString() })
    .eq('id', propertyId)

  if (error) {
    await desfazer()
    return { ok: false, erro: 'Não foi possível salvar as fotos.', status: 500 }
  }

  console.log(`[fotos] ${enviadas.length} foto(s) em ${imovel.reference_code}`)
  return { ok: true, fotos: todas, removidas: 0 }
}
