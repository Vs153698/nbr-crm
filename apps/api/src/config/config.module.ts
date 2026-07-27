import { Global, Module } from '@nestjs/common';
import { loadEnv, type Env } from './env';

export const ENV = Symbol('ENV');

/**
 * Configuration is validated once at boot and injected as a frozen object.
 * Nothing in the app reads `process.env` directly — that keeps every
 * configuration value discoverable in one schema and typed at the point of use.
 */
@Global()
@Module({
  providers: [
    {
      provide: ENV,
      useFactory: (): Env => Object.freeze(loadEnv()),
    },
  ],
  exports: [ENV],
})
export class ConfigModule {}
