// GET/PUT/PATCH/DELETE /api/usuario?caminho=/regras   com   Authorization: Bearer <idToken>
// Só acessa /usuarios/{uid} do próprio dono do token. O Firebase confere o token (e as regras) de novo.
const { dbUrl, configurado, lerCorpo, semCache } = require("./_fb");

const METODOS = ["GET", "PUT", "PATCH", "DELETE"];

module.exports = async (req, res) => {
  semCache(res);
  if (!METODOS.includes(req.method)) return res.status(405).json({ erro: "Método não permitido" });
  if (!configurado(res, ["FIREBASE_DB_URL"])) return;
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  let uid = "";
  try { uid = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).user_id || ""; } catch (e) { /* token inválido */ }
  if (!/^[A-Za-z0-9_-]{6,128}$/.test(uid)) return res.status(401).json({ erro: "Sessão inválida" });
  const caminho = String(req.query.caminho || "");
  if (caminho !== "" && !/^\/[A-Za-z0-9_\/-]*$/.test(caminho)) return res.status(400).json({ erro: "Caminho inválido" });
  try {
    const opcoes = { method: req.method, headers: { "Content-Type": "application/json" } };
    if (req.method !== "GET" && req.method !== "DELETE") opcoes.body = JSON.stringify(lerCorpo(req));
    const r = await fetch(`${dbUrl()}/usuarios/${uid}${caminho}.json?auth=${encodeURIComponent(token)}`, opcoes);
    res.status(r.status).setHeader("Content-Type", "application/json").send((await r.text()) || "null");
  } catch (e) {
    res.status(502).json({ erro: "Falha ao consultar o banco" });
  }
};