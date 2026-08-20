const EAS_GRAPHQL_URL = 'https://api.expo.dev/graphql';

export type EasGraphqlError = { message: string };

async function easGraphql<T>(
  accessToken: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(EAS_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  const body = (await res.json()) as {
    data?: T;
    errors?: EasGraphqlError[];
  };

  if (!res.ok) {
    const msg = body.errors?.[0]?.message || res.statusText || 'Error EAS GraphQL';
    throw new Error(msg);
  }
  if (body.errors?.length) {
    const detail = body.errors.map((e) => e.message).join(' | ');
    throw new Error(`EAS GraphQL: ${detail}`);
  }
  if (!body.data) {
    throw new Error('Respuesta EAS vacía');
  }
  return body.data;
}

export async function resolveEasAppId(
  accessToken: string,
  fullName: string,
  projectIdHint?: string,
): Promise<{ appId: string; fullName: string }> {
  const hintedId = projectIdHint?.trim();
  if (hintedId) {
    try {
      const byId = await easGraphql<{
        app: { byId: { id: string; slug: string; ownerAccount?: { name?: string } } | null };
      }>(
        accessToken,
        `query AppById($appId: String!) {
          app { byId(appId: $appId) { id slug ownerAccount { name } } }
        }`,
        { appId: hintedId },
      );
      const app = byId.app?.byId;
      if (app?.id) {
        const owner = app.ownerAccount?.name || fullName.split('/')[0]?.replace('@', '') || 'bacarsa';
        return { appId: app.id, fullName: `@${owner}/${app.slug}` };
      }
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      throw new Error(
        `No se pudo acceder al proyecto Expo ${hintedId}. ` +
          `El token debe ser de la misma cuenta que creó el proyecto en expo.dev. Detalle: ${detail}`,
      );
    }
    throw new Error(
      `Proyecto Expo ${hintedId} no encontrado. Verificá el ID en expo.dev → Project settings.`,
    );
  }

  const candidates = [fullName];
  if (!fullName.includes('maumartinez')) {
    candidates.push(fullName.replace('@bacarsa/', '@maumartinez/'));
  }

  let lastErr = '';
  for (const name of candidates) {
    try {
      const data = await easGraphql<{
        app: { byFullName: { id: string; slug: string } | null };
      }>(
        accessToken,
        `query AppByFullName($fullName: String!) {
          app { byFullName(fullName: $fullName) { id slug } }
        }`,
        { fullName: name },
      );
      const app = data.app?.byFullName;
      if (app?.id) {
        return { appId: app.id, fullName: name };
      }
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
  }

  throw new Error(
    `Proyecto Expo no encontrado (${candidates.join(' ni ')}). ` +
      `Creá el proyecto en expo.dev o pegá el ID EAS (82738682-...) en Config → App móvil. ${lastErr}`,
  );
}

export type EasEnvVarInput = {
  name: string;
  value: string;
  environments: ('PREVIEW' | 'PRODUCTION' | 'DEVELOPMENT')[];
  visibility: 'PUBLIC' | 'SENSITIVE' | 'SECRET';
  type: 'STRING';
};

export async function bulkUpsertEasEnvForApp(
  accessToken: string,
  appId: string,
  variables: EasEnvVarInput[],
): Promise<{ created: number; updated: number }> {
  const input = variables.map((v) => ({
    name: v.name,
    value: v.value,
    visibility: v.visibility,
    environments: v.environments,
    type: v.type,
    overwrite: true,
  }));

  try {
    await easGraphql(
      accessToken,
      `mutation BulkEnv($appId: ID!, $input: [CreateEnvironmentVariableInput!]!) {
        environmentVariable {
          createBulkEnvironmentVariablesForApp(environmentVariablesData: $input, appId: $appId) {
            id
            name
          }
        }
      }`,
      { appId, input },
    );
    return { created: variables.length, updated: 0 };
  } catch (bulkErr) {
    let created = 0;
    let updated = 0;
    for (const v of input) {
      try {
        await easGraphql(
          accessToken,
          `mutation CreateEnv($input: CreateEnvironmentVariableInput!, $appId: ID!) {
            environmentVariable {
              createEnvironmentVariableForApp(environmentVariableData: $input, appId: $appId) { id }
            }
          }`,
          { appId, input: v },
        );
        created += 1;
      } catch (singleErr) {
        const msg = singleErr instanceof Error ? singleErr.message : String(singleErr);
        if (!/already exists|duplicate|unique/i.test(msg)) {
          throw new Error(`${v.name}: ${msg}`);
        }
        updated += 1;
      }
    }
    if (created + updated === 0 && bulkErr instanceof Error) {
      throw bulkErr;
    }
    return { created, updated };
  }
}

export async function fetchEasBuildById(
  accessToken: string,
  buildId: string,
): Promise<{
  id: string;
  status: string;
  artifacts?: { buildUrl?: string | null } | null;
} | null> {
  const data = await easGraphql<{
    build: { byId: { id: string; status: string; artifacts?: { buildUrl?: string | null } } | null };
  }>(
    accessToken,
    `query BuildById($buildId: ID!) {
      build { byId(buildId: $buildId) { id status artifacts { buildUrl } } }
    }`,
    { buildId },
  );
  return data.build?.byId ?? null;
}

export async function dispatchGithubEasWorkflow(input: {
  githubToken: string;
  repo: string;
  ref?: string;
}): Promise<void> {
  const [owner, repo] = input.repo.split('/');
  if (!owner || !repo) {
    throw new Error('Repo GitHub inválido (esperado owner/repo).');
  }

  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/actions/workflows/eas-mobile-preview.yml/dispatches`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${input.githubToken}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({
        ref: input.ref || 'main',
        inputs: { trigger: 'cosp-admin-config' },
      }),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub dispatch falló (${res.status}): ${text.slice(0, 300)}`);
  }
}
