/**
 * Adaptador de Google Secret Manager. Una version nueva reemplaza a la anterior
 * (la vieja se destruye). El payload es solo la clave, nunca se loguea.
 */
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import type { ClaveStore } from './arcaClaveFiscal';

function proyecto(): string {
  return process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'comtroldata';
}

function parentSecreto(secretId: string): string {
  return `projects/${proyecto()}/secrets/${secretId}`;
}


function versionViva(estado: unknown): boolean {
  const texto = String(estado ?? "");
  return texto === "ENABLED" || texto === "DISABLED" || texto === "1" || texto === "2";
}

function versionCorta(nombre: string): string {
  const parte = String(nombre || '').split('/').pop() || '';
  return parte || '1';
}

export function crearSecretManagerReal(): ClaveStore {
  const client = new SecretManagerServiceClient();
  return {
    async escribir(secretId, clave) {
      const parent = `projects/${proyecto()}`;
      const name = parentSecreto(secretId);
      try {
        await client.getSecret({ name });
      } catch (e) {
        const code = (e as { code?: number }).code;
        if (code !== 5) throw e;
        await client.createSecret({
          parent,
          secretId,
          secret: { replication: { automatic: {} } },
        });
      }
      const [creada] = await client.addSecretVersion({
        parent: name,
        payload: { data: Buffer.from(clave, 'utf8') },
      });
      const versionName = String(creada.name || '');
      const [lista] = await client.listSecretVersions({ parent: name });
      for (const item of lista) {
        const estado = String(item.state || '');
        if (!item.name || item.name === versionName) continue;
        if (versionViva(estado)) {
          await client.destroySecretVersion({ name: item.name });
        }
      }
      return { version: versionCorta(versionName) };
    },
    async destruir(secretId) {
      const name = parentSecreto(secretId);
      let lista;
      try {
        [lista] = await client.listSecretVersions({ parent: name });
      } catch (e) {
        if ((e as { code?: number }).code === 5) return;
        throw e;
      }
      for (const item of lista) {
        const estado = String(item.state || '');
        if (!item.name) continue;
        if (versionViva(estado)) {
          await client.destroySecretVersion({ name: item.name });
        }
      }
    },
  };
}

export async function leerClaveSecreta(secretId: string): Promise<string> {
  const client = new SecretManagerServiceClient();
  const [acceso] = await client.accessSecretVersion({
    name: `${parentSecreto(secretId)}/versions/latest`,
  });
  const data = acceso.payload?.data;
  if (!data) return '';
  return Buffer.from(data).toString('utf8');
}