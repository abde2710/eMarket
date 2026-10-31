# eMarket

Boutique en ligne légère (HTML/CSS/JS + API Node.js) avec **comptes client**, **espace admin** et **tickets client ↔ vendeur** (1 commande = 1 ticket). Hébergement GitHub, déploiement Vercel, zéro dépendance npm.

## Déployer sur Vercel
1. Importer le dépôt GitHub dans Vercel (Framework : *Other*).
2. Ajouter une base **Upstash Redis** (Vercel → Storage / Marketplace) : les variables `KV_REST_API_URL` et `KV_REST_API_TOKEN` sont créées automatiquement.
3. Générer le hash du mot de passe admin : `npm run hash -- "un mot de passe long et unique"`
4. Définir dans *Settings → Environment Variables* :
   - `SESSION_SECRET` : 48+ caractères aléatoires (`openssl rand -base64 48`)
   - `ADMIN_USERNAME` : identifiant admin (à choisir, pas « admin »)
   - `ADMIN_PASSWORD_HASH` : le hash de l'étape 3
5. Admin : `https://votre-site.vercel.app/admin`

Sans ces variables, l'API refuse de démarrer (pas de secret par défaut).

## Développement / tests
```
npm test                                   # 24 tests (node:test, aucune dépendance)
SESSION_SECRET=$(openssl rand -base64 48) npm start   # http://localhost:3000 (stockage en mémoire)
```

## Sécurité en bref
Mots de passe scrypt · sessions signées HMAC (cookies HttpOnly, SameSite=Strict, `__Host-` en prod), révocation à la déconnexion · cookies et audiences séparés admin/client · limitation de tentatives · réponses identiques compte inconnu/mauvais mot de passe · anti-CSRF (Origin + JSON) · contrôle d'accès par propriétaire sur commandes/tickets · prix et stock décidés côté serveur · CSP stricte (aucun script inline, aucun `innerHTML`).
