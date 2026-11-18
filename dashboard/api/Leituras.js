// GET /api/leituras?est=est01&limite=3000  ->  leituras da estação (o navegador não vê a URL nem a credencial do banco)
const { dbUrl, configurado, credencialAdmin, semCache } = require("./_fb");

module.exports = async (req, res) => {
  semCache(res);
  if (req.method !== "GET") return res.status(405).json({ erro: "Método não permitido" });
  if (!configurado(res, ["FIREBASE_DB_URL"]) || !(process.env.FIREBASE_DB_SECRET || configurado(res, ["FIREBASE_SERVICE_ACCOUNT"]))) return;
  const est = String(req.query.est || "");
  if (!/^est\d{2}$/.test(est)) return res.status(400).json({ erro: "Estação inválida" });
  const limite = Math.min(Math.max(parseInt(req.query.limite, 10) || 3000, 1), 5000);
  try {
    const q = new URLSearchParams({ orderBy: '"$key"', limitToLast: String(limite), ...(await credencialAdmin()) });
    const r = await fetch(`${dbUrl()}/estacoes/${est}/leituras.json?${q}`);
    const texto = await r.text();
    res.status(r.status).setHeader("Content-Type", "application/json").send(texto || "null");
  } catch (e) {
    res.status(502).json({ erro: "Falha ao consultar o banco" });
  }
};