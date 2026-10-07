# Correction — Prisma, SQLite et authentification

API du TP de troisième année. Node.js 24 et npm sont requis. Express, `async/await` et `import/export` sont les prérequis du cours.

## Installer depuis une copie propre

Dans le dossier `correction`, ouvrir un terminal PowerShell :

```powershell
npm ci
Copy-Item .env.example .env
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Reporter la valeur générée dans `JWT_SECRET` du fichier `.env`. Le placeholder fourni est volontairement refusé. Garder `DATABASE_URL="file:./dev.db"` et `RUST_LOG=info`. Toutes les commandes sont lancées depuis la racine de la correction : la CLI et le pilote ouvrent ainsi le même fichier `dev.db`.

`RUST_LOG=info` règle le niveau de journalisation du moteur de migration. Ce réglage contourne une erreur `Schema engine error` reproduite pendant la création initiale d'une base SQLite avec la version retenue. Un [signalement dans le dépôt Prisma](https://github.com/prisma/prisma/issues/29355) décrit le même contournement. Si une autre erreur persiste, lire son diagnostic avant de modifier ou supprimer une base.

```powershell
npm run db:generate
$env:RUST_LOG="info"
npm run db:migrate -- --name init
npm start
```

La commande applique la migration fournie à la base locale et crée le fichier si nécessaire. Ouvrir `dev.db` avec DB Browser for SQLite et actualiser la vue après chaque requête. L'API écoute sur `http://localhost:3000`, uniquement en local. Utiliser `requetes.http` avec un client HTTP compatible, ou recopier les requêtes dans Postman. Aucun compte n'est précréé.

## Parcours de vérification

Inscrire Alice et Bob, connecter chaque compte, puis copier leurs `access_token` dans les variables du fichier HTTP. Créer une demande avec Alice, vérifier qu'elle la voit et que Bob reçoit une liste vide. Ajouter `userId` dans le JSON ne change pas le propriétaire : le serveur utilise l'identité vérifiée. Redémarrer le serveur et se reconnecter pour observer la persistance.

```powershell
npm test
```

Les tests créent une base temporaire avec la migration versionnée et vérifient hachage, validation, doublons, connexion, limitation des tentatives, JWT altéré/expiré, claims, propriété et persistance. Ils ne touchent pas `dev.db`.

## Contrat de l'API

| Route | Entrée | Succès | Erreurs attendues |
| --- | --- | --- | --- |
| `POST /auth/register` | JSON `email`, `password` | 201 : `id`, `email` | 400 : invalide ; 409 : doublon |
| `POST /auth/login` | JSON `email`, `password` | 200 : `access_token`, `token_type`, `expires_in` | 401 : identifiants incorrects |
| `GET /me` | Bearer | 200 : `id`, `email` | 401 : jeton invalide/absent |
| `POST /tickets` | Bearer + JSON `title` | 201 : `id`, `title` | 400 : titre invalide ; 401 |
| `GET /tickets` | Bearer | 200 : ses demandes, 100 maximum, récentes d'abord | 401 |

Les routes `/auth` partagent une limite de 10 requêtes par minute et par IP, avec réponse 429. Attendre une minute après une longue série de tests manuels. Cette limite en mémoire sert au cours ; un déploiement multi-instance doit partager son compteur. Le mot de passe contient 15 à 128 caractères Unicode ; il n'est ni normalisé ni tronqué. L'e-mail est nettoyé et converti en minuscules pour ce TP.

## Comprendre les fichiers

`prisma/schema.prisma` décrit les modèles. `prisma.config.js` configure la CLI et l'URL de migration. `src/db.js` crée le client et son adaptateur SQLite. `src/passwords.js` hache et vérifie les mots de passe. `src/auth.js` signe et vérifie les JWT. `src/app.js` compose les middlewares et les routes. `src/server.js` démarre et ferme le serveur.

Prisma est verrouillé en **7.6.0**. Le générateur `prisma-client-js` produit ici du JavaScript afin de ne pas ajouter TypeScript à ce cours. Il est encore disponible en Prisma 7, mais annoncé comme remplacé à terme par `prisma-client`. Ne pas mettre à jour les packages Prisma indépendamment ou reprendre aveuglément une commande utilisant `latest`. Un changement de schéma nécessite une migration et une nouvelle génération du client.

## Sécurité expliquée

Argon2id utilise un sel aléatoire généré par la bibliothèque, 19 MiB de mémoire, deux passes et un degré de parallélisme. Le hash encodé contient algorithme, paramètres et sel. La comparaison passe par `argon2.verify`. Le hachage protège les mots de passe stockés ; HTTPS protège leur transport. Les requêtes ORM utilisent des paramètres, mais l'autorisation et la validation restent à écrire dans le serveur.

Le JWT est signé en HS256, expire après 15 minutes, et contient uniquement les claims d'identité et de validité. Le middleware contrôle signature, algorithme, émetteur, destinataire, claims obligatoires, expiration et existence du compte. Son contenu est lisible. Ne pas y placer de mot de passe ou de secret.

Le jeton reste dans le client HTTP du TP. Une application navigateur doit choisir son stockage et traiter les risques XSS/CSRF selon ce choix. Effacer un JWT côté client ne le révoque pas : il reste valide jusqu'à expiration. Il n'y a ni refresh token ni déconnexion serveur dans cet exercice. Les hashes ne sont jamais retournés et les corps de requêtes/jetons ne sont pas journalisés.

Le message de connexion est identique pour compte absent et mot de passe incorrect. Un hash fictif limite la différence de traitement cryptographique. L'inscription répond 409 en cas de doublon pour faciliter l'observation de la contrainte unique ; cela peut révéler l'existence d'un compte. Une inscription publique peut demander une réponse uniforme et une vérification d'e-mail, hors du TP.

## Faire évoluer et livrer

Après une modification du schéma, utiliser `npm run db:migrate -- --name nom_du_changement`, puis `npm run db:generate`. Versionner le schéma, les migrations et `package-lock.json`. Livrer le code et `.env.example`, en excluant `.env`, les fichiers `.db`, `node_modules` et le client généré. La correction ZIP suit ces exclusions.

## Références

- [Prisma 7 et SQLite](https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases/sqlite)
- [Générateurs Prisma 7](https://www.prisma.io/docs/orm/v7/prisma-schema/overview/generators)
- [node-argon2](https://github.com/ranisalt/node-argon2)
- [OWASP : stockage des mots de passe](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [OWASP : authentification](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [jose](https://github.com/panva/jose)
