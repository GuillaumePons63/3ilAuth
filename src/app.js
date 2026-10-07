import express from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { createAuthentication } from "./auth.js";
import { hashPassword, verifyPassword } from "./passwords.js";

// Cette fonction centralise la validation pour l'inscription et la connexion.
// Elle renvoie les données utilisables, ou null si elles sont invalides.
function credentials(body) {
  if (typeof body?.email !== "string" || typeof body?.password !== "string") return null;
  // Nettoyer l'e-mail permet de rechercher le même compte malgré la casse.
  const email = body.email.trim().toLowerCase();
  // Le mot de passe reste exactement celui saisi, espaces compris.
  const password = body.password;
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  // La décomposition en caractères évite de compter deux fois certains caractères Unicode.
  if ([...password].length < 15 || [...password].length > 128) return null;
  return { email, password };
}

export async function createApp(prisma, jwtSecret) {
  // Le client Prisma partagé donne accès aux mêmes données dans toutes les routes.
  const { issueToken, requireAuth } = createAuthentication(prisma, jwtSecret);
  // Même un compte absent passe par une vérification de hash à la connexion.
  // Cela limite les différences de traitement qui pourraient révéler son existence.
  const dummyHash = await hashPassword("Compte-fictif-pour-verification");
  const app = express();
  // Ces réglages s'appliquent à toutes les requêtes, avant les routes.
  app.disable("x-powered-by");
  // Helmet ajoute des en-têtes HTTP de protection.
  app.use(helmet());
  // Le JSON reçu devient req.body ; la taille du corps est limitée à 10 ko.
  app.use(express.json({ limit: "10kb" }));
  app.use((req, res, next) => {
    // Demander aux clients et aux caches de ne pas conserver les réponses privées.
    res.set("Cache-Control", "no-store");
    // next() laisse la requête poursuivre son trajet vers les routes.
    next();
  });

  // Les deux routes /auth partagent une limite de 10 requêtes par minute et par IP.
  const authLimit = rateLimit({
    windowMs: 60000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Trop de tentatives. Réessayer dans une minute." },
  });
  app.use("/auth", authLimit);

  app.post("/auth/register", async (req, res) => {
    // Valider côté serveur, même si une interface a déjà contrôlé les champs.
    const values = credentials(req.body);
    if (!values) {
      return res.status(400).json({ error: "E-mail valide et mot de passe de 15 à 128 caractères requis." });
    }
    // Seul le hash du mot de passe sera enregistré dans la base.
    const passwordHash = await hashPassword(values.password);
    const user = await prisma.user.create({
      // data indique les champs à écrire ; ne pas transmettre req.body directement.
      data: { email: values.email, passwordHash },
      // select exclut passwordHash des données renvoyées par Prisma.
      select: { id: true, email: true },
    });
    // 201 indique qu'une nouvelle ressource a été créée.
    res.status(201).json(user);
  });

  app.post("/auth/login", async (req, res) => {
    const values = credentials(req.body);
    if (!values) return res.status(401).json({ error: "Identifiants incorrects." });
    // L'e-mail est unique : la recherche renvoie un compte ou null.
    const user = await prisma.user.findUnique({ where: { email: values.email } });
    // Si user est absent, vérifier le hash fictif plutôt que sauter cette étape.
    const valid = await verifyPassword(user?.passwordHash ?? dummyHash, values.password);
    // Le même message couvre un compte absent et un mot de passe incorrect.
    if (!user || !valid) return res.status(401).json({ error: "Identifiants incorrects." });
    res.json({
      // Le client utilisera ce JWT dans l'en-tête Authorization: Bearer ...
      access_token: await issueToken(user.id),
      token_type: "Bearer",
      expires_in: 900, // Durée exprimée en secondes : 15 minutes.
    });
  });

  // requireAuth vérifie le jeton et renseigne req.user avant cette réponse.
  app.get("/me", requireAuth, (req, res) => res.json(req.user));

  app.post("/tickets", requireAuth, async (req, res) => {
    // Accepter uniquement un titre texte, débarrassé des espaces de début et de fin.
    const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
    if (title.length < 3 || title.length > 120) {
      return res.status(400).json({ error: "Titre requis de 3 à 120 caractères." });
    }
    const ticket = await prisma.ticket.create({
      // Le propriétaire vient du compte authentifié, jamais d'un userId fourni par le client.
      data: { title, userId: req.user.id },
      select: { id: true, title: true },
    });
    res.status(201).json(ticket);
  });

  app.get("/tickets", requireAuth, async (req, res) => {
    const tickets = await prisma.ticket.findMany({
      // Ce filtre applique l'autorisation : lire seulement les demandes de ce compte.
      where: { userId: req.user.id },
      select: { id: true, title: true },
      orderBy: { id: "desc" }, // Les identifiants les plus récents en premier.
      take: 100, // Limiter le nombre de lignes retournées.
    });
    res.json(tickets);
  });

  // Arriver ici signifie qu'aucune route n'a répondu à la requête.
  app.use((req, res) => res.status(404).json({ error: "Route introuvable." }));
  // Express reconnaît un gestionnaire d'erreurs à ses quatre paramètres.
  // Express 5 lui transmet aussi les erreurs des routes async.
  app.use((error, req, res, next) => {
    // P2002 correspond à une contrainte unique violée, ici l'e-mail déjà enregistré.
    if (error.code === "P2002") {
      return res.status(409).json({ error: "Inscription impossible avec cet e-mail." });
    }
    // Un corps de requête mal formé ne constitue pas un JSON lisible.
    if (error.type === "entity.parse.failed") {
      return res.status(400).json({ error: "JSON invalide." });
    }
    if (error.type === "entity.too.large") {
      return res.status(413).json({ error: "Requête trop volumineuse." });
    }
    // Éviter de communiquer les détails internes de la BDD ou du serveur au client.
    res.status(500).json({ error: "Erreur interne du serveur." });
  });
  return app;
}
