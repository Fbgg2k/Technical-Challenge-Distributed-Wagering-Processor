import {
  jwtVerify,
  importJWK,
  decodeProtectedHeader,
  type JWK,
  type JSONWebKeySet,
} from 'jose';

interface JwkCache {
  keys: JWK[];
  fetchedAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Validação de JWT via JWKS do Identity Provider (Keycloak/Zitadel).
 *
 * - issuer e audience são verificados;
 * - JWKS é buscada em ${AUTH_JWKS_URL} e cacheada por 5 minutos;
 * - sem segredos compartilhados: verificação assimétrica (RS/ES).
 */
export class JwtVerifier {
  private cache: JwkCache | undefined;

  constructor(
    private readonly issuer: string,
    private readonly jwksUrl: string,
    private readonly audience?: string,
  ) {}

  async verify(token: string): Promise<Record<string, unknown>> {
    const key = await this.resolveSigningKey(token);
    const { payload } = await jwtVerify(token, key, {
      issuer: this.issuer,
      ...(this.audience ? { audience: this.audience } : {}),
    });
    return payload as Record<string, unknown>;
  }

  private async resolveSigningKey(token: string): Promise<CryptoKey | Uint8Array> {
    if (!this.cache || Date.now() - this.cache.fetchedAt > CACHE_TTL_MS) {
      const res = await fetch(this.jwksUrl);
      if (!res.ok) {
        throw new Error(`JWKS fetch failed: ${res.status}`);
      }
      const jwks = (await res.json()) as JSONWebKeySet;
      this.cache = { keys: jwks.keys, fetchedAt: Date.now() };
    }
    const header = decodeProtectedHeader(token);
    const jwk = this.cache.keys.find(
      (k) => k.kid === header?.kid && k.use === 'sig',
    );
    if (!jwk) {
      throw new Error('signing key not found in JWKS');
    }
    return importJWK(jwk);
  }
}
