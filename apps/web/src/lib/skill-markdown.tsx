import * as React from 'react'

interface Block {
  type: 'paragraph' | 'code' | 'list' | 'heading' | 'table'
  content?: string
  lang?: string
  level?: number
  items?: string[]
}

function parseBlocks(raw: string): Block[] {
  const lines = raw.split('\n')
  const blocks: Block[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Fenced code block
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim()
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      i++ // skip closing ```
      blocks.push({ type: 'code', content: codeLines.join('\n'), lang })
      continue
    }

    // Heading (### level)
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/)
    if (headingMatch) {
      blocks.push({ type: 'heading', content: headingMatch[2], level: headingMatch[1].length })
      i++
      continue
    }

    // Bullet list
    if (line.startsWith('- ') || line.startsWith('* ')) {
      const items: string[] = []
      while (i < lines.length && (lines[i].startsWith('- ') || lines[i].startsWith('* '))) {
        items.push(lines[i].slice(2))
        i++
      }
      blocks.push({ type: 'list', items })
      continue
    }

    // Table (pipe-delimited)
    if (line.startsWith('|')) {
      const tableLines: string[] = []
      while (i < lines.length && lines[i].startsWith('|')) {
        tableLines.push(lines[i])
        i++
      }
      blocks.push({ type: 'table', content: tableLines.join('\n') })
      continue
    }

    // Blank line
    if (line.trim() === '') {
      i++
      continue
    }

    // Paragraph — collect until blank line or special block start
    const paraLines: string[] = []
    while (
      i < lines.length
      && lines[i].trim() !== ''
      && !lines[i].startsWith('```')
      && !lines[i].match(/^#{1,6}\s/)
      && !lines[i].startsWith('- ')
      && !lines[i].startsWith('* ')
      && !lines[i].startsWith('|')
    ) {
      paraLines.push(lines[i])
      i++
    }
    if (paraLines.length > 0) {
      blocks.push({ type: 'paragraph', content: paraLines.join(' ') })
    }
  }

  return blocks
}

export function renderSectionContent(raw: string): React.ReactNode {
  const blocks = parseBlocks(raw)

  return blocks.map((block, idx) => {
    switch (block.type) {
      case 'paragraph':
        return (
          <p key={idx} className="text-sm leading-7 text-clay-muted">
            {block.content}
          </p>
        )
      case 'code':
        return (
          <pre key={idx} className="overflow-x-auto rounded-xl border border-border/60 bg-background/55 px-3 py-3 text-xs leading-6">
            <code>{block.content}</code>
          </pre>
        )
      case 'list':
        return (
          <ul key={idx} className="list-disc list-inside space-y-1 text-sm leading-7 text-clay-muted">
            {block.items?.map((item, i) => <li key={i}>{item}</li>)}
          </ul>
        )
      case 'heading':
        return (
          <h4 key={idx} className="mb-1 mt-2 text-sm font-semibold text-foreground">
            {block.content}
          </h4>
        )
      case 'table':
        return (
          <pre key={idx} className="overflow-x-auto rounded-xl border border-border/60 bg-background/55 px-3 py-3 text-xs leading-6">
            <code>{block.content}</code>
          </pre>
        )
      default:
        return null
    }
  })
}
