import { DynamicModule, Global, Module, Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';
import { JwtVerifier } from '../../../infrastructure/auth/jwt-verifier';

@Global()
@Module({})
export class AuthModule {
  static register(): DynamicModule {
    const verifierProvider: Provider = {
      provide: JwtVerifier,
      useValue: new JwtVerifier(
        process.env.AUTH_ISSUER ?? 'http://localhost:8080/realms/jungle',
        process.env.AUTH_JWKS_URL ??
          'http://localhost:8080/realms/jungle/protocol/openid-connect/certs',
        process.env.AUTH_AUDIENCE,
      ),
    };

    const guardProvider: Provider = {
      provide: APP_GUARD,
      useFactory: (reflector: Reflector, verifier: JwtVerifier) =>
        new JwtAuthGuard(reflector, verifier),
      inject: [Reflector, JwtVerifier],
    };

    return {
      module: AuthModule,
      providers: [verifierProvider, guardProvider],
      exports: [JwtVerifier],
    };
  }
}
