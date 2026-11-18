// Utilidades das funções do Vercel. Arquivos que começam com "_" não viram rotas.
// Variáveis de ambiente (Vercel > Settings > Environment Variables):
//   FIREBASE_DB_URL           URL do Realtime Database (https://xxxx-default-rtdb.firebaseio.com)
//   FIREBASE_API_KEY          Web API Key do projeto (só o servidor usa)
//   FIREBASE_SERVICE_ACCOUNT  JSON inteiro da conta de serviço (Firebase > Configurações > Contas de serviço)
//   FIREBASE_DB_SECRET        (alternativa mais simples, legado) segredo do banco, no lugar da conta de serviço
const crypto = require("crypto");

const dbUrl = () => String(process.env.FIREBASE_DB_URL || "").replace(/\/+$/, "");

function configurado(res, nomes) {
  const falta = nomes.filter(n => !process.env[n]);
  if (falta.length) {
    res.status(500).json({ erro: "Servidor sem configuração: " + falta.join(", ") });
    return false;
  }
  return true;
}

let cache = { token: null, exp: 0 };
// Credencial administrativa para ler o banco (ignora as regras, que ficam fechadas para o público)
async function credencialAdmin() {
  if (process.env.FIREBASE_DB_SECRET) return { auth: process.env.FIREBASE_DB_SECRET };
  if (cache.token && Date.now() < cache.exp - 60000) return { access_token: cache.token };
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  const agora = Math.floor(Date.now() / 1000);
  const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url");
  const corpo = b64({ alg: "RS256", typ: "JWT" }) + "." + b64({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email",
    aud: "https://oauth2.googleapis.com/token", iat: agora, exp: agora + 3600
  });
  const assinatura = crypto.createSign("RSA-SHA256").update(corpo).sign(sa.private_key, "base64url");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: corpo + "." + assinatura })
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error("Não foi possível obter o token do Firebase");
  cache = { token: j.access_token, exp: Date.now() + Number(j.expires_in || 3600) * 1000 };
  return { access_token: cache.token };
}

function lerCorpo(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try { return JSON.parse(req.body || "{}"); } catch (e) { return {}; }
}

function semCache(res) { res.setHeader("Cache-Control", "no-store"); }

module.exports = { dbUrl, configurado, credencialAdmin, lerCorpo, semCache };