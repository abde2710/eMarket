// Usage : npm run hash -- "MonMotDePasseLong"  → copier le résultat dans ADMIN_PASSWORD_HASH (Vercel)
import { hashPassword } from '../lib/core.js';
const pw = process.argv[2];
if (!pw || pw.length < 12) { console.error('Mot de passe de 12 caractères minimum requis.'); process.exit(1); }
console.log(await hashPassword(pw));
