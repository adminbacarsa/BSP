/** Marker embebido en reply del asistente (alineado con Functions). */
export const QUICK_REPLIES_MARKER_RE = /<!--COSP_QUICK_REPLIES:([\s\S]*?)-->/;

export function parseQuickRepliesMarker(text: string): { cleanText: string; replies: string[] } {
  const match = text.match(QUICK_REPLIES_MARKER_RE);
  if (!match) return { cleanText: text, replies: [] };
  try {
    const parsed = JSON.parse(match[1]) as unknown;
    const replies = Array.isArray(parsed)
      ? parsed.map((x) => String(x ?? '').trim()).filter((x) => x.length >= 2 && x.length <= 120)
      : [];
    return { cleanText: text.replace(QUICK_REPLIES_MARKER_RE, '').trim(), replies };
  } catch {
    return { cleanText: text.replace(QUICK_REPLIES_MARKER_RE, '').trim(), replies: [] };
  }
}

/** Detecta viñetas de menú (· / - **opción** / solo **título**). No convierte pasos numerados largos. */
export function parseQuickReplyLabel(line: string): string | null {
  const t = line.trim();
  if (!t) return null;

  // · sugerencia
  let m = t.match(/^[·∙•]\s+(.+)$/);
  if (m) {
    const label = m[1].replace(/\*\*/g, '').trim();
    if (label.length >= 3 && label.length <= 110) return label;
  }

  // - **Opción** | * **Opción** — detalle
  m = t.match(/^[-*•∙▪▸►]\s+\*\*([^*]+)\*\*(?:\s*[—–:\-].*)?$/);
  if (m) {
    const label = m[1].trim();
    if (label.length >= 3 && label.length <= 110) return label;
  }

  // Línea solo con **título corto** (menú sin viñeta)
  m = t.match(/^\*\*([^*]+)\*\*$/);
  if (m) {
    const label = m[1].trim();
    if (label.length >= 3 && label.length <= 80 && label.split(/\s+/).length <= 10) return label;
  }

  // 1. **Opción corta** (menú numerado de elección, no procedimiento con verbo largo)
  m = t.match(/^\d+[.)]\s+\*\*([^*]+)\*\*$/);
  if (m) {
    const label = m[1].trim();
    if (label.length >= 3 && label.length <= 80 && label.split(/\s+/).length <= 8) return label;
  }

  // - Opción corta sin negrita
  m = t.match(/^[-*•∙]\s+([^*\n]{3,90})$/);
  if (m) {
    const label = m[1].trim();
    if (label.length <= 90 && !/[.!?]$/.test(label) && label.split(/\s+/).length <= 12) {
      return label;
    }
  }

  return null;
}

export function extractQuickRepliesFromText(content: string): string[] {
  const { cleanText, replies: fromMarker } = parseQuickRepliesMarker(content);
  const lines = cleanText.replace(/\r\n/g, '\n').split('\n');
  const seen = new Set(fromMarker.map((r) => r.toLowerCase()));
  const replies = [...fromMarker];
  for (const line of lines) {
    const label = parseQuickReplyLabel(line);
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    replies.push(label);
  }
  return replies;
}

export function splitAssistantQuickReplies(content: string): { prose: string; replies: string[] } {
  const { cleanText, replies: fromMarker } = parseQuickRepliesMarker(content);
  const lines = cleanText.replace(/\r\n/g, '\n').split('\n');
  const replies: string[] = [...fromMarker];
  const proseLines: string[] = [];
  const seen = new Set(fromMarker.map((r) => r.toLowerCase()));
  for (const line of lines) {
    const label = parseQuickReplyLabel(line);
    if (label) {
      const key = label.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        replies.push(label);
      }
      continue;
    }
    proseLines.push(line);
  }
  const prose = proseLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { prose, replies };
}

export function attachQuickRepliesMarker(reply: string, replies: string[]): string {
  const unique = [...new Set(replies.map((r) => r.trim()).filter(Boolean))];
  if (!unique.length) return reply;
  const cleaned = reply.replace(QUICK_REPLIES_MARKER_RE, '').trim();
  return `${cleaned}\n\n<!--COSP_QUICK_REPLIES:${JSON.stringify(unique)}-->`;
}
