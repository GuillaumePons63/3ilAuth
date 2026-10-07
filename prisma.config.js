// La CLI Prisma charge ici les variables du fichier .env.
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  // Indiquer où lire la description des modèles et où conserver les migrations SQL.
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // La migration doit ouvrir la même base que le client utilisé par l'API.
  datasource: { url: env("DATABASE_URL") },
});
