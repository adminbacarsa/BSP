/**
 * Mailer sin red: transporter inyectado.
 * node --experimental-strip-types --test src/common/mailer.test.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_MAIL_FROM,
  MailNotConfiguredError,
  replyToFromEmpresa,
  resolveMailFrom,
  resolveSmtpAuth,
  sanitizeMailError,
  sendSystemMail,
  verifySmtp,
  type MailTransport,
} from './mailer.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SECRET = 'abcd-efgh-ijkl-mnop';

function capture() {
  const sent: Record<string, unknown>[] = [];
  const transport: MailTransport = {
    sendMail: async (msg) => {
      sent.push(msg);
    },
    verify: async () => undefined,
  };
  return {
    sent,
    deps: {
      env: { MAIL_USER: 'cosp@bacarsa.com.ar', MAIL_PASS: SECRET } as NodeJS.ProcessEnv,
      createTransport: () => transport,
    },
  };
}

describe('mailer', () => {
  it('el remitente por defecto es COSP <cosp@bacarsa.com.ar>', () => {
    assert.equal(resolveMailFrom({}), DEFAULT_MAIL_FROM);
    assert.equal(DEFAULT_MAIL_FROM, 'COSP <cosp@bacarsa.com.ar>');
    assert.equal(resolveMailFrom({ MAIL_FROM: '  Ops <ops@bacarsa.com.ar>  ' }), 'Ops <ops@bacarsa.com.ar>');
  });

  it('MAIL_USER/MAIL_PASS ganan; si faltan, usa GMAIL_*', () => {
    assert.deepEqual(
      resolveSmtpAuth({ MAIL_USER: 'cosp@bacarsa.com.ar', MAIL_PASS: 'nueva clave', GMAIL_USER: 'admin@bacarsa.com.ar', GMAIL_PASS: 'vieja' }),
      { user: 'cosp@bacarsa.com.ar', pass: 'nuevaclave' },
    );
    assert.deepEqual(
      resolveSmtpAuth({ GMAIL_USER: ' admin@bacarsa.com.ar ', GMAIL_PASS: 'ab cd' }),
      { user: 'admin@bacarsa.com.ar', pass: 'abcd' },
    );
    assert.equal(resolveSmtpAuth({}), null);
  });

  it('el envío sale con el from nuevo y el reply-to de la empresa', async () => {
    const { sent, deps } = capture();
    await sendSystemMail(
      { to: 'guardia@bacarsa.com.ar', subject: 'Acceso', text: 'hola', replyTo: 'rrhh@bacarsa.com.ar' },
      deps,
    );
    assert.equal(sent.length, 1);
    assert.equal(sent[0].from, DEFAULT_MAIL_FROM);
    assert.equal(sent[0].replyTo, 'rrhh@bacarsa.com.ar');
    assert.equal(sent[0].to, 'guardia@bacarsa.com.ar');
    assert.equal('pass' in sent[0], false);
  });

  it('sin reply-to de empresa no manda el header', async () => {
    const { sent, deps } = capture();
    await sendSystemMail({ to: 'a@b.com', subject: 's', text: 't' }, deps);
    assert.equal('replyTo' in sent[0], false);
    assert.equal(replyToFromEmpresa({ nombre: 'Bacar', mailReplyTo: 'rrhh@bacarsa.com.ar' }), 'rrhh@bacarsa.com.ar');
    assert.equal(replyToFromEmpresa({ nombre: 'Bacar' }), null);
    assert.equal(replyToFromEmpresa({ replyTo: 'no-es-mail' }), null);
  });

  it('sin credenciales el error no incluye una clave', async () => {
    await assert.rejects(
      () => sendSystemMail({ to: 'a@b.com', subject: 's' }, { env: {} }),
      (err: unknown) => {
        assert.ok(err instanceof MailNotConfiguredError);
        assert.equal(String((err as Error).message).includes(SECRET), false);
        return true;
      },
    );
  });

  it('un fallo SMTP no devuelve la clave', async () => {
    const leaking = new Error(`Invalid login: ${SECRET} rejected`);
    await assert.rejects(
      () =>
        sendSystemMail(
          { to: 'a@b.com', subject: 's', text: 't' },
          {
            env: { MAIL_USER: 'cosp@bacarsa.com.ar', MAIL_PASS: SECRET },
            createTransport: () => ({
              sendMail: async () => {
                throw leaking;
              },
            }),
          },
        ),
      (err: unknown) => {
        const msg = String((err as Error).message);
        assert.equal(msg.includes(SECRET), false);
        assert.match(msg, /No se pudo enviar el mail/);
        assert.match(msg, /\*\*\*/);
        return true;
      },
    );
    assert.equal(sanitizeMailError(leaking, SECRET).includes(SECRET), false);
  });

  it('verify no informa el largo ni el valor de la clave', async () => {
    const ok = await verifySmtp({
      env: { GMAIL_USER: 'admin@bacarsa.com.ar', GMAIL_PASS: SECRET },
      createTransport: () => ({ sendMail: async () => undefined, verify: async () => undefined }),
    });
    assert.equal(ok.ok, true);
    assert.equal(ok.detail.includes(SECRET), false);
    assert.equal(ok.detail.includes('passLen'), false);
    const missing = await verifySmtp({ env: {} });
    assert.equal(missing.ok, false);
    assert.match(missing.detail, /MAIL_USER/);
  });
});

describe('los envíos del sistema usan el mailer', () => {
  const sources = [
    path.join(__dirname, '../index.ts'),
    path.join(__dirname, '../eventuales/marcoAnexoCall.ts'),
  ];

  it('nadie arma su propio transporter ni pone un from propio', () => {
    for (const file of sources) {
      const src = fs.readFileSync(file, 'utf8');
      assert.equal(src.includes('createTransport'), false, file);
      assert.equal(src.includes('nodemailer'), false, file);
      assert.equal(src.includes('sendSystemMail'), true, file);
      assert.equal(/from:\s*[`'"]/.test(src), false, file);
    }
  });

  it('portal de empleados, portal de clientes y código de anexo pasan por sendSystemMail', () => {
    const index = fs.readFileSync(sources[0], 'utf8');
    const anexo = fs.readFileSync(sources[1], 'utf8');
    assert.equal((index.match(/sendSystemMail\(/g) || []).length >= 2, true);
    assert.equal(index.includes('verifySmtp'), true);
    assert.equal((anexo.match(/sendSystemMail\(/g) || []).length, 1);
    assert.equal(index.includes('admin@bacarsa.com.ar'), false);
    assert.equal(anexo.includes('admin@bacarsa.com.ar'), false);
  });
});
