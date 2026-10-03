/**
 * Provisiona o realm "jungle" e o client "jungle-gaming" no Keycloak.
 * Uso: bun scripts/setup-keycloak-realm.ts
 */

const KC = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
const REALM = 'jungle';
const CLIENT = 'jungle-gaming';

async function main() {
  // espera o Keycloak subir
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${KC}/realms/master`);
      if (r.ok) break;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 2000));
  }

  const tokenRes = await fetch(`${KC}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      username: process.env.KEYCLOAK_ADMIN ?? 'admin',
      password: process.env.KEYCLOAK_ADMIN_PASSWORD ?? 'admin',
      grant_type: 'password',
      client_id: 'admin-cli',
    }),
  });
  const tokenJson = (await tokenRes.json()) as { access_token?: string };
  if (!tokenJson.access_token) {
    throw new Error(`admin token failed: ${JSON.stringify(tokenJson)}`);
  }
  const token = tokenJson.access_token;

  const realmRes = await fetch(`${KC}/admin/realms/${REALM}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (realmRes.status === 404) {
    const create = await fetch(`${KC}/admin/realms`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ realm: REALM, enabled: true }),
    });
    console.log('realm created:', create.status);
  } else {
    console.log('realm already exists:', realmRes.status);
  }

  const clientRes = await fetch(
    `${KC}/admin/realms/${REALM}/clients?clientId=${CLIENT}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const clients = (await clientRes.json()) as Array<{ id: string }>;
  if (clients.length === 0) {
    const create = await fetch(`${KC}/admin/realms/${REALM}/clients`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: CLIENT,
        enabled: true,
        publicClient: true,
        directAccessGrantsEnabled: true,
        standardFlowEnabled: false,
      }),
    });
    console.log('client created:', create.status);
  } else {
    console.log('client already exists');
  }

  // desabilita required actions que bloqueiam o direct grant (VERIFY_PROFILE etc.)
  const requiredActions = await fetch(
    `${KC}/admin/realms/${REALM}/authentication/required-actions`,
    { headers: { Authorization: `Bearer ${token}` } },
  ).then((r) => r.json() as Promise<Array<Record<string, unknown>>>);
  for (const action of requiredActions) {
    if (
      ['VERIFY_PROFILE', 'UPDATE_PROFILE', 'UPDATE_PASSWORD', 'VERIFY_EMAIL'].includes(
        String(action.alias),
      )
    ) {
      await fetch(
        `${KC}/admin/realms/${REALM}/authentication/required-actions/${String(action.alias)}`,
        {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...action, defaultAction: false, enabled: false }),
        },
      );
    }
  }
  console.log('required actions neutralizadas');

  // usuário de teste no realm
  const usersRes = await fetch(
    `${KC}/admin/realms/${REALM}/users?username=player`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const users = (await usersRes.json()) as Array<{ id: string }>;
  if (users.length === 0) {
    const create = await fetch(`${KC}/admin/realms/${REALM}/users`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'player',
        enabled: true,
        emailVerified: true,
        email: 'player@example.com',
        requiredActions: [],
        credentials: [{ type: 'password', value: 'player', temporary: false }],
      }),
    });
    console.log('user created:', create.status);
  } else {
    console.log('user already exists');
  }

  // token de teste via direct access grant
  const test = await fetch(`${KC}/realms/${REALM}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      username: 'player',
      password: 'player',
      grant_type: 'password',
      client_id: CLIENT,
    }),
  });
  const testJson = (await test.json()) as { access_token?: string; error?: string };
  console.log('test token:', test.ok ? 'OK' : JSON.stringify(testJson));
  console.log('issuer:', `${KC}/realms/${REALM}`);
}

void main();
