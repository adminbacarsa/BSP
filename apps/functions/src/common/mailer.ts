/**
 * Único envío SMTP del sistema. Remitente por defecto: COSP <cosp@bacarsa.com.ar>.
 * Auth: MAIL_USER / MAIL_PASS y, si faltan, GMAIL_USER / GMAIL_PASS.
 * No loguea ni devuelve la clave.
 */

export const DEFAULT_MAIL_FROM = 'COSP <cosp@bacarsa.com.ar>';

const SMTP = { host: 'smtp.gmail.com', port: 465, secure: true } as const;

export type SmtpAuth = { user: string; pass: string };

export type MailTransport = {
  sendMail: (msg: Record<string, unknown>) => Promise<unknown>;
  verify?: () => Promise<unknown>;
};

export type MailerDeps = {
  env?: NodeJS.ProcessEnv;
  createTransport?: (opts: { host: string; port: number; secure: boolean; auth: SmtpAuth }) => MailTransport;
};

export type SystemMail = {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  /** Reply-To de la empresa (`empresas.mailReplyTo`), si existe. */
  replyTo?: string | null;
};

export class MailNotConfiguredError extends Error {
  constructor() {
    super(
      'Servicio de email no configurado. Definir MAIL_USER y MAIL_PASS (mientras tanto sirven GMAIL_USER y GMAIL_PASS) y redesplegar.',
    );
    this.name = 'MailNotConfiguredError';
  }
}

export function resolveMailFrom(env: NodeJS.ProcessEnv = process.env): string {
  const from = String(env.MAIL_FROM || '').trim();
  return from || DEFAULT_MAIL_FROM;
}

export function resolveSmtpAuth(env: NodeJS.ProcessEnv = process.env): SmtpAuth | null {
  const user = String(env.MAIL_USER || env.GMAIL_USER || '').trim();
  const pass = String(env.MAIL_PASS || env.GMAIL_PASS || '').replace(/\s+/g, '');
  if (!user || !pass) return null;
  return { user, pass };
}

/** Email de respuesta de la empresa. Sin campo, los replies van al remitente COSP. */
export function replyToFromEmpresa(data: Record<string, unknown> | null | undefined): string | null {
  if (!data) return null;
  const raw = String(data.mailReplyTo || data.replyTo || '').trim();
  return raw.includes('@') ? raw : null;
}

/** Saca la clave del texto de error de SMTP (Gmail a veces la repite). */
export function sanitizeMailError(err: unknown, secret?: string): string {
  let msg = err instanceof Error ? err.message : String(err ?? '');
  const pass = String(secret || '').replace(/\s+/g, '');
  if (pass.length >= 4) {
    msg = msg.split(pass).join('***');
    const spaced = pass.replace(/(.{4})/g, '$1 ').trim();
    if (spaced !== pass) msg = msg.split(spaced).join('***');
  }
  return msg.replace(/\s+/g, ' ').trim().slice(0, 180);
}

function defaultTransport(auth: SmtpAuth): MailTransport {
  // Carga diferida: el test inyecta el transporter y no abre red.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodemailer = require('nodemailer') as {
    createTransport: (opts: unknown) => MailTransport;
  };
  return nodemailer.createTransport({ ...SMTP, auth });
}

export async function sendSystemMail(input: SystemMail, deps?: MailerDeps): Promise<void> {
  const env = deps?.env ?? process.env;
  const auth = resolveSmtpAuth(env);
  if (!auth) throw new MailNotConfiguredError();
  const to = String(input.to || '').trim();
  if (!to) throw new Error('Falta el destinatario del mail.');
  const replyTo = String(input.replyTo || '').trim();
  const transport = (deps?.createTransport ?? ((opts) => defaultTransport(opts.auth)))({ ...SMTP, auth });
  try {
    await transport.sendMail({
      from: resolveMailFrom(env),
      to,
      subject: input.subject,
      ...(input.html ? { html: input.html } : {}),
      ...(input.text ? { text: input.text } : {}),
      ...(replyTo ? { replyTo } : {}),
    });
  } catch (err) {
    throw new Error(`No se pudo enviar el mail: ${sanitizeMailError(err, auth.pass)}`);
  }
}

export async function verifySmtp(
  deps?: MailerDeps,
): Promise<{ ok: true; detail: string } | { ok: false; detail: string }> {
  const env = deps?.env ?? process.env;
  const auth = resolveSmtpAuth(env);
  if (!auth) {
    return { ok: false, detail: 'MAIL_USER / MAIL_PASS no configurados (tampoco GMAIL_USER / GMAIL_PASS)' };
  }
  try {
    const transport = (deps?.createTransport ?? ((opts) => defaultTransport(opts.auth)))({ ...SMTP, auth });
    if (transport.verify) await transport.verify();
    return { ok: true, detail: `SMTP listo · ${auth.user}` };
  } catch (err) {
    return { ok: false, detail: `${auth.user} · ${sanitizeMailError(err, auth.pass)}` };
  }
}
