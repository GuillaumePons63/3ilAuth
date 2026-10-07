import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "./generated/prisma/index.js";

export function createDatabase(url) {
  // L'adaptateur permet au client Prisma d'utiliser le pilote better-sqlite3.
  // url désigne le fichier SQLite, par exemple file:./dev.db.
  const adapter = new PrismaBetterSqlite3({ url });
  // Ce client sera partagé entre les routes de l'application.
  return new PrismaClient({ adapter });
}
