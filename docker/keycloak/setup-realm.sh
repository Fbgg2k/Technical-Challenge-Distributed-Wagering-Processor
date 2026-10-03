#!/bin/bash
# Cria o realm "jungle" e o client "jungle-gaming" no Keycloak.
# Uso: docker compose --profile auth up -d keycloak && docker compose exec keycloak bash /opt/keycloak/bin/setup-realm.sh
set -e

KC=http://localhost:8080
REALM=jungle
CLIENT=jungle-gaming

echo "waiting for Keycloak..."
until curl -sf "$KC/realms/master" >/dev/null 2>&1; do sleep 2; done

echo "admin token..."
TOKEN=$(curl -sf -X POST "$KC/realms/master/protocol/openid-connect/token" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d "username=${KEYCLOAK_ADMIN:-admin}" \
  -d "password=${KEYCLOAK_ADMIN_PASSWORD:-admin}" \
  -d 'grant_type=password' \
  -d 'client_id=admin-cli' | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])')

if curl -sf "$KC/realms/$REALM" >/dev/null 2>&1; then
  echo "realm $REALM already exists"
else
  echo "creating realm $REALM..."
  curl -sf -X POST "$KC/admin/realms" \
    -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' \
    -d "{\"realm\":\"$REALM\",\"enabled\":true}"
fi

echo "client $CLIENT..."
curl -sf -X POST "$KC/admin/realms/$REALM/clients" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"clientId\":\"$CLIENT\",\"enabled\":true,\"publicClient\":true,\"directAccessGrantsEnabled\":true,\"standardFlowEnabled\":false}" || echo "client may already exist"

echo "done. Issuer: $KC/realms/$REALM"
echo "Set AUTH_ENABLED=true, AUTH_ISSUER=$KC/realms/$REALM, AUTH_JWKS_URL=$KC/realms/$REALM/protocol/openid-connect/certs"
