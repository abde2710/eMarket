// Serveur local de développement : `SESSION_SECRET=… npm start` (en production, Vercel sert public/ et api/)
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import handler from './api/[...slug].js';
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) return handler(req, res);
  let p = new URL(req.url, 'http://x').pathname; if (p === '/') p = '/index.html'; if (p === '/admin') p = '/admin.html';
  const f = path.join('public', path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  fs.readFile(f, (e, d) => { if (e) { res.statusCode = 404; return res.end('404'); } res.setHeader('Content-Type', types[path.extname(f)] || 'application/octet-stream'); res.end(d); });
}).listen(process.env.PORT || 3000, () => console.log('http://localhost:' + (process.env.PORT || 3000)));
