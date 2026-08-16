// ==========================================
// RAG Chunker — splits documents into chunks
// ==========================================

export interface Chunk {
  content: string
  chunkIndex: number
  tokenCount: number
  metadata: Record<string, unknown>
}

interface ChunkOptions {
  maxTokens?: number
  overlap?: number
  separators?: string[]
}

/**
 * Rough token count estimation (1 token ≈ 4 chars for Portuguese)
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Split text by the first available separator
 */
function splitBySeparator(text: string, separators: string[]): string[] {
  for (const separator of separators) {
    const parts = text.split(separator)
    if (parts.length > 1) {
      return parts.map((p, i) => 
        i < parts.length - 1 ? p + separator : p
      ).filter(p => p.trim().length > 0)
    }
  }
  // Fallback: split by sentences
  const sentences = text.match(/[^.!?]+[.!?]+/g)
  if (sentences && sentences.length > 1) {
    return sentences
  }
  // Last resort: split by character count
  return [text]
}

/**
 * Chunks a document into overlapping segments respecting separators
 */
export function chunkDocument(text: string, options?: ChunkOptions): Chunk[] {
  const maxTokens = options?.maxTokens ?? 400
  const overlap = options?.overlap ?? 50
  const separators = options?.separators ?? ['\n\n', '\n', '. ']

  // Clean up text
  const cleanText = text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  if (!cleanText) return []

  // Split into initial segments
  const segments = splitBySeparator(cleanText, separators)
  
  const chunks: Chunk[] = []
  let currentContent = ''
  let chunkIndex = 0

  for (const segment of segments) {
    const segmentTokens = estimateTokens(segment)
    const currentTokens = estimateTokens(currentContent)

    // If adding this segment exceeds maxTokens, finalize current chunk
    if (currentTokens + segmentTokens > maxTokens && currentContent.trim()) {
      chunks.push({
        content: currentContent.trim(),
        chunkIndex,
        tokenCount: estimateTokens(currentContent.trim()),
        metadata: detectMetadata(currentContent.trim(), chunkIndex),
      })
      chunkIndex++

      // Overlap: keep the last portion of the current content
      const overlapChars = overlap * 4
      if (currentContent.length > overlapChars) {
        currentContent = currentContent.slice(-overlapChars)
      }
    }

    // If a single segment is too large, split it further
    if (segmentTokens > maxTokens) {
      if (currentContent.trim()) {
        chunks.push({
          content: currentContent.trim(),
          chunkIndex,
          tokenCount: estimateTokens(currentContent.trim()),
          metadata: detectMetadata(currentContent.trim(), chunkIndex),
        })
        chunkIndex++
        currentContent = ''
      }

      // Split the large segment by character
      const maxChars = maxTokens * 4
      for (let i = 0; i < segment.length; i += maxChars - (overlap * 4)) {
        const slice = segment.slice(i, i + maxChars)
        if (slice.trim()) {
          chunks.push({
            content: slice.trim(),
            chunkIndex,
            tokenCount: estimateTokens(slice.trim()),
            metadata: detectMetadata(slice.trim(), chunkIndex),
          })
          chunkIndex++
        }
      }
      currentContent = ''
    } else {
      currentContent += segment
    }
  }

  // Final chunk
  if (currentContent.trim()) {
    chunks.push({
      content: currentContent.trim(),
      chunkIndex,
      tokenCount: estimateTokens(currentContent.trim()),
      metadata: detectMetadata(currentContent.trim(), chunkIndex),
    })
  }

  return chunks
}

/**
 * Detect section titles and page markers if present
 */
function detectMetadata(text: string, index: number): Record<string, unknown> {
  const metadata: Record<string, unknown> = { chunkPosition: index }

  // Detect titles (lines ending with ":")  or starting with "#"
  const titleMatch = text.match(/^(#{1,3}\s+.+|.+:)\s*$/m)
  if (titleMatch) {
    metadata.sectionTitle = titleMatch[1].replace(/^#+\s*/, '').trim()
  }

  // Detect page markers
  const pageMatch = text.match(/\[?[Pp]ágina?\s*(\d+)\]?/i)
  if (pageMatch) {
    metadata.page = parseInt(pageMatch[1])
  }

  // Detect module markers
  const moduleMatch = text.match(/[Mm]ódulo\s+(\d+)/i)
  if (moduleMatch) {
    metadata.module = parseInt(moduleMatch[1])
  }

  return metadata
}
