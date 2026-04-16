import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";

import type { DatabaseSchema } from "./schema.js";

export function createDb(connectionString: string): Kysely<DatabaseSchema> {
  return new Kysely<DatabaseSchema>({
    dialect: new PostgresDialect({
      pool: new Pool({
        connectionString,
      }),
    }),
  });
}
