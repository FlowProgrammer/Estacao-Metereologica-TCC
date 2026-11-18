// POST /api/auth  { acao: "signUp" | "signInWithPassword" | "refresh", email, password | refreshToken }
// Repassa ao Firebase Authentication com a Web API Key, que fica só no servidor.
const { configurado, lerCorpo, semCache } = require("./_fb");

module.exports = async (req, res) => {
  semCache(res);
  if (req.method !== "POST") return res.status(405).json({ erro: "Método não permitido" });
  if (!configurado(res, ["FIREBASE_API_KEY"])) return;
  const c = lerCorpo(req);
  const key = encodeURIComponent(process.env.FIREBASE_API_KEY);
  try {
    let r;
    if (c.acao === "signUp" || c.acao === "signInWithPassword") {
      r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:${c.acao}?key=${key}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: String(c.email || ""), password: String(c.password || ""), returnSecureToken: true })
      });
    } else if (c.acao === "refresh") {
      r = await fetch(`https://securetoken.googleapis.com/v1/token?key=${key}`, {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: String(c.refreshToken || "") })
      });
    } else {
      return res.status(400).json({ erro: "Ação inválida" });
    }
    res.status(r.status).setHeader("Content-Type", "application/json").send(await r.text());
  } catch (e) {
    res.status(502).json({ erro: "Falha ao falar com o Firebase Authentication" });
  }
};