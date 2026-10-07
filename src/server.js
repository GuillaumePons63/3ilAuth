import { createDatabase } from "./db.js";
import { createApp } from "./app.js";

// npm start charge .env grâce à l'option Node.js --env-file=.env.
// process.env permet ensuite de lire ces valeurs dans le programme.
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL requis.");
// Les variables d'environnement sont des textes : convertir et valider le port.
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT invalide.");
// Ouvrir un client unique, puis vérifier la connexion avant de démarrer l'API.
const prisma = createDatabase(process.env.DATABASE_URL);
await prisma.$connect();
// Transmettre la BDD et le secret aux routes et aux fonctions d'authentification.
const app = await createApp(prisma, process.env.JWT_SECRET);
// 127.0.0.1 rend cette démonstration accessible uniquement sur votre ordinateur.
const server = app.listen(port, "127.0.0.1", () => {
  console.log(`API disponible sur http://localhost:${port}`);
});

async function shutdown() {
  // À l'arrêt, fermer le serveur avant de libérer la connexion à la BDD.
  server.close(async () => {
    await prisma.$disconnect();
  });
}
// SIGINT correspond notamment à Ctrl+C ; SIGTERM demande aussi un arrêt.
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
