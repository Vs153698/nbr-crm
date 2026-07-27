import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import type postgres from 'postgres';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { createDatabase, createPool, type Database } from './client';
import { DB, PG } from './database.tokens';

@Global()
@Module({
  providers: [
    {
      provide: PG,
      inject: [ENV],
      useFactory: (env: Env): postgres.Sql => createPool(env.DATABASE_URL),
    },
    {
      provide: DB,
      inject: [PG],
      useFactory: (sql: postgres.Sql): Database => createDatabase(sql),
    },
  ],
  exports: [DB, PG],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(PG) private readonly sql: postgres.Sql) {}

  /** Drain the pool on shutdown so a rolling PM2 reload doesn't kill queries
   *  mid-flight. */
  async onApplicationShutdown(): Promise<void> {
    await this.sql.end({ timeout: 10 });
  }
}

export { DB, PG };
