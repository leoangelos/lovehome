import { redirect } from 'next/navigation'

/* A raiz e a vitrine: o link que circula por WhatsApp aponta para o imovel, e
   quem chega pelo dominio nu deve cair no catalogo, nao numa tela de login. */
export default function Home() {
  redirect('/imoveis')
}
