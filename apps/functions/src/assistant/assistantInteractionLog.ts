import * as admin from 'firebase-admin';

export type AssistantLogOutcome = 'answered' | 'unsatisfied' | 'error';

export type AssistantInteractionLogInput = {
  empresaId: string;
  uid: string;
  userEmail?: string | null;
  question: string;
  reply?: string | null;
  moduleKey?: string | null;
  pathname?: string;
  outcome: AssistantLogOutcome;
  errorCode?: string | null;
  errorMessage?: string | null;
  durationMs?: number;
};

const COLLECTION = 'assistant_interaction_logs';

const UNSATISFIED_REPLY_PATTERNS: RegExp[] = [
  /\binconveniente\s+t[eé]cnico\b/i,
  /\bno\s+puedo\s+consultar\b/i,
  /\bno\s+est[aá]\s+disponible\b/i,
  /\bcontact(ar|e)\s+.{0,24}(soporte|it|t[eé]cnico)\b/i,
  /\bavis[aá]\s+.{0,20}(soporte|it)\b/i,
  /\berror\s+t[eé]cnico\b/i,
  /\bno\s+se\s+pudo\s+conectar\b/i,
  /\bfallo\s+interno\b/i,
  /\bservicio\s+temporalmente\s+no\s+disponible\b/i,
  /\bno\s+tengo\s+permiso\b/i,
  /\bno\s+pude\s+completar\b/i,
  /\bno\s+pude\s+listar\b/i,
  /\bno\s+pude\s+consultar\b/i,
  /^⚠️/,
];

export function classifyAssistantOutcome(
  reply: string | null | undefined,
  hadError: boolean,
): AssistantLogOutcome {
  if (hadError) return 'error';
  const r = String(reply ?? '').trim();
  if (!r) return 'unsatisfied';
  for (const re of UNSATISFIED_REPLY_PATTERNS) {
    if (re.test(r)) return 'unsatisfied';
  }
  if (r.length < 28 && /\bno\s+(puedo|podemos|hay)\b/i.test(r)) return 'unsatisfied';
  return 'answered';
}

function clip(s: string, max: number): string {
  const t = String(s ?? '').trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

export async function writeAssistantInteractionLog(input: AssistantInteractionLogInput): Promise<void> {
  const question = clip(input.question, 2000);
  if (question.length < 2) return;

  const empresaId = String(input.empresaId ?? '').trim() || '_sin_empresa';

  try {
    await admin.firestore().collection(COLLECTION).add({
      empresaId,
      uid: String(input.uid ?? '').slice(0, 128),
      userEmail: input.userEmail ? clip(input.userEmail, 320) : null,
      question,
      reply: input.reply != null ? clip(input.reply, 4000) : null,
      moduleKey: input.moduleKey ? clip(input.moduleKey, 64) : null,
      pathname: input.pathname ? clip(input.pathname, 400) : null,
      outcome: input.outcome,
      needsReview: input.outcome === 'unsatisfied' || input.outcome === 'error',
      errorCode: input.errorCode ? clip(input.errorCode, 64) : null,
      errorMessage: input.errorMessage ? clip(input.errorMessage, 480) : null,
      durationMs: typeof input.durationMs === 'number' ? Math.round(input.durationMs) : null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[assistant] writeAssistantInteractionLog', msg.slice(0, 200));
  }
}

export function extractLastUserQuestion(messages: Array<{ role?: string; content?: string }>): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user') return String(messages[i]?.content ?? '').trim();
  }
  return '';
}
