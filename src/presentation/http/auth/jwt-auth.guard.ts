import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtVerifier } from '../../../infrastructure/auth/jwt-verifier';
import {
  DefaultProviderIdentity,
  ProviderIdentityPort,
} from '../../../domain/shared/ports/provider-identity.port';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => Reflect.metadata(IS_PUBLIC_KEY, true);

/**
 * AuthGuard OIDC: valida o Bearer token contra o JWKS do IdP.
 * Quando AUTH_ENABLED=false, atua como no-op (extensão explícita,
 * sem autenticação artesanal).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);
  private readonly identity: ProviderIdentityPort = new DefaultProviderIdentity();

  constructor(
    private readonly reflector: Reflector,
    private readonly verifier: JwtVerifier,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    if (process.env.AUTH_ENABLED !== 'true') {
      return true; // extensão no-op documentada em ARCHITECTURE.md
    }

    const req = context.switchToHttp().getRequest();
    const headers = req.headers as Record<string, string | undefined>;
    const header = headers['authorization'] ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) {
      throw new UnauthorizedException('missing bearer token');
    }

    try {
      const claims = await this.verifier.verify(token);
      const identity = this.identity.resolveIdentity(claims);
      (req as Request & { user?: unknown }).user = {
        providerId: identity.providerId,
        playerId: identity.playerId,
        claims,
      };
      return true;
    } catch (err) {
      this.logger.warn(`auth failed: ${(err as Error).message}`);
      throw new UnauthorizedException('invalid token');
    }
  }
}
