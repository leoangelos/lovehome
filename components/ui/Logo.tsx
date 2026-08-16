import Image from 'next/image'

/* A marca aparece em três shells (vitrine, painel e login) e estava duplicada
 * como `<img>` nos três — o que também rendia três avisos de lint.
 *
 * `unoptimized` porque o arquivo é um SVG local: o otimizador do Next recusa
 * SVG a menos que `dangerouslyAllowSVG` seja ligado no next.config, e essa flag
 * é global — valeria para qualquer SVG, inclusive remoto, que é exatamente o
 * caso perigoso que o nome dela adverte. Um SVG de 32px também não tem o que
 * otimizar. O que se ganha do `next/image` aqui é o resto: dimensão explícita,
 * sem deslocamento de layout enquanto carrega.
 */
export function Logo({ tamanho = 32 }: { tamanho?: number }) {
  return (
    <Image
      src="/icon.svg"
      alt="LoveHome"
      width={tamanho}
      height={tamanho}
      unoptimized
      priority
      className="rounded-lg shadow-sm flex-shrink-0"
    />
  )
}
