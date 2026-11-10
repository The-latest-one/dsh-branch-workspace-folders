import type { SessionNode } from './tree.ts'

export const SESSION_WATERMARK_BASE = 5
export const SESSION_WATERMARK_AUTO_MAX = 50

export function workspaceDisplayTitle(title: string, localizedDefault: string): string {
  return title === 'default-workspace' ? localizedDefault : title
}

export function displayTitle(
  node: { blank?: boolean; title?: string | null },
  t: (key: string) => string,
): string {
  return node.blank ? t('session.new') : node.title?.trim() || t('session.untitled')
}

export function sameRows(
  previous: { rowKeys: readonly string[] },
  next: { rowKeys: readonly string[] },
): boolean {
  return (
    previous.rowKeys.length === next.rowKeys.length &&
    previous.rowKeys.every((key, index) => key === next.rowKeys[index])
  )
}

export function intersects(
  row: { top: number; bottom: number; left: number; right: number },
  viewport: { top: number; bottom: number; left: number; right: number },
): boolean {
  return (
    row.bottom > viewport.top &&
    row.top < viewport.bottom &&
    row.right > viewport.left &&
    row.left < viewport.right
  )
}

export function watermarkRows(
  sessions: readonly SessionNode[],
  watermark: number,
): { rows: readonly SessionNode[]; hiddenCount: number } {
  let count = 0
  const rows = sessions.filter((session) => {
    if (session.blank) return true
    count += 1
    return count <= watermark
  })
  return { rows, hiddenCount: Math.max(0, sessions.length - rows.length) }
}

export function requiredWatermark(
  sessions: readonly SessionNode[],
  current: string | undefined,
  revealSessionId: string | undefined,
): number {
  let required = SESSION_WATERMARK_BASE
  let index = 0
  for (const session of sessions) {
    if (session.blank) continue
    index += 1
    if (
      (index <= SESSION_WATERMARK_AUTO_MAX &&
        (session.running ||
          session.runningSubagentCount > 0 ||
          session.pendingInteraction !== undefined ||
          session.completed ||
          session.id === current)) ||
      session.id === revealSessionId
    ) {
      required = index
    }
  }
  return required
}

export function raiseWatermarks(
  marks: Record<string, number>,
  required: Map<string, number>,
): Record<string, number> {
  let changed = false
  for (const [key, watermark] of required) {
    if (watermark > (marks[key] ?? SESSION_WATERMARK_BASE)) {
      changed = true
      break
    }
  }
  if (!changed) return marks

  const raised = { ...marks }
  for (const [key, watermark] of required) {
    if (watermark > (raised[key] ?? SESSION_WATERMARK_BASE)) {
      raised[key] = watermark
    }
  }
  return raised
}
