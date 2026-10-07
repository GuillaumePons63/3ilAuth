import { SignJWT, jwtVerify } from "jose";

export function createAuthentication(prisma, secret) {
  // Refuser un secret absent, trop court ou encore égal au texte d'exemple.
  if (!secret || secret.length < 32 || secret.includes("REMPLACER")) {
    throw new Error("JWT_SECRET : générer un secret aléatoire de 32 caractères minimum.");
  }
  // jose attend une clé sous forme d'octets pour signer avec HS256.
  const key = new TextEncoder().encode(secret);

  async function issueToken(userId) {
    // Le payload commence vide : aucun mot de passe ni donnée sensible n'y est ajouté.
    return new SignJWT({})
      .setProtectedHeader({ alg: "HS256" }) // Algorithme de signature.
      .setSubject(String(userId)) // sub : identifiant du compte.
      .setIssuer("3il-cours") // iss : nom de l'émetteur du jeton.
      .setAudience("3il-api") // aud : API à laquelle le jeton est destiné.
      .setIssuedAt() // iat : date d'émission.
      .setExpirationTime("15m") // exp : fin de validité.
      .sign(key); // La signature permet de vérifier l'intégrité, pas de chiffrer le contenu.
  }

  async function requireAuth(req, res, next) {
    // Le client doit présenter son jeton dans Authorization: Bearer <jeton>.
    const header = req.get("authorization");
    if (!header?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Authentification requise." });
    }
    let payload;
    try {
      // slice(7) enlève le préfixe "Bearer " pour conserver uniquement le JWT.
      // jwtVerify vérifie la signature et l'expiration, puis les règles précisées ici.
      ({ payload } = await jwtVerify(header.slice(7), key, {
        algorithms: ["HS256"], // Accepter uniquement l'algorithme prévu.
        issuer: "3il-cours",
        audience: "3il-api",
        requiredClaims: ["sub", "exp", "iat"], // Ces champs doivent être présents.
      }));
    } catch {
      // Un jeton altéré ou expiré donne la même réponse qu'une authentification absente.
      return res.status(401).json({ error: "Authentification requise." });
    }
    // Le JWT contient un texte ; Prisma attend un entier pour User.id.
    const userId = Number(payload.sub);
    // Refuser un identifiant qui ne correspond pas au type Int positif utilisé dans la BDD.
    if (!Number.isSafeInteger(userId) || userId < 1 || userId > 2147483647) {
      return res.status(401).json({ error: "Authentification requise." });
    }
    try {
      // Vérifier que le compte existe toujours, même si le JWT est valide.
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true }, // Ne pas charger le hash du mot de passe.
      });
      if (!user) return res.status(401).json({ error: "Authentification requise." });
      // Les routes suivantes récupèrent cette identité vérifiée dans req.user.
      req.user = user;
      // Autoriser Express à poursuivre le traitement vers la route protégée.
      next();
    } catch (error) {
      // Une erreur de BDD passe au gestionnaire d'erreurs, plutôt que devenir un faux 401.
      next(error);
    }
  }

  // Fournir une fonction de création de jeton et un middleware de protection des routes.
  return { issueToken, requireAuth };
}
