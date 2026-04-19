/**
 * Build-time data loader — reads SDK data from frameworks/index.md frontmatter.
 * Single source of truth: edit frameworks/index.md, playground picks it up.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

interface Sdk {
  name: string
  icon: string
  package: string
  install: string
  category: string
  link: string
}

export interface SdkData {
  sdks: Sdk[]
}

export default {
  load(): SdkData {
    const filePath = resolve(__dirname, 'frameworks/index.md')
    const raw = readFileSync(filePath, 'utf-8')

    const match = raw.match(/^---\n([\s\S]*?)\n---/)
    if (!match) throw new Error('frameworks/index.md is missing YAML frontmatter')

    return parseSdkFrontmatter(match[1])
  },
}

function parseSdkFrontmatter(yaml: string): SdkData {
  const lines = yaml.split('\n')
  const sdks: Sdk[] = []
  let current: Partial<Sdk> | null = null

  for (const line of lines) {
    if (line.startsWith('  - name:')) {
      if (current) sdks.push(current as Sdk)
      current = { name: unquote(line.split(':').slice(1).join(':').trim()) }
    } else if (current && line.startsWith('    ')) {
      const trimmed = line.trim()
      const colonIdx = trimmed.indexOf(':')
      if (colonIdx > 0) {
        const key = trimmed.slice(0, colonIdx).trim()
        const val = unquote(trimmed.slice(colonIdx + 1).trim())
        ;(current as Record<string, string>)[key] = val
      }
    }
  }
  if (current) sdks.push(current as Sdk)

  return { sdks }
}

function unquote(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))
    return s.slice(1, -1)
  return s
}
