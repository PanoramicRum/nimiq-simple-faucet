/**
 * Build-time data loader — reads abuse layer data from docs/abuse-layers/README.md frontmatter.
 * Single source of truth: edit docs/abuse-layers/README.md, playground picks it up.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

interface AbuseLayer {
  number: number
  icon: string
  name: string
  details: string
  enabledBy: string
  link: string
}

export interface AbuseLayerData {
  layers: AbuseLayer[]
}

export default {
  load(): AbuseLayerData {
    const filePath = resolve(__dirname, '../../docs/abuse-layers/README.md')
    const raw = readFileSync(filePath, 'utf-8')

    const match = raw.match(/^---\n([\s\S]*?)\n---/)
    if (!match) throw new Error('docs/abuse-layers/README.md is missing YAML frontmatter')

    return parseLayersFrontmatter(match[1])
  },
}

function parseLayersFrontmatter(yaml: string): AbuseLayerData {
  const lines = yaml.split('\n')
  const layers: AbuseLayer[] = []
  let current: Partial<AbuseLayer> | null = null

  for (const line of lines) {
    if (line.startsWith('  - number:')) {
      if (current) layers.push(current as AbuseLayer)
      current = { number: parseInt(line.split(':').slice(1).join(':').trim(), 10) }
    } else if (current && line.startsWith('    ')) {
      const trimmed = line.trim()
      const colonIdx = trimmed.indexOf(':')
      if (colonIdx > 0) {
        const key = trimmed.slice(0, colonIdx).trim()
        const val = unquote(trimmed.slice(colonIdx + 1).trim())
        ;(current as Record<string, string | number>)[key] = key === 'number' ? parseInt(val, 10) : val
      }
    }
  }
  if (current) layers.push(current as AbuseLayer)

  return { layers }
}

function unquote(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))
    return s.slice(1, -1)
  return s
}
