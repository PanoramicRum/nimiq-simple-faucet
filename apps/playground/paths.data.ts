/**
 * Build-time data loader — reads adventure data from START.md frontmatter.
 * Single source of truth: edit START.md, playground picks it up automatically.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

interface Adventure {
  number: number
  icon: string
  title: string
  time: string
  details: string
  docs: string
  link: string
}

interface StartData {
  title: string
  tagline: string
  adventures: Adventure[]
}

export default {
  load(): StartData {
    const startPath = resolve(__dirname, '../../START.md')
    const raw = readFileSync(startPath, 'utf-8')

    // Extract YAML frontmatter between --- delimiters
    const match = raw.match(/^---\n([\s\S]*?)\n---/)
    if (!match) throw new Error('START.md is missing YAML frontmatter')

    // Simple YAML parser for the flat + array structure we use
    return parseStartFrontmatter(match[1])
  },
}

function parseStartFrontmatter(yaml: string): StartData {
  const lines = yaml.split('\n')
  let title = ''
  let tagline = ''
  const adventures: Adventure[] = []
  let current: Partial<Adventure> | null = null

  for (const line of lines) {
    // Top-level scalar fields
    if (line.startsWith('title:')) {
      title = unquote(line.slice('title:'.length).trim())
    } else if (line.startsWith('tagline:')) {
      tagline = unquote(line.slice('tagline:'.length).trim())
    } else if (line.startsWith('  - number:')) {
      // New adventure item
      if (current) adventures.push(current as Adventure)
      current = { number: parseInt(line.split(':')[1].trim(), 10) }
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
  if (current) adventures.push(current as Adventure)

  return { title, tagline, adventures }
}

function unquote(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))
    return s.slice(1, -1)
  return s
}
