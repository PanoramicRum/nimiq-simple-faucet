/**
 * Build-time data loader — reads example data from examples/index.md frontmatter.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

interface Example {
  name: string
  icon: string
  framework: string
  details: string
  link: string
}

export interface ExampleData {
  examples: Example[]
}

export default {
  load(): ExampleData {
    const filePath = resolve(__dirname, 'examples/index.md')
    const raw = readFileSync(filePath, 'utf-8')

    const match = raw.match(/^---\n([\s\S]*?)\n---/)
    if (!match) throw new Error('examples/index.md is missing YAML frontmatter')

    return parseExamplesFrontmatter(match[1])
  },
}

function parseExamplesFrontmatter(yaml: string): ExampleData {
  const lines = yaml.split('\n')
  const examples: Example[] = []
  let current: Partial<Example> | null = null

  for (const line of lines) {
    if (line.startsWith('  - name:')) {
      if (current) examples.push(current as Example)
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
  if (current) examples.push(current as Example)

  return { examples }
}

function unquote(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))
    return s.slice(1, -1)
  return s
}
