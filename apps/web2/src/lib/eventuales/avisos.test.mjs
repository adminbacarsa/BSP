import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolverAvisos, usuariosDelRol } from './avisos.mjs';

const roles = [
  { id: 'rol_rrhh', permissions: { RRHH: ['read', 'update'] } },
  { id: 'rol_ops', permissions: { OPERATIONS: ['read'] } },
];
const usuarios = [
  { uid: 'u1', role: 'rol_rrhh', email: 'rrhh@bacar.test', phone: '3510000001', status: 'ACTIVE' },
  { uid: 'u2', role: 'rol_ops', email: 'ops@bacar.test', phone: '', status: 'ACTIVE' },
  { uid: 'u3', role: 'rol_rrhh', email: 'baja@bacar.test', status: 'INACTIVE' },
];

describe('avisos por empresa', () => {
  it('un rol que no existe queda vacío y no rompe', () => {
    assert.deepEqual(usuariosDelRol('SUPERVISION', usuarios, roles), []);
    const out = resolverAvisos({
      avisos: { ARCA_ERROR: [{ tipo: 'ROL', rolDestino: 'SUPERVISION', canales: { push: true, mail: true } }] },
      tipo: 'ARCA_ERROR',
      usuarios,
      roles,
      tokens: [],
    });
    assert.deepEqual(out, { pushes: [], mails: [], whatsapps: [] });
  });

  it('manda push si hay token y, si no hay, cae a mail y WhatsApp', () => {
    const avisos = {
      ARCA_ALTA_PENDIENTE: [
        { tipo: 'ROL', rolDestino: 'RRHH', canales: { push: true, mail: true, whatsapp: true } },
        { tipo: 'PERSONA', nombre: 'Mauro', mail: 'mauro@bacar.test', whatsapp: '3510000099', push: true, uid: 'u9' },
      ],
    };
    const conToken = resolverAvisos({
      avisos, tipo: 'ARCA_ALTA_PENDIENTE', usuarios, roles,
      tokens: [{ uid: 'u1', token: 'tok-1' }],
    });
    assert.deepEqual(conToken.pushes, [{ uid: 'u1', token: 'tok-1' }]);
    assert.equal(conToken.mails.includes('rrhh@bacar.test'), false);
    assert.equal(conToken.mails.includes('mauro@bacar.test'), true);
    assert.deepEqual(conToken.whatsapps, ['3510000099']);

    const sinToken = resolverAvisos({ avisos, tipo: 'ARCA_ALTA_PENDIENTE', usuarios, roles, tokens: [] });
    assert.deepEqual(sinToken.pushes, []);
    assert.equal(sinToken.mails.includes('rrhh@bacar.test'), true);
  });
});
