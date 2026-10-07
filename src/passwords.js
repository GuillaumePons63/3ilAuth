import argon2 from "argon2";

export function hashPassword(password) {
  // La bibliothèque crée un sel aléatoire et l'intègre au hash encodé.
  // Chaque appel peut donc produire un hash différent pour le même mot de passe.
  return argon2.hash(password, {
    type: argon2.argon2id, // Algorithme adapté au stockage des mots de passe.
    memoryCost: 19456, // Mémoire en Kio : 19 Mio.
    timeCost: 2, // Deux passes de calcul.
    parallelism: 1, // Un degré de parallélisme.
  });
}

export function verifyPassword(hash, password) {
  // Réutiliser le sel et les paramètres du hash enregistré pour vérifier la saisie.
  // La promesse renvoie true si le mot de passe correspond, sinon false.
  return argon2.verify(hash, password);
}
