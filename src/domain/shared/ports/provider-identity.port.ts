/**
 * Porta de identidade do provedor.
 *
 * A autenticação é delegada a um Identity Provider externo (Keycloak/Zitadel)
 * via OIDC. O domínio NÃO conhece tokens nem tabelas de usuários: a guarda
 * resolve o token em uma identidade de provedor (`providerId`) através desta
 * porta, e o resto do pipeline valida a identidade como qualquer outro
 * campo de domínio.
 */
export interface ProviderIdentityPort {
  /** Resolve o providerId (e opcionalmente playerId) a partir do token validado. */
  resolveIdentity(claims: Record<string, unknown>): { providerId: string; playerId?: string };
}

/** Implementação padrão: `sub` do token como playerId, claim `provider_id`/`client_id` como providerId. */
export class DefaultProviderIdentity implements ProviderIdentityPort {
  resolveIdentity(claims: Record<string, unknown>): { providerId: string; playerId?: string } {
    const providerId =
      (claims['provider_id'] as string | undefined) ??
      (claims['client_id'] as string | undefined) ??
      'unknown-provider';
    const playerId = claims['sub'] as string | undefined;
    return { providerId, playerId };
  }
}
