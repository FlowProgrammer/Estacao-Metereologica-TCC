"use strict";

/* =====================================================================
   ClimaSense: dashboard da estação meteorológica
   ESP32 -> Firebase Realtime Database -> este dashboard (+ API Open-Meteo)

   O navegador NÃO fala com o Firebase: ele chama as funções da pasta api/
   (Vercel), que guardam a URL do banco e as chaves em variáveis de ambiente.
   Para testar sem o Vercel, abra a página com ?demo=1 (dados simulados).
   ===================================================================== */
const CONFIG = {
  api: "/api",            // funções do Vercel (pasta api/): leituras, auth e usuario
  demo: false,            // true = dados simulados no navegador (também vale abrir a página com ?demo=1)
  estacao: "est01",       // estação padrão (a simulada)
  estacoes: {             // estações disponíveis: o id precisa ser o mesmo ESTACAO_ID gravado no firmware
    est01: { nome: "Simulada (Wokwi)", tipo: "simulada" },
    est02: { nome: "Real (circuito da sala)", tipo: "real" }
  },
  altitude: 211,          // metros; igual ao ALTITUDE_M do sketch.ino (só usado no modo demonstração)
  lat: -12.27,            // Feira de Santana (BA), aproximado. Ajuste para o seu local.
  lon: -38.97,
  fusoApi: "America/Bahia",
  atualizarMs: 10000,     // consulta ao Firebase
  atualizarApiMs: 600000, // consulta à Open-Meteo (10 min)
  limiteLeituras: 3000,
  margens: { t: 1.5, u: 6, p: 3, o: 2 },   // validação Sensor × Open-Meteo: °C, pontos percentuais de umidade, hPa (PRNF02) e ponto de orvalho (°C, só indicativa)
  localNome: "SENAI, Feira de Santana (BA)"
};
const emDemo = () => CONFIG.demo || new URLSearchParams(location.search).has("demo");

const COR = { est: "#377c70", estClara: "#9cc3b9", api: "#4b8fb2", alerta: "#c76d5d",
              chuva: "#4b8fb2", grade: "#edf0ef", mudo: "#6d7b78", tinta: "#182724" };

/* Ícones do design (mesmos traçados do mock). <svg data-i="nome"> é preenchido por montarIcones(). */
const ICONES = {
  cloud: '<path d="M17.5 19H7a5 5 0 1 1 1-9.9A7 7 0 0 1 21 12.5 3.5 3.5 0 0 1 17.5 19Z"/><path d="M8 19h9.5"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  chart: '<path d="M4 19V5"/><path d="M4 19h16"/><path d="m7 15 4-4 3 2 5-6"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/>',
  sliders: '<path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h7M15 18h5"/><circle cx="16" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="13" cy="18" r="2"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42"/>',
  droplet: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11Z"/>',
  wind: '<path d="M3 8h12a3 3 0 1 0-3-3"/><path d="M3 12h16a2 2 0 1 1-2 2"/><path d="M3 16h8"/>',
  gauge: '<path d="M4 14a8 8 0 0 1 16 0"/><path d="m12 14 4-5"/><path d="M6 18h12"/>',
  rain: '<path d="M17 14H7a4 4 0 1 1 1-7.9A6 6 0 0 1 19 9a3 3 0 0 1-2 5Z"/><path d="m8 17-1 2M13 17l-1 2M18 17l-1 2"/>',
  arrow: '<path d="M5 12h14"/><path d="m14 7 5 5-5 5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  leaf: '<path d="M20 4S10 3 6 8s0 10 0 10 5 4 10 0 4-14 4-14Z"/><path d="M4 21c3-7 7-10 12-13"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V4H6.5A2.5 2.5 0 0 0 4 6.5v13Z"/><path d="M8 8h8M8 12h6"/>',
  shield: '<path d="M12 3 4 6v5c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V6l-8-3Z"/><path d="m9 12 2 2 4-4"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/>',
  logout: '<path d="M10 17l5-5-5-5M15 12H3"/><path d="M14 4h5a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-5"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  alert: '<path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4M12 17h.01"/>'
};
function icone(nome, tam = 20, classe = "") {
  return `<svg class="i ${classe}" width="${tam}" height="${tam}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES[nome] || ""}</svg>`;
}
function montarIcones(raiz) {
  (raiz || document).querySelectorAll("svg[data-i]").forEach(el => {
    const t = el.getAttribute("data-size") || 20;
    el.setAttribute("width", t); el.setAttribute("height", t);
    el.setAttribute("viewBox", "0 0 24 24"); el.setAttribute("fill", "none");
    el.setAttribute("stroke", "currentColor"); el.setAttribute("stroke-width", "1.8");
    el.setAttribute("stroke-linecap", "round"); el.setAttribute("stroke-linejoin", "round");
    el.setAttribute("aria-hidden", "true");
    el.innerHTML = ICONES[el.getAttribute("data-i")] || "";
    el.removeAttribute("data-i");
  });
}
const NIVEIS = ["Liberado", "Atenção", "Adiar"];

/* Atividades RECOMENDADAS, por perfil. A conta nova começa sem atividades: a pessoa ativa
   as recomendadas (os critérios são copiados para a conta e ficam editáveis) ou cria as suas.
   Os limites são exemplos e devem ser validados com professores e técnicos da área.
   Tudo é salvo na própria conta (Firebase). Visitantes veem estas recomendações só para leitura.
   Liberado = nenhum critério se aplica. Cada regra: variável, operador, limite, nível. */
const ATIVIDADES_PADRAO = {
  educacao_fisica: {
    nome: "Educação física", perfil: "escola",
    regras: [
      { v: "chuva_api_3h", op: ">=", lim: 50, nivel: "atencao" },
      { v: "chuva_api_3h", op: ">=", lim: 70, nivel: "adiar" },
      { v: "chuva_estacao", op: ">=", lim: 35, nivel: "atencao" },
      { v: "chuva_estacao", op: ">=", lim: 70, nivel: "adiar" },
      { v: "indice_calor", op: ">=", lim: 32, nivel: "atencao" },
      { v: "indice_calor", op: ">=", lim: 39, nivel: "adiar" }
    ]
  },
  evento_aberto: {
    nome: "Eventos e aulas ao ar livre", perfil: "escola",
    regras: [
      { v: "chuva_api_3h", op: ">=", lim: 30, nivel: "atencao" },
      { v: "chuva_api_3h", op: ">=", lim: 50, nivel: "adiar" },
      { v: "chuva_estacao", op: ">=", lim: 35, nivel: "atencao" },
      { v: "chuva_estacao", op: ">=", lim: 70, nivel: "adiar" },
      { v: "indice_calor", op: ">=", lim: 32, nivel: "atencao" },
      { v: "indice_calor", op: ">=", lim: 39, nivel: "adiar" }
    ]
  },
  irrigacao: {
    nome: "Irrigação", perfil: "agricola",
    regras: [
      { v: "chuva_api_6h", op: ">=", lim: 40, nivel: "atencao" },
      { v: "chuva_api_6h", op: ">=", lim: 60, nivel: "adiar" }
    ]
  },
  pulverizacao: {
    nome: "Pulverização", perfil: "agricola",
    regras: [
      { v: "vento_api", op: ">=", lim: 8, nivel: "atencao" },
      { v: "vento_api", op: ">", lim: 10, nivel: "adiar" },
      { v: "vento_api", op: "<", lim: 3, nivel: "atencao" },
      { v: "umidade", op: "<", lim: 60, nivel: "atencao" },
      { v: "umidade", op: "<", lim: 55, nivel: "adiar" },
      { v: "temperatura", op: ">", lim: 28, nivel: "atencao" },
      { v: "temperatura", op: ">", lim: 30, nivel: "adiar" },
      { v: "chuva_api_3h", op: ">=", lim: 20, nivel: "atencao" },
      { v: "chuva_api_3h", op: ">=", lim: 40, nivel: "adiar" }
    ]
  },
  colheita: {
    nome: "Plantio e colheita", perfil: "agricola",
    regras: [
      { v: "chuva_api_6h", op: ">=", lim: 40, nivel: "atencao" },
      { v: "chuva_api_6h", op: ">=", lim: 60, nivel: "adiar" }
    ]
  }
};
const VARIAVEIS = {
  temperatura: ["Temperatura", "°C", 1],
  umidade: ["Umidade do ar", "%", 0],
  indice_calor: ["Índice de calor", "°C", 1],
  chuva_estacao: ["Chance de chuva da estação (pontuação)", "pontos", 0],
  chuva_api_3h: ["Chance de chuva (API, 3 h)", "%", 0],
  chuva_api_6h: ["Chance de chuva (API, 6 h)", "%", 0],
  vento_api: ["Vento previsto (API)", "km/h", 0],
  queda_pressao_3h: ["Queda de pressão em 3 h", "hPa", 1]
};

/* ---------------------------- utilidades ---------------------------- */
const fmt = (n, d = 1) => (n == null || isNaN(n)) ? "—" : n.toFixed(d).replace(".", ",").replace("-", "−");
const sgn = (n, d = 1) => (n == null || isNaN(n)) ? "—" : (n >= 0 ? "+" : "−") + Math.abs(n).toFixed(d).replace(".", ",");
const clip = (v, a, b) => Math.max(a, Math.min(b, v));
const hhmm = ms => new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const dataHoraCompleta = ms => new Date(ms).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
const dataHoraCurta = ms => new Date(ms).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/* ----------------------------- cálculos ----------------------------- */
function pontoOrvalho(t, u) {              // fórmula de Magnus
  const a = 17.62, b = 243.12;
  const g = Math.log(u / 100) + a * t / (b + t);
  return b * g / (a - g);
}

function indiceCalor(tC, ur) {             // regressão do NWS (EUA); vale para calor
  const T = tC * 9 / 5 + 32;
  let hi = 0.5 * (T + 61 + ((T - 68) * 1.2) + (ur * 0.094));
  if ((hi + T) / 2 >= 80) {
    hi = -42.379 + 2.04901523 * T + 10.14333127 * ur
       - 0.22475541 * T * ur - 0.00683783 * T * T - 0.05481717 * ur * ur
       + 0.00122874 * T * T * ur + 0.00085282 * T * ur * ur
       - 0.00000199 * T * T * ur * ur;
  }
  return (hi - 32) * 5 / 9;
}

/* Variação em 3 h por regressão linear nas leituras das últimas 3 h.
   Com menos de 3 h de dados, é a taxa equivalente a 3 h. */
function tendencia(leituras) {
  if (!leituras.length) return null;
  const fim = leituras[leituras.length - 1].ts;
  const j = leituras.filter(l => l.ts >= fim - 3 * 3600);
  if (j.length < 3 || j[j.length - 1].ts - j[0].ts < 300) return null;
  const x = j.map(l => (l.ts - j[0].ts) / 3600);
  const mx = x.reduce((a, b) => a + b, 0) / x.length;
  const inclinacao = campo => {
    const y = j.map(l => l[campo]);
    const my = y.reduce((a, b) => a + b, 0) / y.length;
    let num = 0, den = 0;
    for (let i = 0; i < x.length; i++) { num += (x[i] - mx) * (y[i] - my); den += (x[i] - mx) ** 2; }
    return den ? num / den : 0;
  };
  return { p3: inclinacao("p") * 3, u3: inclinacao("u") * 3, delta: j[j.length - 1].p - j[0].p, deltaU: j[j.length - 1].u - j[0].u,
           horas: (j[j.length - 1].ts - j[0].ts) / 3600 };
}

/* Com menos de 3 h de dados, mostra a variação real da janela (ex.: "9,9 hPa em 17 min")
   em vez de extrapolar para 3 h. O ritmo equivalente a 3 h continua valendo para a pontuação. */
function ritmoTexto(p3) {     // evita mostrar valores absurdos quando a janela de dados é curta
  return Math.abs(p3) > 20 ? "mais de 20 hPa em 3 h" : `${sgn(p3)} hPa em 3 h`;
}
function variacaoPressao(trend) {
  if (trend.horas < 2.9) return { cai: trend.delta < 0, valor: Math.abs(trend.delta), janela: `${Math.max(1, Math.round(trend.horas * 60))} min`, parcial: true };
  return { cai: trend.p3 < 0, valor: Math.abs(trend.p3), janela: "3 h", parcial: false };
}

function anomalia(leituras) {              // pressão agora menos a do mesmo horário de ontem
  if (!leituras.length) return null;
  const ult = leituras[leituras.length - 1];
  const alvo = ult.ts - 86400;
  let melhor = null, dist = Infinity;
  for (const l of leituras) {
    const d = Math.abs(l.ts - alvo);
    if (d < dist) { dist = d; melhor = l; }
  }
  return (melhor && dist <= 900) ? ult.p - melhor.p : null;
}

function estimarChuva(v) {                 // v: { p3, anom, u, spread, hora }
  const f = [
    { nome: "Tendência da pressão",
      det: v.p3 == null ? "sem dados suficientes" : (v.horas < 2.9
        ? `${sgn(v.delta)} hPa em ${Math.max(1, Math.round(v.horas * 60))} min (ritmo equivalente a ${ritmoTexto(v.p3)})`
        : `${sgn(v.p3)} hPa em 3 h`),
      pts: v.p3 == null ? 0 : Math.round(clip(11 * Math.max(0, -v.p3), 0, 40)) },
    { nome: "Pressão abaixo do normal para a hora",
      det: v.anom == null ? "sem dados de ontem" : `${sgn(v.anom)} hPa em relação a ontem`,
      pts: v.anom == null ? 0 : Math.round(clip(5 * Math.max(0, -v.anom), 0, 25)) },
    { nome: "Umidade alta", det: `${fmt(v.u, 0)} %`,
      pts: Math.round(clip(0.7 * Math.max(0, v.u - 55), 0, 20)) },
    { nome: "Ponto de orvalho próximo", det: `${fmt(v.spread)} °C abaixo da temperatura`,
      pts: Math.round(clip(4 * Math.max(0, 6 - v.spread), 0, 15)) },
    { nome: "Hora do dia (tarde)", det: "chuvas de tarde são mais comuns",
      pts: (v.hora >= 13 && v.hora < 19) ? 3 : 0 }
  ];
  const total = Math.min(100, f.reduce((s, x) => s + x.pts, 0));
  const cat = total < 35 ? "Baixa" : (total < 70 ? "Média" : "Alta");
  return { fatores: f, total, cat, parcial: v.p3 == null };
}

function avaliarAtividade(ativ, vars) {
  const porVariavel = {};
  for (const r of ativ.regras || []) {
    const val = vars[r.v];
    if (val == null || isNaN(val)) continue;
    const ok = r.op === ">=" ? val >= r.lim : r.op === ">" ? val > r.lim
             : r.op === "<=" ? val <= r.lim : val < r.lim;
    if (!ok) continue;
    const n = r.nivel === "adiar" ? 2 : 1;
    const atual = porVariavel[r.v];
    // mantém só a regra mais grave de cada variável (evita motivos repetidos)
    if (atual && (atual.n > n || (atual.n === n && atual.lim >= r.lim))) continue;
    const [nome, un, d] = VARIAVEIS[r.v] || [r.v, "", 1];
    porVariavel[r.v] = { n, lim: r.lim,
      texto: `${nome}: ${fmt(val, d)} ${un} (limite ${r.op.replace(">=", "≥").replace("<=", "≤")} ${r.lim})` };
  }
  const motivos = Object.values(porVariavel).sort((a, b) => b.n - a.n);
  return { nivel: motivos.length ? motivos[0].n : 0, motivos };
}

/* ------------------------------ dados ------------------------------ */
const estado = { estacao: null, localVisitante: null, leituras: [], api: null, conta: null, rascunho: {}, descartadas: 0, erro: null, periodo: "sessao", escalaTotal: false, apiErro: null,
                 expandidas: {}, filtroRegras: "todos", buscaRegras: "", calMes: {}, vistoNiveis: {}, niveisAtuais: {}, alertasSig: "", alertasVistos: "" };

/* ---------------- estação e local ativos ----------------
   Estação: a escolhida no seletor (visitante: lembrada no navegador; conta: salva no perfil).
   Local: o da conta (CEP informado no cadastro) ou o padrão do CONFIG. Altitude, latitude e
   longitude vêm daqui: a pressão ao nível do mar é recalculada no dashboard a partir da pressão
   medida (campo "pe"), então trocar a altitude não exige regravar o firmware. */
const estacaoValida = id => !!(id && CONFIG.estacoes[id]);
const idEstacao = () => estacaoValida(estado.estacao) ? estado.estacao : CONFIG.estacao;
const localPadrao = () => ({ nome: CONFIG.localNome, lat: CONFIG.lat, lon: CONFIG.lon, altitude: CONFIG.altitude });
const localAtivo = () => (estado.conta && estado.conta.local) || localPadrao();
const nomeEstacao = () => (CONFIG.estacoes[idEstacao()] || {}).nome || idEstacao();
const pressaoNivelMar = (pe, alt) => pe / Math.pow(1 - alt / 44330, 5.255);

function gerarDemo() {
  const agora = Math.floor(Date.now() / 1000);
  const passo = 600, n = 3 * 144;
  const out = [];
  const alt = localAtivo().altitude || 234;
  for (let i = n; i >= 0; i--) {
    const ts = agora - i * passo;
    const d = new Date(ts * 1000);
    const h = d.getHours() + d.getMinutes() / 60;
    const horasAtras = i * passo / 3600;
    const queda = horasAtras < 5 ? (5 - horasAtras) * 0.45 : 0;
    const sub = horasAtras < 3 ? (3 - horasAtras) * 3.3 : 0;
    const p = 1012.2 + 0.85 * Math.cos(2 * Math.PI * (h - 10) / 12) - queda + (Math.random() - 0.5) * 0.12;
    const t = 25.8 + 3.4 * Math.sin(2 * Math.PI * (h - 9) / 24) - sub * 0.25 + (Math.random() - 0.5) * 0.2;
    const u = clip(82 - 13 * Math.sin(2 * Math.PI * (h - 9) / 24) + sub + (Math.random() - 0.5), 30, 99);
    out.push({ ts, t, u, p, pe: p * Math.pow(1 - alt / 44330, 5.255) });
  }
  return out;
}

/* Valores fisicamente impossíveis (sensor com defeito, comando de teste extremo) ficam
   fora dos gráficos e dos cálculos, e o dashboard avisa quantos foram ignorados. */
const leituraValida = l => l.p >= 870 && l.p <= 1090 && l.t >= -20 && l.t <= 60 && l.u >= 0 && l.u <= 100;

async function buscarLeituras() {
  if (emDemo()) { estado.descartadas = 0; return gerarDemo(); }
  const r = await fetch(`${CONFIG.api}/leituras?est=${encodeURIComponent(idEstacao())}&limite=${CONFIG.limiteLeituras}`);
  if (!r.ok) throw new Error("Servidor respondeu HTTP " + r.status);
  const obj = await r.json();
  if (!obj) { estado.descartadas = 0; return []; }
  const alt = Number(localAtivo().altitude);
  const todas = Object.entries(obj)
    .map(([k, v]) => ({ ts: Number(v.ts ?? k), t: Number(v.t), u: Number(v.u), pe: Number(v.pe), p: Number(v.p) }))
    .map(l => (isFinite(alt) && isFinite(l.pe) && l.pe > 0 ? { ...l, p: pressaoNivelMar(l.pe, alt) } : l))   // usa a altitude do local ativo
    .filter(l => isFinite(l.ts) && isFinite(l.p) && isFinite(l.t) && isFinite(l.u))
    .sort((a, b) => a.ts - b.ts);
  const validas = todas.filter(leituraValida);
  estado.descartadas = todas.length - validas.length;
  return validas;
}

async function buscarApi() {
  const url = "https://api.open-meteo.com/v1/forecast"
    + `?latitude=${localAtivo().lat}&longitude=${localAtivo().lon}`
    + "&current=temperature_2m,relative_humidity_2m,pressure_msl,dew_point_2m"
    + "&hourly=precipitation_probability,precipitation,wind_speed_10m,temperature_2m,cloud_cover"
    + "&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max"
    + `&timezone=${encodeURIComponent(CONFIG.fusoApi)}&timeformat=unixtime&forecast_days=5`;
  const r = await fetch(url);
  if (!r.ok) throw new Error("Open-Meteo respondeu HTTP " + r.status);
  const j = await r.json();
  const h = j.hourly, agora = Date.now() / 1000;
  let idx = 0;
  for (let i = 0; i < h.time.length; i++) if (h.time[i] <= agora) idx = i;
  const fatia = (arr, n) => arr.slice(idx, idx + n);
  const max = a => { const v = a.filter(x => x != null); return v.length ? Math.max(...v) : null; };
  const d = j.daily || {};
  return {
    consultadoEm: Date.now(),
    atual: j.current ? { ts: j.current.time, t: j.current.temperature_2m, u: j.current.relative_humidity_2m, p: j.current.pressure_msl, o: j.current.dew_point_2m } : null,
    horas: fatia(h.time, 12),
    prob: fatia(h.precipitation_probability, 12),
    mm: fatia(h.precipitation, 12),
    vento: fatia(h.wind_speed_10m, 12),
    temp: fatia(h.temperature_2m || [], 12),
    nuvens: fatia(h.cloud_cover || [], 12),
    dias: (d.time || []).map((t, i) => ({
      ts: t, max: d.temperature_2m_max[i], min: d.temperature_2m_min[i],
      prob: d.precipitation_probability_max ? d.precipitation_probability_max[i] : null,
      vento: d.wind_speed_10m_max ? d.wind_speed_10m_max[i] : null
    })),
    chuva3h: max(fatia(h.precipitation_probability, 3)),
    chuva6h: max(fatia(h.precipitation_probability, 6)),
    ventoAgora: h.wind_speed_10m[idx]
  };
}

/* ----------------------- valores derivados atuais ----------------------- */
function derivados() {
  const L = estado.leituras;
  if (!L.length) return null;
  const ult = L[L.length - 1];
  const orv = pontoOrvalho(ult.t, ult.u);
  const trend = tendencia(L);
  const anom = anomalia(L);
  const hora = new Date(ult.ts * 1000).getHours() + new Date(ult.ts * 1000).getMinutes() / 60;
  const est = estimarChuva({ p3: trend ? trend.p3 : null, horas: trend ? trend.horas : null, delta: trend ? trend.delta : null, anom, u: ult.u, spread: ult.t - orv, hora });
  const api = estado.api;
  const vars = {
    temperatura: ult.t, umidade: ult.u, indice_calor: ult.t < 27 ? ult.t : indiceCalor(ult.t, ult.u),
    chuva_estacao: est.total, queda_pressao_3h: trend ? -trend.p3 : null,
    chuva_api_3h: api ? api.chuva3h : null, chuva_api_6h: api ? api.chuva6h : null,
    vento_api: api ? api.ventoAgora : null
  };
  return { ult, orv, trend, anom, est, vars, calor: vars.indice_calor };
}

/* ------------------------------ gráficos ------------------------------ */
const graficos = {};
/* Ponto sozinho (sem vizinho antes e depois) não forma linha: precisa aparecer como bolinha. */
const pontoIsolado = (pts, i) => !!pts[i] && pts[i].y != null
  && (i === 0 || pts[i - 1].y == null) && (i === pts.length - 1 || pts[i + 1].y == null);
function conjunto(label, pontos, cor, tracejado, area) {
  const raioBase = pontos.length < 40 ? 3 : 0;
  return { label, data: pontos, borderColor: cor, borderWidth: tracejado ? 1.6 : 2.2, borderDash: tracejado ? [5, 4] : [],
           pointRadius: ctx => pontoIsolado(pontos, ctx.dataIndex) ? 3 : raioBase, pointBackgroundColor: cor, tension: 0.25, spanGaps: false,
           fill: area ? "origin" : false, backgroundColor: area ? "rgba(55, 124, 112, 0.10)" : cor };
}
const decs = {}, foras = {};
function rotuloX(ms, faixa) {
  const d = new Date(ms);
  if (faixa <= 36 * 3600 * 1000) return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}
function quantil(arr, q) {
  const a = arr.slice().sort((x, y) => x - y), i = (a.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return a[lo] + (a[hi] - a[lo]) * (i - lo);
}
function degrau(faixa) {            // passo "redondo" (1, 2, 5, 10...) para os rótulos do eixo
  const bruto = faixa / 5, mag = Math.pow(10, Math.floor(Math.log10(bruto))), f = bruto / mag;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * mag;
}
/* Eixo vertical calculado só com os pontos visíveis. No modo "típica", leituras extremas
   (abaixo do 2º ou acima do 98º percentil) ficam fora do quadro para não achatar as linhas. */
function limitesY(datasets, spanMin, xmin, xmax, modo) {
  const ys = [];
  let ultimo = null, ultimoX = -Infinity;
  datasets.forEach(d => d.data.forEach(p => {
    if (p.y == null) return;
    if (xmin !== undefined && (p.x < xmin || p.x > xmax)) return;
    ys.push(p.y);
    if (p.x > ultimoX) { ultimoX = p.x; ultimo = p.y; }
  }));
  if (!ys.length) return { min: undefined, max: undefined, passo: 1, dec: 1, fora: 0 };
  let lo = Math.min(...ys), hi = Math.max(...ys);
  if (modo === "tipica" && ys.length >= 30) {
    lo = Math.min(quantil(ys, 0.02), ultimo); hi = Math.max(quantil(ys, 0.98), ultimo);
  }
  if (hi - lo < spanMin) { const c = (lo + hi) / 2; lo = c - spanMin / 2; hi = c + spanMin / 2; }
  if (hi - lo < 1e-9) { lo -= 0.5; hi += 0.5; }
  const pad = (hi - lo) * 0.06, passo = degrau(hi - lo + 2 * pad);
  const min = Math.floor((lo - pad) / passo) * passo, max = Math.ceil((hi + pad) / passo) * passo;
  return { min, max, passo, dec: passo >= 1 ? 0 : (passo >= 0.1 ? 1 : 2), fora: ys.filter(y => y < min || y > max).length };
}
const zoomAtivo = g => typeof g.isZoomedOrPanned === "function" && g.isZoomedOrPanned();
const modoEscala = () => estado.escalaTotal ? "total" : "tipica";

function ajustarY(g) {              // depois de mover ou ampliar, reajusta o eixo vertical ao que está visível
  const sx = g.scales && g.scales.x;
  if (!sx) return;
  const ly = limitesY(g.data.datasets, g._spanMin || 0, sx.min, sx.max, modoEscala());
  if (ly.min === undefined) return;
  g.options.scales.y.min = ly.min; g.options.scales.y.max = ly.max; g.options.scales.y.ticks.stepSize = ly.passo;
  decs[g._id] = ly.dec;
  g.update("none");
}

/* Gráficos de linha: arraste para mover, Ctrl + roda do mouse (ou pinça no celular) para
   ampliar, duplo clique para restaurar. Se o usuário mexeu no gráfico, as atualizações
   automáticas não desfazem o zoom. */
function desenharLinha(id, datasets, xmin, xmax, spanMin = 0, eixo = null) {
  const el = document.getElementById(id);
  if (!el || typeof Chart === "undefined") return;
  if (eixo) eixos[id] = eixo; else delete eixos[id];
  if (xmax - xmin < 60000) xmax = xmin + 60000;
  const ly = limitesY(datasets, spanMin, xmin, xmax, modoEscala());
  decs[id] = ly.dec; foras[id] = ly.fora;
  if (graficos[id]) {
    const g = graficos[id];
    g._spanMin = spanMin;
    g.data.datasets = datasets;
    g.options.plugins.zoom.limits.x = { min: xmin, max: xmax, minRange: 60000 };
    if (!zoomAtivo(g)) {
      g.options.scales.x.min = xmin; g.options.scales.x.max = xmax;
      g.options.scales.y.min = ly.min; g.options.scales.y.max = ly.max; g.options.scales.y.ticks.stepSize = ly.passo;
    }
    g.update("none");
    return;
  }
  const g = new Chart(el, {
    type: "line", data: { datasets }, plugins: [marcasLacuna],
    options: {
      animation: false, responsive: true, maintainAspectRatio: false, parsing: false,
      interaction: { mode: "nearest", intersect: false },
      plugins: {
        legend: { display: datasets.length > 1, labels: { boxWidth: 12, usePointStyle: true } },
        tooltip: { callbacks: {
          title: it => it.length ? dataHoraCompleta(eixos[id] ? eixos[id].real(it[0].parsed.x) : it[0].parsed.x) : "",
          label: c => `${c.dataset.label}: ${fmt(c.parsed.y, 2)}`
        } },
        zoom: {
          pan: { enabled: true, mode: "x", onPanComplete: ({ chart }) => ajustarY(chart) },
          zoom: { wheel: { enabled: true, modifierKey: "ctrl" }, pinch: { enabled: true }, mode: "xy",
                  onZoomComplete: ({ chart }) => ajustarY(chart) },
          limits: { x: { min: xmin, max: xmax, minRange: 60000 } }
        }
      },
      scales: {
        x: { type: "linear", min: xmin, max: xmax, grid: { color: COR.grade },
             afterBuildTicks: sc => {            // com pausas encurtadas, os rótulos ficam no início de cada sessão
               const ex = eixos[id];
               if (!ex) return;
               const vs = ex.segs.map(s => s.off).filter(v => v >= sc.min && v <= sc.max);
               if (!vs.length) return;
               const passo = Math.ceil(vs.length / 7);
               sc.ticks = vs.filter((_, i) => i % passo === 0).map(value => ({ value }));
             },
             ticks: { maxTicksLimit: 8, callback: function (v) { return eixos[id] ? rotuloX(eixos[id].real(v), Infinity) : rotuloX(v, this.max - this.min); } } },
        y: { min: ly.min, max: ly.max, grid: { color: COR.grade },
             ticks: { stepSize: ly.passo, callback: v => fmt(v, decs[id] ?? 0) } }
      }
    }
  });
  g._id = id; g._spanMin = spanMin;
  graficos[id] = g;
  el.addEventListener("dblclick", () => resetarZoom());
}
function zoomGraficos(fator) {
  Object.values(graficos).forEach(g => {
    if (g.config.type === "line" && typeof g.zoom === "function") { g.zoom(fator); ajustarY(g); }
  });
}
function resetarZoom() {
  Object.values(graficos).forEach(g => { if (typeof g.resetZoom === "function") g.resetZoom(); });
  renderTudo();
}
const rotulosBarras = {      // escreve o valor acima de cada barra (inclusive 0)
  id: "rotulosBarras",
  afterDatasetsDraw(chart) {
    const ctx = chart.ctx, meta = chart.getDatasetMeta(0), dados = chart.data.datasets[0].data;
    ctx.save(); ctx.fillStyle = COR.tinta; ctx.font = "600 11px 'DM Sans', sans-serif"; ctx.textAlign = "center";
    meta.data.forEach((barra, i) => ctx.fillText(String(Math.round(dados[i])), barra.x, barra.y - 4));
    ctx.restore();
  }
};
function desenharBarras(id, rotulos, valores) {
  const el = document.getElementById(id);
  if (!el || typeof Chart === "undefined") return;
  if (graficos[id]) {
    graficos[id].data.labels = rotulos; graficos[id].data.datasets[0].data = valores;
    graficos[id].update("none"); return;
  }
  graficos[id] = new Chart(el, {
    type: "bar",
    data: { labels: rotulos, datasets: [{ data: valores, backgroundColor: COR.api, borderRadius: 6, borderSkipped: false, minBarLength: 3, maxBarThickness: 34 }] },
    plugins: [rotulosBarras],
    options: {
      animation: false, responsive: true, maintainAspectRatio: false,
      layout: { padding: { top: 16 } },
      plugins: { legend: { display: false } },
      scales: { y: { min: 0, max: 100, ticks: { callback: v => v + " %" }, grid: { color: COR.grade } }, x: { grid: { display: false } } }
    }
  });
}
/* Interrompe a linha onde faltaram leituras (ex.: simulação desligada por horas),
   em vez de ligar dois pontos distantes com uma reta enganosa. */
function comQuebras(pontos) {
  if (pontos.length < 3) return pontos;
  const difs = [];
  for (let i = 1; i < pontos.length; i++) difs.push(pontos[i].x - pontos[i - 1].x);
  const mediana = difs.slice().sort((a, b) => a - b)[Math.floor(difs.length / 2)];
  const limite = Math.max(15 * 60 * 1000, 6 * mediana);
  const out = [pontos[0]];
  for (let i = 1; i < pontos.length; i++) {
    if (pontos[i].x - pontos[i - 1].x > limite) out.push({ x: pontos[i - 1].x + 1, y: null });
    out.push(pontos[i]);
  }
  return out;
}
/* Sessões: sequências de leituras sem pausa longa. Uma pausa maior que 15 min (ou 6x o intervalo
   típico) separa duas sessões. As leituras vêm em segundos (ts). */
function sessoesDe(L) {
  if (!L.length) return [];
  const difs = [];
  for (let i = 1; i < L.length; i++) difs.push(L[i].ts - L[i - 1].ts);
  const mediana = difs.length ? difs.slice().sort((a, b) => a - b)[Math.floor(difs.length / 2)] : 0;
  const limite = Math.max(15 * 60, 6 * mediana);
  const out = [{ ini: L[0].ts, fim: L[0].ts }];
  for (let i = 1; i < L.length; i++) {
    if (L[i].ts - L[i - 1].ts > limite) out.push({ ini: L[i].ts, fim: L[i].ts });
    else out[out.length - 1].fim = L[i].ts;
  }
  return out;
}

/* Eixo do tempo do histórico. Estação ligada só de vez em quando gera sessões de poucos minutos
   separadas por horas ou dias; num eixo de tempo real cada sessão vira uma risca de 1 pixel.
   Com 2 ou mais sessões, as pausas são encurtadas (faixa cinza) e cada sessão ocupa espaço
   proporcional à sua duração. Os rótulos continuam mostrando a data e a hora reais. */
function construirEixo(L) {
  const ses = sessoesDe(L);
  if (ses.length < 2) return null;
  const dur = ses.map(s => Math.max(s.fim - s.ini, 60) * 1000);
  const folga = Math.max(0.04 * dur.reduce((a, b) => a + b, 0), 30000);
  let off = 0;
  const segs = ses.map((s, i) => { const seg = { ini: s.ini * 1000, dur: dur[i], off }; off += dur[i] + folga; return seg; });
  const achar = (campo, v) => { let k = 0; for (let i = segs.length - 1; i >= 0; i--) if (v >= segs[i][campo]) { k = i; break; } return segs[k]; };
  return {
    sessoes: ses, segs, max: off - folga,
    lacunas: segs.slice(1).map((s, i) => [segs[i].off + segs[i].dur, s.off]),
    x: t => { const s = achar("ini", t); return s.off + Math.min(Math.max(t - s.ini, 0), s.dur); },
    real: v => { const s = achar("off", v); return s.ini + Math.min(Math.max(v - s.off, 0), s.dur); }
  };
}

/* Agrupa leituras muito próximas em um ponto médio por intervalo de tempo. Só age em séries
   grandes (mais de "alvo" pontos); o tamanho do intervalo vem do tempo realmente medido,
   sem contar as pausas. */
function reduzir(L, campo, alvo = 600) {
  if (L.length <= alvo) return L.map(l => ({ x: l.ts * 1000, y: l[campo] }));
  const ativo = sessoesDe(L).reduce((a, s) => a + Math.max(s.fim - s.ini, 1), 0);
  const larg = Math.max(1, Math.ceil(ativo / alvo));
  const baldes = new Map();
  L.forEach(l => {
    const k = Math.floor(l.ts / larg), b = baldes.get(k) || { soma: 0, tempo: 0, n: 0 };
    b.soma += l[campo]; b.tempo += l.ts; b.n++; baldes.set(k, b);
  });
  return [...baldes.values()].map(b => ({ x: Math.round(b.tempo / b.n) * 1000, y: b.soma / b.n }));
}
/* Série para o gráfico. Com eixo comprimido, cada sessão vira um trecho e há uma quebra entre elas. */
function serie(L, campo, eixo) {
  if (!eixo) return comQuebras(reduzir(L, campo));
  const out = [];
  eixo.sessoes.forEach(s => {
    const pts = reduzir(L.filter(l => l.ts >= s.ini && l.ts <= s.fim), campo).map(p => ({ x: eixo.x(p.x), y: p.y }));
    if (out.length && pts.length) out.push({ x: out[out.length - 1].x + 1, y: null });
    out.push(...pts);
  });
  return out;
}
const eixos = {};      // eixo comprimido de cada gráfico (id do canvas); sem entrada = eixo de tempo normal
const marcasLacuna = {
  id: "marcasLacuna",
  beforeDatasetsDraw(chart) {
    const ex = eixos[chart.canvas.id];
    if (!ex) return;
    const { ctx, chartArea: a, scales: { x } } = chart;
    ctx.save(); ctx.fillStyle = "rgba(120, 134, 130, 0.12)";
    ex.lacunas.forEach(([de, ate]) => {
      const l = Math.max(x.getPixelForValue(de), a.left), r = Math.min(x.getPixelForValue(ate), a.right);
      if (r > l) ctx.fillRect(l, a.top, r - l, a.bottom - a.top);
    });
    ctx.restore();
  }
};

/* ------------------------------ renderização ------------------------------ */
const $ = id => document.getElementById(id);
function texto(id, t) { const e = $(id); if (e) e.textContent = t; }

const haTempo = s => s < 90 ? "agora há pouco" : s < 3600 ? `há ${Math.round(s / 60)} min` : s < 86400 ? `há ${Math.round(s / 3600)} h` : `há ${Math.round(s / 86400)} d`;
const maiuscula = t => t.charAt(0).toUpperCase() + t.slice(1);

function renderStatus() {
  const L = estado.leituras;
  let cls = "off", dot = "wait", msg, titulo, sub;
  if (emDemo()) { cls = "demo"; dot = "demo"; msg = "Modo demonstração (dados simulados no navegador)"; titulo = "Modo demonstração"; sub = "Dados simulados no navegador"; }
  else if (estado.erro) { dot = "off"; msg = "Sem conexão com o Firebase: " + estado.erro; titulo = "Sem conexão"; sub = "Firebase indisponível"; }
  else if (!L.length) { dot = "wait"; msg = "Aguardando as primeiras leituras do ESP32"; titulo = "Aguardando leituras"; sub = "Do ESP32"; }
  else {
    const ult = L[L.length - 1];
    const deltas = L.slice(-6).slice(1).map((l, i) => l.ts - L.slice(-6)[i].ts).sort((a, b) => a - b);
    const intervalo = deltas.length ? deltas[Math.floor(deltas.length / 2)] : 60;
    const limite = Math.max(30, intervalo * 3);
    const idade = Date.now() / 1000 - ult.ts;
    if (idade <= limite) { cls = "on"; dot = ""; msg = `Online, atualizada às ${hhmm(ult.ts * 1000)}`; titulo = "Estação online"; sub = `Atualizada ${haTempo(idade)}`; }
    else { dot = "off"; msg = `Offline, última leitura às ${hhmm(ult.ts * 1000)}`; titulo = "Estação offline"; sub = `Última leitura ${haTempo(idade)}`; }
  }
  $("ponto").className = "ponto " + cls;
  texto("status-texto", msg);
  $("side-dot").className = "live-dot " + dot;
  $("h-dot").className = "live-dot " + dot;
  texto("side-status", titulo); texto("side-sub", sub);
}

function valor(id, n, un) {
  const e = $(id);
  if (e) e.innerHTML = n + "<small> " + un + "</small>";
}

function textoCalor(calor) {
  return calor >= 51 ? "perigo extremo (referência NWS)" : calor >= 39 ? "perigo (referência NWS)" : calor >= 32 ? "cuidado extremo (referência NWS)" : calor >= 27 ? "cuidado (referência NWS)" : "igual à temperatura (a fórmula vale acima de 27 °C)";
}

function renderLeituras(d) {
  if (!d) return;
  const { ult, orv, trend, calor } = d;
  const hoje = estado.leituras.filter(l => l.ts >= ult.ts - 24 * 3600);
  $("v-temp").innerHTML = `${fmt(ult.t)}<sup>°C</sup>`;
  texto("s-temp", `mín. ${fmt(Math.min(...hoje.map(l => l.t)))} °C, máx. ${fmt(Math.max(...hoje.map(l => l.t)))} °C em 24 h`);
  valor("v-umid", fmt(ult.u, 0), "%");
  texto("s-umid", trend ? (trend.horas < 2.9 ? `${sgn(trend.deltaU, 0)} pontos em ${Math.max(1, Math.round(trend.horas * 60))} min` : `${sgn(trend.u3, 0)} pontos em 3 h`) : "variação indisponível");
  texto("d-umid", trend ? `${sgn(trend.horas < 2.9 ? trend.deltaU : trend.u3, 0)} pts` : "");
  valor("v-pres", fmt(ult.p), "hPa");
  const vp = trend ? variacaoPressao(trend) : null;
  texto("s-pres", vp ? `${sgn(vp.cai ? -vp.valor : vp.valor)} hPa em ${vp.janela}` : "variação indisponível");
  texto("d-pres", vp ? sgn(vp.cai ? -vp.valor : vp.valor) : "");
  $("v-pres").classList.toggle("alerta", !!trend && trend.p3 <= -2);
  valor("v-orv", fmt(orv), "°C");
  texto("s-orv", `${fmt(ult.t - orv)} °C abaixo da temperatura`);
  texto("d-orv", `Δ ${fmt(ult.t - orv)}°`);
  valor("v-calor", fmt(calor), "°C");
  texto("s-calor", textoCalor(calor));
  texto("d-calor", calor >= 39 ? "Perigo" : calor >= 32 ? "Cuidado" : calor >= 27 ? "Atenção" : "Normal");
}

/* ----------------------------- hero e previsão por hora ----------------------------- */
function condicao() {
  const a = estado.api;
  if (!a || !a.prob.length) return null;
  const prob = a.prob[0] ?? 0, mm = a.mm[0] ?? 0;
  const nuv = a.nuvens && a.nuvens[0] != null ? a.nuvens[0] : null;
  if (mm >= 0.2 || prob >= 60) return { texto: "Chuva provável", tipo: "rain" };
  if (prob >= 35) return { texto: "Possibilidade de chuva", tipo: "rain" };
  if (nuv != null && nuv >= 80) return { texto: "Nublado", tipo: "cloud" };
  if (nuv != null && nuv >= 35) return { texto: "Parcialmente nublado", tipo: "parcial" };
  return { texto: "Céu limpo", tipo: "sun" };
}
function iconeClima(tipo, tam) {
  if (tipo === "parcial") return icone("sun", tam) + `<i>${icone("cloud", Math.round(tam * 0.74))}</i>`;
  return icone(tipo, tam);
}
function iconeHora(prob, mm, nuv) {
  if ((mm || 0) >= 0.2 || (prob || 0) >= 35) return "rain";
  if (nuv != null && nuv >= 60) return "cloud";
  return "sun";
}

function saudacao() {
  const h = new Date().getHours();
  const base = h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
  const c = estado.conta;
  const nome = c && (c.nome || c.email) ? String(c.nome || c.email).split(/[ @]/)[0] : "";
  texto("v-saudacao", nome ? `${base}, ${nome}` : base);
  texto("v-data", new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" }).toUpperCase());
}

function renderHero(d) {
  saudacao();
  texto("h-local", `Agora em ${localAtivo().nome} · estação ${nomeEstacao().toLowerCase()}`);
  const cond = condicao();
  const ic = $("h-icone");
  const tipo = cond ? cond.tipo : "sun";
  ic.className = "weather-icon " + tipo;
  ic.innerHTML = iconeClima(tipo, 47);
  if (!d) { texto("h-cond", "Aguardando leituras"); return; }
  texto("h-cond", cond ? cond.texto : (d.est.cat === "Baixa" ? "Sem sinais de chuva" : `Chance de chuva ${d.est.cat.toLowerCase()}`));
  texto("h-sens", `${fmt(d.calor, 0)} °C`);
  const a = estado.api;
  texto("h-chuva", a && a.chuva3h != null ? `${fmt(a.chuva3h, 0)}%` : "—");
  texto("h-vento", a && a.ventoAgora != null ? `${fmt(a.ventoAgora, 0)} km/h` : "—");
  texto("h-hora", `Atualizado às ${hhmm(d.ult.ts * 1000)}`);
}

function caminhoSuave(pontos) {      // curva suave por pontos (x, y)
  if (pontos.length < 2) return "";
  let d = `M${pontos[0][0].toFixed(1)} ${pontos[0][1].toFixed(1)}`;
  for (let i = 1; i < pontos.length; i++) {
    const [x0, y0] = pontos[i - 1], [x1, y1] = pontos[i], mx = (x0 + x1) / 2;
    d += ` C${mx.toFixed(1)} ${y0.toFixed(1)},${mx.toFixed(1)} ${y1.toFixed(1)},${x1.toFixed(1)} ${y1.toFixed(1)}`;
  }
  return d;
}

function renderHoras() {
  const a = estado.api, lista = $("hour-list"), spark = $("spark");
  if (!a || !a.horas.length) return;
  const n = Math.min(6, a.horas.length);
  lista.innerHTML = "";
  for (let i = 0; i < n; i++) {
    const hora = new Date(a.horas[i] * 1000).getHours().toString().padStart(2, "0") + "h";
    const t = a.temp && a.temp[i] != null ? `${Math.round(a.temp[i])}°` : "—";
    const p = a.prob[i] != null ? `${Math.round(a.prob[i])}%` : "—";
    const div = document.createElement("div");
    if (i === 0) div.className = "current";
    div.innerHTML = `<span>${i === 0 ? "Agora" : hora}</span>${icone(iconeHora(a.prob[i], a.mm[i], a.nuvens && a.nuvens[i]), 26)}<strong>${t}</strong><small>${icone("droplet", 12)}${p}</small>`;
    lista.appendChild(div);
  }
  const temps = (a.temp || []).filter(v => v != null);
  if (temps.length < 2) { spark.innerHTML = ""; return; }
  const mn = Math.min(...temps), mx = Math.max(...temps), faixa = Math.max(mx - mn, 2);
  const pts = temps.map((v, i) => [i / (temps.length - 1) * 600, 92 - (v - mn) / faixa * 66]);
  const linha = caminhoSuave(pts);
  spark.innerHTML = `<span class="grid-line one"></span><span class="grid-line two"></span>
    <svg viewBox="0 0 600 110" preserveAspectRatio="none"><defs><linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#4b8f83" stop-opacity=".23"/><stop offset="100%" stop-color="#4b8f83" stop-opacity="0"/></linearGradient></defs>
    <path class="area" d="${linha} L600 110 L0 110Z"/><path class="line" d="${linha}"/></svg>`;
}

/* Maior sequência de horas, nas próximas 12 h, com chance de chuva abaixo de 30%. */
function melhorJanela() {
  const a = estado.api;
  if (!a || !a.horas.length) return null;
  let melhor = null, atual = null;
  a.horas.forEach((t, i) => {
    const ok = a.prob[i] != null && a.prob[i] < 30;
    if (ok) { atual = atual ? { ...atual, fim: i } : { ini: i, fim: i }; if (!melhor || atual.fim - atual.ini > melhor.fim - melhor.ini) melhor = atual; }
    else atual = null;
  });
  return melhor;
}
function renderJanela() {
  const a = estado.api;
  if (!a) return;
  const j = melhorJanela();
  const h = i => new Date(a.horas[i] * 1000).getHours().toString().padStart(2, "0") + "h";
  const chips = $("janela-chips"); chips.innerHTML = "";
  if (!j) {
    texto("janela-titulo", "Sem janela favorável");
    texto("janela-texto", "A previsão indica chuva em todas as próximas 12 horas.");
    return;
  }
  const fimH = new Date((a.horas[j.fim] + 3600) * 1000).getHours().toString().padStart(2, "0") + "h";
  texto("janela-titulo", j.ini === 0 ? `Agora até as ${fimH}` : `Das ${h(j.ini)} às ${fimH}`);
  texto("janela-texto", "Baixa chance de chuva nesse período, segundo a previsão da API.");
  const fat = arr => arr.slice(j.ini, j.fim + 1).filter(v => v != null);
  const faixa = (arr, un, d = 0) => { const v = fat(arr); return v.length ? (Math.min(...v) === Math.max(...v) ? `${fmt(v[0], d)} ${un}` : `${fmt(Math.min(...v), d)}–${fmt(Math.max(...v), d)} ${un}`) : null; };
  [["sun", faixa(a.temp || [], "°C")], ["wind", faixa(a.vento, "km/h")], ["rain", faixa(a.prob, "%")]].forEach(([ic, t]) => {
    if (!t) return;
    const s = document.createElement("span"); s.innerHTML = icone(ic, 16) + " "; s.appendChild(document.createTextNode(t)); chips.appendChild(s);
  });
}

function renderPrevisaoDias() {
  const a = estado.api;
  texto("p-local", localAtivo().nome);
  if (!a || !a.dias.length) return;
  const hoje = a.dias[0], cond = condicao();
  const tipo = cond ? cond.tipo : "sun";
  const ic = $("p-icone"); ic.className = "weather-icon " + tipo; ic.innerHTML = iconeClima(tipo, 48);
  texto("p-cond", cond ? cond.texto : "Previsão do dia");
  texto("p-faixa", `Máxima de ${fmt(hoje.max, 0)}° · Mínima de ${fmt(hoje.min, 0)}°`);
  texto("p-chuva", hoje.prob != null ? `${fmt(hoje.prob, 0)}%` : "—");
  texto("p-vento", hoje.vento != null ? `${fmt(hoje.vento, 0)} km/h` : "—");
  const caixa = $("dias"); caixa.innerHTML = "";
  a.dias.slice(0, 5).forEach((dia, i) => {
    const nome = i === 0 ? "Hoje" : i === 1 ? "Amanhã" : maiuscula(new Date(dia.ts * 1000).toLocaleDateString("pt-BR", { weekday: "long", timeZone: CONFIG.fusoApi })).replace("-feira", "");
    const tipoDia = (dia.prob ?? 0) >= 50 ? "rain" : (dia.prob ?? 0) >= 25 ? "cloud" : "sun";
    const desc = tipoDia === "rain" ? "Possibilidade de chuva" : tipoDia === "cloud" ? "Chance isolada de chuva" : "Pouca chance de chuva";
    const row = document.createElement("div");
    row.className = "day-row";
    row.innerHTML = `<strong></strong>${icone(tipoDia, 20)}<span></span><small>${icone("droplet", 14)}<i style="font-style:normal"></i></small><b><em></em></b>`;
    row.querySelector("strong").textContent = nome;
    row.querySelector("span").textContent = desc;
    row.querySelector("small i").textContent = dia.prob != null ? `${fmt(dia.prob, 0)}%` : "—";
    const b = row.querySelector("b"); b.insertBefore(document.createTextNode(`${fmt(dia.max, 0)}° `), b.firstChild);
    row.querySelector("em").textContent = `${fmt(dia.min, 0)}°`;
    caixa.appendChild(row);
  });
}

/* ícone, perfil e tom de cada atividade */
const ICONE_ATIV = { educacao_fisica: "book", evento_aberto: "sun", irrigacao: "droplet", pulverizacao: "wind", colheita: "leaf" };
const iconeAtividade = (id, a) => ICONE_ATIV[id] || (a.perfil === "agricola" ? "leaf" : "check");
const ROTULO_PERFIL = { escola: "Escolar", agricola: "Agrícola" };
const TOM = ["safe", "warning", "danger"];

function renderRecomendacoes(d) {
  const caixa = $("recomendacoes"); caixa.innerHTML = "";
  if (!d) { caixa.innerHTML = '<p class="empty muted-note">Aguardando leituras para avaliar as atividades.</p>'; return; }
  const itens = Object.entries(atividadesAtivas()).map(([id, a]) => ({ id, a, r: avaliarAtividade(a, d.vars) }))
    .sort((x, y) => y.r.nivel - x.r.nivel).slice(0, 3);
  if (!itens.length) {
    caixa.innerHTML = '<p class="empty muted-note">Você ainda não tem atividades. Ative uma na aba Regras.</p>';
    return;
  }
  itens.forEach(({ id, a, r }) => {
    const div = document.createElement("div"); div.className = "recommendation";
    div.innerHTML = `<span class="recommend-icon ${TOM[r.nivel]}">${icone(iconeAtividade(id, a), 20)}</span><span><strong></strong><small></small></span><b class="status ${TOM[r.nivel]}"></b>${icone("chevron", 16)}`;
    div.querySelector("strong").textContent = a.nome;
    div.querySelector("small").textContent = r.motivos.length ? r.motivos[0].texto : "Condições favoráveis agora";
    div.querySelector(".status").textContent = NIVEIS[r.nivel];
    div.addEventListener("click", () => irParaAba("atividades"));
    caixa.appendChild(div);
  });
}

function renderPressao(d) {
  const L = estado.leituras;
  if (!d) return;
  const fim = d.ult.ts * 1000, dia = 24 * 3600 * 1000;
  const hoje = L.filter(l => l.ts * 1000 >= fim - dia);
  const ontem = L.filter(l => l.ts * 1000 >= fim - 2 * dia && l.ts * 1000 < fim - dia)
                 .map(l => ({ x: l.ts * 1000 + dia, y: l.p }));
  const ds = [conjunto("hoje", serie(hoje, "p"), COR.est, false, true)];
  if (ontem.length) ds.push(conjunto("mesmo horário de ontem", comQuebras(ontem), COR.estClara, true));
  const inicio = Math.max(fim - dia, inicioUltimaSessao(L) * 1000);
  desenharLinha("graf-pressao", ds, inicio, fim, 4);
  texto("tit-pressao", (fim - inicio) >= 23 * 3600 * 1000 ? "Pressão nas últimas 24 horas"
    : `Pressão na última sessão (${Math.max(1, Math.round((fim - inicio) / 60000))} min)`);
  texto("nota-pressao", foras["graf-pressao"] ? `${foras["graf-pressao"]} leitura(s) extrema(s) ficam fora do quadro. Em Histórico, "Escala: completa" mostra tudo.` : "");
  if (d.trend) {
    const cai = d.trend.p3 < 0;
    const t = $("tend-titulo");
    const vp = variacaoPressao(d.trend);
    t.textContent = `${cai ? "Caindo" : "Subindo"} ${fmt(vp.valor)} hPa em ${vp.janela}`;
    t.className = cai && d.trend.p3 <= -2 ? "alerta" : "";
    const parcial = d.trend.horas < 2.9 ? `ritmo equivalente a ${ritmoTexto(d.trend.p3)}. ` : "";
    texto("tend-sub", parcial + (d.anom == null ? "Sem dados de ontem para comparar."
      : `${fmt(Math.abs(d.anom))} hPa ${d.anom < 0 ? "abaixo" : "acima"} de ontem neste horário.`));
  } else { texto("tend-titulo", "Tendência indisponível"); texto("tend-sub", "são necessárias leituras de pelo menos 5 minutos"); }
}

function renderChuva(d) {
  if (!d) return;
  texto("est-cat", d.est.cat);
  ["baixa", "media", "alta"].forEach(k => $("esc-" + k).classList.remove("ativa"));
  $("esc-" + { Baixa: "baixa", "Média": "media", Alta: "alta" }[d.est.cat]).classList.add("ativa");
  const top = d.est.fatores.filter(f => f.pts > 0).sort((a, b) => b.pts - a.pts).slice(0, 3).map(f => f.nome.toLowerCase());
  texto("est-motivo", (top.length ? "Pesaram: " + top.join(", ") + "." : "Nenhum fator indica chuva agora.")
    + (d.est.parcial ? " Estimativa parcial: ainda sem tendência da pressão." : ""));
  const a = estado.api;
  if (a) {
    texto("api-pct", `${fmt(a.chuva3h, 0)} %`);
    $("api-barra").style.width = clip(a.chuva3h, 0, 100) + "%";
    texto("api-info", `Consultada às ${hhmm(a.consultadoEm)}. Vento previsto: ${fmt(a.ventoAgora, 0)} km/h.`);
  } else { texto("api-pct", "—"); texto("api-info", estado.apiErro ? "Não foi possível consultar a API: " + estado.apiErro : "Consultando a API…"); }
}

function renderApiGrafico() {
  const a = estado.api;
  if (!a) return;
  const rot = a.horas.map(t => new Date(t * 1000).getHours().toString().padStart(2, "0") + "h");
  desenharBarras("graf-api", rot, a.prob);
  desenharBarras("graf-api2", rot, a.prob);
  const validos = a.prob.filter(x => x != null);
  const maximo = validos.length ? Math.max(...validos) : null;
  const nota = maximo == null ? "" : (maximo <= 0 ? "A API não prevê chuva nas próximas 12 horas."
    : `Maior chance prevista: ${fmt(maximo, 0)} %, por volta das ${rot[a.prob.indexOf(maximo)]}.`);
  texto("api-nota", nota); texto("api-nota2", nota);
}

/* Faz um ou mais elementos "brilharem" por alguns segundos (algo novo foi notificado ali) */
function brilhar(elementos) {
  const lista = Array.from(elementos || []).filter(Boolean);
  lista.forEach(e => { e.classList.remove("brilho"); void e.offsetWidth; e.classList.add("brilho"); });
  if (lista.length) setTimeout(() => lista.forEach(e => e.classList.remove("brilho")), 4200);
}
/* Atividades cujo nível (atenção ou adiar) é novo desde a última vez que a pessoa abriu a aba Atividades */
function atividadesNovas() {
  return Object.entries(estado.niveisAtuais).filter(([id, n]) => n > 0 && estado.vistoNiveis[id] !== n).map(([id]) => id);
}
function atualizarSelosNovidade() {
  const badge = $("nav-ativ");
  if (badge) {
    const n = document.getElementById("atividades").classList.contains("ativa") ? 0 : atividadesNovas().length;
    badge.textContent = String(n); badge.classList.toggle("oculto", n === 0);
  }
  const ponto = $("sino-ponto");
  if (ponto) ponto.classList.toggle("off", !estado.alertasSig || estado.alertasSig === estado.alertasVistos);
}
function renderAlertas(d) {
  const ul = $("alertas"); ul.innerHTML = "";
  const TONS = { perigo: ["danger", "alert"], atencao: ["warning", "clock"], ok: ["safe", "check"], neutro: ["neutral", "cloud"] };
  let pendentes = 0;
  const sig = [];
  const add = (cls, titulo, det, alvo) => {
    const [tom, ic] = TONS[cls] || TONS.neutro;
    if (cls === "perigo" || cls === "atencao") { pendentes++; sig.push(titulo + "|" + det); }
    const li = document.createElement("li"); li.className = "alert-item";
    li.innerHTML = `<span class="recommend-icon ${tom}">${icone(ic, 19)}</span><span><strong></strong><span class="txt"></span></span>`;
    li.querySelector("strong").textContent = titulo; li.querySelector(".txt").textContent = det;
    if (cls === "perigo" || cls === "atencao") li.dataset.pendente = "1";
    if (alvo) {       // clicar leva à aba do assunto e faz o item brilhar lá
      li.classList.add("clicavel"); li.dataset.alvo = alvo;
      li.title = "Ver na aba Atividades";
      li.addEventListener("click", () => { irParaAba("atividades"); setTimeout(() => brilhar(document.querySelectorAll(`#cards [data-id="${alvo}"]`)), 80); });
    }
    ul.appendChild(li);
  };
  const fim = () => { estado.alertasSig = sig.join("##"); atualizarSelosNovidade(); };
  if (estado.descartadas) add("atencao", "Leituras ignoradas",
    `${estado.descartadas} leitura(s) com valor impossível (pressão ao nível do mar fora de 870 a 1090 hPa, temperatura fora de −20 a 60 °C ou umidade fora de 0 a 100 %) não entram nos gráficos nem nos cálculos.`);
  if (!d) { add("neutro", "Sem leituras", "O dashboard mostra os alertas quando houver dados."); fim(); return; }
  if (d.trend && d.trend.p3 <= -2) {
    const v = variacaoPressao(d.trend);
    add("perigo", "Queda de pressão", v.parcial
      ? `${fmt(v.valor)} hPa em ${v.janela} (ritmo equivalente a ${Math.abs(d.trend.p3) > 20 ? "mais de 20" : fmt(Math.abs(d.trend.p3))} hPa em 3 h; limite: 2,0 hPa em 3 h)`
      : `${fmt(v.valor)} hPa em 3 h (limite: 2,0 hPa)`);
  }
  if (estado.api && d.est.cat !== "Baixa" && estado.api.chuva3h >= 50) add("ok", "Estação e API concordam", "As duas apontam chuva nas próximas horas.");
  if (estado.api && d.est.cat !== "Baixa" && estado.api.chuva3h < 20)
    add("atencao", "Estação e API divergem", `A estação indica chuva ${d.est.cat.toLowerCase()}, mas a API prevê ${fmt(estado.api.chuva3h, 0)} %. Pode ser mudança local ou leitura atípica do sensor.`);
  if (estado.api && d.est.cat === "Baixa" && estado.api.chuva3h >= 60)
    add("atencao", "Estação e API divergem", `A API prevê ${fmt(estado.api.chuva3h, 0)} % de chuva, mas a estação indica chance baixa.`);
  const ativ = atividadesAtivas();
  for (const [id, a] of Object.entries(ativ)) {
    const r = avaliarAtividade(a, d.vars);
    if (r.nivel === 2) add("perigo", `${a.nome}: adiar`, r.motivos.filter(m => m.n === 2).map(m => m.texto).join("; "), id);
  }
  if (!ul.children.length) add("ok", "Tudo tranquilo", "Nenhum alerta ativo no momento.");
  fim();
}

/* Início da última sequência contínua de leituras (sem pausas longas). */
function inicioUltimaSessao(L) {
  if (L.length < 3) return L.length ? L[0].ts : 0;
  const rec = L.slice(-200), difs = [];
  for (let i = 1; i < rec.length; i++) difs.push(rec[i].ts - rec[i - 1].ts);
  const mediana = difs.slice().sort((a, b) => a - b)[Math.floor(difs.length / 2)];
  const limite = Math.max(15 * 60, 6 * mediana);
  let ini = L[L.length - 1].ts;
  for (let i = L.length - 1; i > 0; i--) {
    if (L[i].ts - L[i - 1].ts > limite) break;
    ini = L[i - 1].ts;
  }
  return ini;
}

function recorte(L) {
  if (!L.length) return L;
  const fim = L[L.length - 1].ts;
  if (estado.periodo === "sessao") {       // última sequência contínua, no máximo 24 h
    const ini = Math.max(inicioUltimaSessao(L), fim - 24 * 3600);
    return L.filter(l => l.ts >= ini);
  }
  const janela = { "24h": 24 * 3600, "7d": 7 * 24 * 3600, tudo: Infinity }[estado.periodo];
  return L.filter(l => l.ts >= fim - janela);
}

function renderHistorico() {
  const L = recorte(estado.leituras);
  if (!L.length) return;
  const eixo = construirEixo(L);
  const xmin = eixo ? 0 : L[0].ts * 1000, xmax = eixo ? eixo.max : L[L.length - 1].ts * 1000;
  desenharLinha("graf-temp", [conjunto("Temperatura (°C)", serie(L, "t", eixo), COR.est, false, true)], xmin, xmax, 4, eixo);
  desenharLinha("graf-umid", [conjunto("Umidade (%)", serie(L, "u", eixo), COR.est, false, true)], xmin, xmax, 10, eixo);
  desenharLinha("graf-pres", [conjunto("Pressão (hPa)", serie(L, "p", eixo), COR.est, false, true)], xmin, xmax, 6, eixo);
  const totalFora = ["graf-temp", "graf-umid", "graf-pres"].reduce((t, id) => t + (foras[id] || 0), 0);
  texto("btn-escala", estado.escalaTotal ? "Escala: completa" : "Escala: típica");
  texto("nota-escala", [
    !estado.escalaTotal && totalFora ? `Escala típica: ${totalFora} leitura(s) extrema(s) ficam fora do quadro. Use "Escala: completa" para ver tudo.` : "",
    eixo ? "Pausas sem leituras aparecem encurtadas (faixas cinzas); os horários do eixo são os reais." : ""].filter(Boolean).join(" "));
  const defs = [["Temperatura", "t", 1, "°C", "sun", "orange", "tot-temp"], ["Umidade do ar", "u", 0, "%", "droplet", "blue", "tot-umid"], ["Pressão", "p", 1, "hPa", "gauge", "purple", "tot-pres"]];
  const cartoes = defs.map(([nome, c, d, un, ic, cor, tot]) => {
    const v = L.map(l => l[c]);
    const media = v.reduce((a, b) => a + b, 0) / v.length;
    $(tot).innerHTML = `${fmt(media, d)} ${un} <small>média</small>`;
    return `<article class="metric-card"><div class="metric-icon ${cor}">${icone(ic, 21)}</div><p>${nome} média</p>
      <strong>${fmt(media, d)}<small>${un}</small></strong>
      <span class="metric-meta">mín. ${fmt(Math.min(...v), d)} · máx. ${fmt(Math.max(...v), d)} ${un}</span></article>`;
  });
  $("resumo").innerHTML = cartoes.join("");
}

/* ---------- validação: última leitura da estação x observação atual da Open-Meteo ----------
   O desvio é a diferença absoluta; fica "dentro da margem" quando <= margem (CONFIG.margens). */
function renderValidacao() {
  const corpo = $("val-corpo");
  if (!corpo) return;
  const L = estado.leituras, ult = L.length ? L[L.length - 1] : null;
  const ref = estado.api && estado.api.atual;
  const resumo = $("val-resumo");
  const vazio = (msg, sub) => {
    corpo.innerHTML = `<tr><td colspan="6" class="val-vazio">${msg}</td></tr>`;
    texto("val-sub", sub);
    resumo.innerHTML = "";
  };
  if (!ult) return vazio("Sem leituras da estação para comparar.", "Aguardando as leituras da estação.");
  if (!ref) return vazio(estado.apiErro ? `Não foi possível consultar a Open-Meteo agora (${estado.apiErro}).` : "Consultando a Open-Meteo…",
                         "Aguardando a observação da Open-Meteo.");
  const m = CONFIG.margens;
  const defs = [
    { nome: "Temperatura", ic: "sun", cor: "orange", s: ult.t, r: ref.t, ds: 1, dr: 1, un: "°C", lim: m.t },
    { nome: "Umidade", ic: "droplet", cor: "blue", s: ult.u, r: ref.u, ds: 1, dr: 0, un: "%", lim: m.u },
    { nome: "Pressão ao nível do mar", ic: "gauge", cor: "purple", s: ult.p, r: ref.p, ds: 1, dr: 1, un: "hPa", lim: m.p },
    // ponto de orvalho: indica se sensor e API descrevem o mesmo ar (não entra na contagem da POC)
    { nome: "Ponto de orvalho", ic: "cloud", cor: "mint", s: pontoOrvalho(ult.t, ult.u),
      r: isFinite(ref.o) ? ref.o : pontoOrvalho(ref.t, ref.u), ds: 1, dr: 1, un: "°C", lim: m.o, info: true }
  ].filter(d => isFinite(d.s) && isFinite(d.r));
  let fora = 0;
  corpo.innerHTML = defs.map(d => {
    const dif = Math.round(Math.abs(d.s - d.r) * 10) / 10;
    const ok = dif <= d.lim;
    if (!ok && !d.info) fora++;
    const folga = Math.round(Math.abs(d.lim - dif) * 10) / 10;
    return `<tr class="${d.info ? "val-info" : ok ? "val-ok" : "val-fora"}">
      <td><span class="val-ind"><span class="val-ico ${d.cor}">${icone(d.ic, 17)}</span><b>${d.nome}</b></span></td>
      <td data-rotulo="Sensor"><b>${fmt(d.s, d.ds)}</b> <small>${d.un}</small></td>
      <td data-rotulo="Open-Meteo"><b>${fmt(d.r, d.dr)}</b> <small>${d.un}</small></td>
      <td data-rotulo="Diferença" class="val-dif"><b>${fmt(dif, 1)}</b> <small>${d.un}</small></td>
      <td data-rotulo="Margem aceita">Até <b>${fmt(d.lim, 1)}</b> <small>${d.un}${d.info ? " · indicativa" : ""}</small></td>
      <td data-rotulo="Resultado"><span class="val-selo ${ok ? "safe" : d.info ? "warning" : "danger"}">${icone(ok ? "check" : "shield", 14)}${d.info ? (ok ? "Mesmo ar" : "Ar diferente") : ok ? "Dentro da margem" : "Fora da margem"}</span>
        <span class="val-folga">${ok ? `${fmt(folga, 1)} ${d.un} abaixo do limite` : `Excedeu o limite em ${fmt(folga, 1)} ${d.un}`}</span></td>
    </tr>`;
  }).join("");
  const idadeMin = Math.round((Date.now() / 1000 - ult.ts) / 60);
  texto("val-sub", `Comparação entre a leitura da estação (${hhmm(ult.ts * 1000)}) e a observação da Open-Meteo (${hhmm(ref.ts * 1000)}). O desvio é a diferença absoluta entre as duas fontes.`
    + (idadeMin > 10 ? ` Atenção: a última leitura da estação tem ${idadeMin} min.` : ""));
  resumo.innerHTML = fora
    ? `<span class="val-aviso warning">${icone("shield", 20)}<span><b>${fora} ${fora === 1 ? "leitura fora da margem" : "leituras fora da margem"}</b><small>Recomendamos verificar a calibração</small></span></span>`
    : `<span class="val-aviso safe">${icone("check", 20)}<span><b>Todas dentro da margem</b><small>Sensor coerente com a Open-Meteo</small></span></span>`;
}

function renderPrevisao(d) {
  if (!d) return;
  const caixa = $("fatores"); caixa.innerHTML = "";
  d.est.fatores.forEach(f => {
    const div = document.createElement("div"); div.className = "factor";
    div.innerHTML = `<div><strong></strong><span class="det"></span></div><div class="track"><div class="fill"></div><b></b></div>`;
    div.querySelector("strong").textContent = f.nome;
    div.querySelector(".det").textContent = f.det;
    div.querySelector(".fill").style.width = (f.pts * 2.5) + "px";
    div.querySelector("b").textContent = "+" + f.pts;
    caixa.appendChild(div);
  });
  texto("total-pts", `${d.est.total}: ${d.est.cat.toLowerCase()}`);
  texto("total-nota", d.est.parcial ? "Estimativa parcial: faltam leituras para calcular a tendência da pressão, que é o fator de maior peso." : "");
  $("marcador").style.left = clip(d.est.total, 0, 100) + "%";
}

function renderAtividades() {
  texto("faixa-ativ", textoFaixaConta());
  const d = derivados();
  const caixa = $("cards"); caixa.innerHTML = "";
  const resumo = $("ativ-resumo");
  const ativ = atividadesAtivas();
  if (!d) {
    caixa.innerHTML = '<p class="muted-note">Aguardando leituras para avaliar as atividades.</p>';
    resumo.classList.add("oculto"); estado.niveisAtuais = {}; atualizarSelosNovidade();
    return;
  }
  if (!Object.keys(ativ).length) {
    caixa.innerHTML = '<p class="muted-note">Você ainda não tem atividades. Ative uma recomendada ou crie a sua na aba Regras.</p>';
    resumo.classList.add("oculto"); estado.niveisAtuais = {}; atualizarSelosNovidade();
    return;
  }
  resumo.classList.remove("oculto");
  const cont = [0, 0, 0], niveisAtuais = {};
  for (const [id, a] of Object.entries(ativ)) {
    const r = avaliarAtividade(a, d.vars);
    cont[r.nivel]++; niveisAtuais[id] = r.nivel;
    const tom = TOM[r.nivel], aberto = !!estado.expandidas[id];
    const card = document.createElement("article");
    card.className = `rule-card ${tom}${aberto ? " aberto" : ""}`;
    card.dataset.id = id;
    card.innerHTML = `<div class="rule-icon ${tom}">${icone(iconeAtividade(id, a), 22)}</div>
      <div class="rule-copy"><small></small><h3></h3><p></p><ul class="oculto"></ul></div>
      <b class="status ${tom}"></b>
      <button class="expand-rule ${aberto ? "open" : ""}" aria-label="Ver critérios" aria-expanded="${aberto}">${icone("chevron", 18)}</button>`;
    card.querySelector("small").textContent = ROTULO_PERFIL[a.perfil] || a.perfil || "Geral";
    card.querySelector("h3").textContent = a.nome;
    const pResumo = card.querySelector("p");
    pResumo.textContent = r.motivos.length
      ? r.motivos[0].texto + (r.motivos.length > 1 ? ` (+${r.motivos.length - 1})` : "")
      : "Nenhuma regra disparada: condições adequadas.";
    pResumo.classList.toggle("oculto", aberto);   // aberto: a lista abaixo substitui o resumo (sem repetir)
    card.querySelector(".status").textContent = NIVEIS[r.nivel];
    const ul = card.querySelector("ul");
    (r.motivos.length ? r.motivos : [{ texto: "Todos os critérios estão dentro dos limites." }]).forEach(m => {
      const li = document.createElement("li"); li.innerHTML = icone(r.motivos.length ? "alert" : "check", 14);
      li.appendChild(document.createTextNode(m.texto)); ul.appendChild(li);
    });
    ul.classList.toggle("oculto", !aberto);
    const btnExp = card.querySelector(".expand-rule");
    btnExp.addEventListener("click", () => {      // alterna no lugar, sem redesenhar a lista (o card não pula)
      const abre = !estado.expandidas[id];
      estado.expandidas[id] = abre;
      card.classList.toggle("aberto", abre);
      btnExp.classList.toggle("open", abre);
      btnExp.setAttribute("aria-expanded", String(abre));
      ul.classList.toggle("oculto", !abre);
      pResumo.classList.toggle("oculto", abre);
    });
    caixa.appendChild(card);
  }
  estado.niveisAtuais = niveisAtuais;
  if (document.getElementById("atividades").classList.contains("ativa")) estado.vistoNiveis = { ...niveisAtuais };   // já está olhando: nada novo
  atualizarSelosNovidade();
  const item = (tom, ic, forte, sub) => `<div><span class="summary-icon ${tom}">${icone(ic, 20)}</span><span><strong>${forte}</strong><small>${sub}</small></span></div>`;
  resumo.innerHTML = item("safe", "check", `${cont[0]} ${cont[0] === 1 ? "liberada" : "liberadas"}`, "Atividades seguras")
    + item("warning", "clock", `${cont[1]} em atenção`, "Requer monitoramento")
    + item("danger", "shield", `${cont[2]} para adiar`, "Condição desfavorável")
    + `<p>Atualizado com os dados das ${hhmm(d.ult.ts * 1000)}</p>`;
}

const ICONE_NIVEL = ["🟢", "🟡", "🔴"];   // mesma ordem de NIVEIS: Liberado, Atenção, Adiar
const escHtml = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/* O Telegram usa HTML (<b>negrito</b>) e o WhatsApp usa *negrito*; os textos de usuário são escapados no Telegram */
const FORMATO = {
  telegram: { esc: escHtml, b: s => `<b>${escHtml(s)}</b>`, i: s => `<i>${escHtml(s)}</i>` },
  whatsapp: { esc: s => String(s), b: s => `*${s}*`, i: s => `_${s}_` }
};

/* Mensagem de aviso: blocos separados por linha em branco para ler com folga no celular */
function mensagemAviso(canal = "telegram") {
  const f = FORMATO[canal];
  const d = derivados();
  if (!d) return "ClimaSense: sem leituras no momento.";
  const blocos = [
    `🌤 ${f.b("ClimaSense")}\n📍 ${f.esc(localAtivo().nome)} · ${hhmm(Date.now())}`,
    `🌡 ${fmt(d.ult.t)} °C      💧 ${fmt(d.ult.u, 0)} %      🧭 ${fmt(d.ult.p)} hPa`
  ];
  for (const a of Object.values(atividadesAtivas())) {
    const r = avaliarAtividade(a, d.vars);
    blocos.push(`${ICONE_NIVEL[r.nivel]} ${f.b(a.nome)}\n${NIVEIS[r.nivel]}` + (r.motivos.length ? ` · ${f.esc(r.motivos[0].texto)}` : ""));
  }
  blocos.push(f.i("Apoio à decisão, não substitui o julgamento do responsável."));
  return blocos.join("\n\n");
}

/* ------------------------------ Telegram ------------------------------
   O token e o chat id ficam só no navegador (localStorage), não no código.
   Atenção: em um dashboard aberto no navegador o token pode ser visto por
   quem usa a página. Use um bot só da demonstração e revogue depois
   (comando /revoke no BotFather). */
const TG = {
  token: () => localStorage.getItem("tg_token") || "",
  chat: () => localStorage.getItem("tg_chat") || "",
  auto: () => localStorage.getItem("tg_auto") === "1"
};
function statusTg(msg, erro) {
  ["tg-status", "tg-status2"].forEach(id => {
    const e = $(id);
    if (e) { e.textContent = msg; e.className = "mudo" + (erro ? " erro" : ""); }
  });
}
async function enviarTelegram(texto) {
  if (!TG.token() || !TG.chat()) {
    statusTg("O envio pelo Telegram ainda não foi configurado. Peça ao responsável técnico (aba Regras, no fim da página).", true);
    return false;
  }
  try {
    const r = await fetch(`https://api.telegram.org/bot${TG.token()}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TG.chat(), text: texto, parse_mode: "HTML" })
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.description || ("HTTP " + r.status));
    statusTg(`Mensagem enviada às ${hhmm(Date.now())}.`, false);
    return true;
  } catch (e) {
    statusTg("Falha ao enviar: " + e.message, true);
    return false;
  }
}

/* Aviso automático quando o nível de uma atividade muda (com intervalo mínimo de 1 min). */
const niveisAnteriores = {};
let ultimoAuto = 0;
function verificarMudancas(d) {
  if (!d || !estado.api) return;   // só compara depois que a API respondeu
  const ativ = atividadesAtivas();
  const mudou = [];
  for (const [id, a] of Object.entries(ativ)) {
    const n = avaliarAtividade(a, d.vars).nivel;
    if (id in niveisAnteriores && niveisAnteriores[id] !== n)
      mudou.push(`${FORMATO.telegram.b(a.nome)}\n${ICONE_NIVEL[niveisAnteriores[id]]} ${NIVEIS[niveisAnteriores[id]]}  →  ${ICONE_NIVEL[n]} ${NIVEIS[n]}`);
    niveisAnteriores[id] = n;
  }
  if (mudou.length && TG.auto() && Date.now() - ultimoAuto > 60000) {
    ultimoAuto = Date.now();
    enviarTelegram("🔔 <b>Mudança de nível</b>\n\n" + mudou.join("\n\n") + "\n\n──────────\n\n" + mensagemAviso("telegram"));
  }
}

function exportarCsv() {
  const linhas = ["data_hora,temperatura_c,umidade_pct,pressao_estacao_hpa,pressao_nivel_mar_hpa"];
  estado.leituras.forEach(l => linhas.push([new Date(l.ts * 1000).toISOString(), l.t, l.u, l.pe, l.p].join(",")));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([linhas.join("\n")], { type: "text/csv" }));
  a.download = "climasense_leituras.csv"; a.click();
}

function renderTudo() {
  const d = derivados();
  renderStatus(); renderLeituras(d); renderHero(d); renderHoras(); renderRecomendacoes(d);
  renderPressao(d); renderChuva(d); renderApiGrafico(); renderAlertas(d); renderHistorico(); renderValidacao();
  renderPrevisao(d); renderPrevisaoDias(); renderJanela(); renderAtividades(); renderConta();
  verificarMudancas(d);
}

/* ===================== Conta, perfil e regras =====================
   A conta usa o Firebase Authentication (e-mail e senha) por meio das funções
   api/auth e api/usuario, e os dados ficam em /usuarios/{uid}. No modo
   demonstração (?demo=1), vale um perfil local, só neste navegador e sem senha.
   Todas as contas têm o mesmo poder: cada uma edita e cria as próprias atividades e
   regras, sem afetar as das outras. O antigo tipo "especialista" foi retirado. */
const PERFIS = {
  escola: "Atividades ao ar livre acadêmicas e educação física",
  agricola: "Atividades agrícolas (pulverização, irrigação, colheita)"
};
const OPERADORES = [[">=", "maior ou igual a"], [">", "maior que"], ["<=", "menor ou igual a"], ["<", "menor que"]];
const modoLocal = () => emDemo();   // sem backend: perfil local, só neste navegador
const lista = x => Array.isArray(x) ? x.filter(Boolean) : (x ? Object.values(x) : []);
const clonar = x => JSON.parse(JSON.stringify(x));

const SESSAO = {
  ler() { try { return JSON.parse(localStorage.getItem("sessao") || "null"); } catch (e) { return null; } },
  gravar(s) { localStorage.setItem("sessao", JSON.stringify(s)); },
  limpar() { localStorage.removeItem("sessao"); }
};
function lerContaLocal() {
  try { return JSON.parse(localStorage.getItem("conta_local") || "null"); } catch (e) { return null; }
}

/* Dias agendados de uma atividade: { "AAAA-MM-DD": "responsável (opcional)" } */
function normalizarDias(d) {
  const out = {};
  if (!d || typeof d !== "object") return out;
  for (const [k, v] of Object.entries(d)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(k)) out[k] = typeof v === "string" ? v.slice(0, 60) : "";
  }
  return out;
}
function normalizarRegras(r) {
  const out = {};
  for (const [id, a] of Object.entries(r || {})) {
    if (!a) continue;
    out[id] = {
      nome: String(a.nome || id), perfil: PERFIS[a.perfil] ? a.perfil : "escola", nova: !!a.nova,
      dias: normalizarDias(a.dias),
      regras: lista(a.regras)
        .map(x => ({ v: x.v, op: x.op, lim: Number(x.lim), nivel: x.nivel === "adiar" ? "adiar" : "atencao" }))
        .filter(x => VARIAVEIS[x.v] && OPERADORES.some(o => o[0] === x.op) && Number.isFinite(x.lim))
    };
  }
  return out;
}
function normalizarLocal(l) {
  if (!l) return null;
  const lat = Number(l.lat), lon = Number(l.lon), altitude = Number(l.altitude);
  if (!(Math.abs(lat) <= 90) || !(Math.abs(lon) <= 180) || !Number.isFinite(altitude)) return null;
  return { nome: String(l.nome || "Local da estação"), lat, lon, altitude };
}
function normalizarConta(c) {
  const perfis = lista(c.perfis).filter(p => PERFIS[p]);
  return {
    uid: c.uid || "", email: c.email || "", nome: String(c.nome || ""),
    papel: c.papel === "especialista" ? "especialista" : "usuario",
    perfis: perfis.length ? perfis : ["escola"], regras: normalizarRegras(c.regras),
    estacao: estacaoValida(c.estacao) ? c.estacao : null, local: normalizarLocal(c.local)
  };
}

/* Atividades que valem para quem está usando: as da própria conta (a conta começa vazia).
   Visitante, sem conta, vê as recomendadas só para leitura. */
function atividadesAtivas() {
  const c = estado.conta;
  if (c) return c.regras;
  const out = {};
  for (const [id, a] of Object.entries(ATIVIDADES_PADRAO)) out[id] = a;
  return out;
}
/* Recomendadas dos perfis da conta que ainda não foram ativadas */
function recomendadasDisponiveis() {
  const c = estado.conta;
  if (!c) return [];
  return Object.entries(ATIVIDADES_PADRAO).filter(([id, a]) => c.perfis.includes(a.perfil) && !(id in c.regras));
}
function copiarRecomendada(id) {
  const a = ATIVIDADES_PADRAO[id];
  return { nome: a.nome, perfil: a.perfil, nova: false, dias: {}, regras: clonar(a.regras) };
}

/* ----------------------------- autenticação ----------------------------- */
function traduzErroAuth(cod) {
  cod = cod || "";
  if (cod.startsWith("EMAIL_EXISTS")) return "Já existe uma conta com esse e-mail.";
  if (cod.startsWith("WEAK_PASSWORD")) return "A senha precisa ter pelo menos 6 caracteres.";
  if (cod.startsWith("INVALID_EMAIL")) return "E-mail inválido.";
  if (cod.startsWith("INVALID_LOGIN_CREDENTIALS") || cod.startsWith("INVALID_PASSWORD") || cod.startsWith("EMAIL_NOT_FOUND"))
    return "E-mail ou senha incorretos.";
  if (cod.startsWith("OPERATION_NOT_ALLOWED")) return "O login por e-mail e senha não está ativado no Firebase.";
  if (cod.startsWith("TOO_MANY_ATTEMPTS")) return "Muitas tentativas. Tente de novo em alguns minutos.";
  return cod || "Erro de autenticação.";
}
async function idCall(acao, corpo) {
  const r = await fetch(`${CONFIG.api}/auth`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ acao, ...corpo })
  });
  const j = await r.json();
  if (!r.ok) throw new Error(traduzErroAuth(j.error && j.error.message));
  return j;
}
function gravarSessaoDe(j, emailPadrao) {
  const s = {
    uid: j.localId || j.user_id, email: j.email || emailPadrao || "",
    idToken: j.idToken || j.id_token, refreshToken: j.refreshToken || j.refresh_token,
    exp: Date.now() + Number(j.expiresIn || j.expires_in || 3600) * 1000
  };
  SESSAO.gravar(s);
  return s;
}
async function tokenAtual() {
  if (modoLocal()) return null;
  let s = SESSAO.ler();
  if (!s) return null;
  if (Date.now() > s.exp - 60000) {
    const r = await fetch(`${CONFIG.api}/auth`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ acao: "refresh", refreshToken: s.refreshToken })
    });
    const j = await r.json();
    if (!r.ok) { SESSAO.limpar(); estado.conta = null; return null; }
    s = gravarSessaoDe(j, s.email);
  }
  return s.idToken;
}
async function dbUsuario(metodo, caminho, corpo) {
  const t = await tokenAtual();
  const s = SESSAO.ler();
  if (!t || !s) throw new Error("Sessão expirada. Entre novamente.");
  const r = await fetch(`${CONFIG.api}/usuario?caminho=${encodeURIComponent(caminho)}`, {
    method: metodo, headers: { "Content-Type": "application/json", Authorization: "Bearer " + t },
    body: corpo === undefined ? undefined : JSON.stringify(corpo)
  });
  if (!r.ok) throw new Error(r.status === 401 || r.status === 403
    ? "Sem permissão no Firebase. Confira as regras do banco." : "Servidor respondeu HTTP " + r.status);
  return r.json();
}

/* Atividades da conta nova: { ids: [recomendadas escolhidas], custom: [nomes criados] } */
function regrasIniciais(atividades, perfis) {
  const out = {};
  const at = atividades || {};
  (at.ids || []).forEach(id => {
    const a = ATIVIDADES_PADRAO[id];
    if (a && perfis.includes(a.perfil)) out[id] = copiarRecomendada(id);
  });
  (at.custom || []).forEach((nome, i) => {
    nome = String(nome || "").trim().slice(0, 60);
    if (nome) out["x_" + Date.now().toString(36) + i] = { nome, perfil: perfis[0], nova: true, dias: {}, regras: [] };
  });
  return out;
}
async function contaCriar({ nome, email, senha, papel, perfis, estacao, local, atividades }) {
  if (!String(nome || "").trim()) throw new Error("Informe seu nome.");
  if (!perfis || !perfis.length) throw new Error("Escolha pelo menos um perfil.");
  papel = "usuario";
  const regras = regrasIniciais(atividades, perfis);
  if (!Object.keys(regras).length) throw new Error("Escolha ou crie pelo menos uma atividade.");
  estacao = estacaoValida(estacao) ? estacao : CONFIG.estacao;
  local = normalizarLocal(local);   // só nome, coordenadas e altitude; CEP e rua não são guardados (RNF16)
  if (modoLocal()) {
    const c = { uid: "local", email: "", nome: nome.trim(), papel, perfis, regras, estacao, local };
    localStorage.setItem("conta_local", JSON.stringify(c));
    localStorage.setItem("conta_local_ativa", "1");
    estado.conta = normalizarConta(c);
    aplicarEstacaoDaConta();
    return;
  }
  if (!String(email || "").trim()) throw new Error("Informe o e-mail.");
  const j = await idCall("signUp", { email, password: senha });
  const s = gravarSessaoDe(j, email);
  const dados = { nome: nome.trim(), email, papel, perfis, estacao, regras, criadoEm: Date.now() };
  if (local) dados.local = local;
  try { await dbUsuario("PUT", "", dados); }
  catch (e) { throw new Error("Conta criada, mas não foi possível salvar o perfil: " + e.message); }
  estado.conta = normalizarConta({ uid: s.uid, ...dados });
  aplicarEstacaoDaConta();
}
async function carregarContaRemota() {
  const s = SESSAO.ler();
  if (!s) return;
  const d = await dbUsuario("GET", "");
  if (!d) {   // login ok, mas sem perfil salvo: cria um perfil básico
    const dados = { nome: (s.email || "").split("@")[0], email: s.email, papel: "usuario", perfis: ["escola"], criadoEm: Date.now() };
    await dbUsuario("PUT", "", dados);
    estado.conta = normalizarConta({ uid: s.uid, ...dados });
    aplicarEstacaoDaConta();
    return;
  }
  estado.conta = normalizarConta({ ...d, uid: s.uid, email: d.email || s.email });
  aplicarEstacaoDaConta();
}
async function contaEntrar(email, senha) {
  const j = await idCall("signInWithPassword", { email, password: senha });
  gravarSessaoDe(j, email);
  await carregarContaRemota();
}
function contaContinuarLocal() {
  const c = lerContaLocal();
  if (!c) throw new Error("Nenhum perfil neste navegador. Crie uma conta.");
  localStorage.setItem("conta_local_ativa", "1");
  estado.conta = normalizarConta(c);
  aplicarEstacaoDaConta();
}
function contaSair() {
  if (modoLocal()) localStorage.setItem("conta_local_ativa", "0"); else SESSAO.limpar();
  estado.conta = null; estado.rascunho = {}; estado.calMes = {}; estado.vistoNiveis = {}; estado.alertasVistos = "";
}
/* Ao sair: apaga o que ficou guardado neste navegador (sessão, estação escolhida, token e chat do
   Telegram, avisos já enviados) e limpa a tela (campos do Telegram, tabela da Agenda). Os dados da
   conta ficam no Firebase e voltam ao entrar de novo. No modo demonstração o perfil local é o
   "banco" e continua guardado; só deixa de estar ativo. */
const CHAVES_DO_NAVEGADOR = ["sessao", "estacao", "tg_token", "tg_chat", "tg_auto", "agenda_tg_enviados", "agenda_tg_auto", "agenda_rascunho"];
function limparDadosDoNavegador() {
  CHAVES_DO_NAVEGADOR.forEach(k => { try { localStorage.removeItem(k); } catch (e) { /* sem acesso: tudo bem */ } });
  estado.estacao = CONFIG.estacao; estado.leituras = [];
  if ($("tg-token")) { $("tg-token").value = ""; $("tg-chat").value = ""; $("tg-auto").checked = false; }
  if ($("agenda-tg-auto")) $("agenda-tg-auto").checked = false;
  if (window.Agenda && window.Agenda.limparTela) window.Agenda.limparTela();
  atualizarTextosLocal();
}
async function restaurarConta() {
  try {
    if (modoLocal()) {
      const c = lerContaLocal();
      if (c && localStorage.getItem("conta_local_ativa") === "1") { estado.conta = normalizarConta(c); aplicarEstacaoDaConta(); }
    } else if (SESSAO.ler()) await carregarContaRemota();
  } catch (e) { SESSAO.limpar(); }
  renderTudo(); renderRegras();
  if (window.Agenda && window.Agenda.aoMudarConta) window.Agenda.aoMudarConta();   // a conta chega depois da página: recupera a tabela da Agenda
}

/* ------------------------- edição das regras (qualquer conta) ------------------------- */
function exigirConta() {
  if (!estado.conta) throw new Error("Entre na sua conta para criar ou editar atividades.");
}
async function contaSalvarRegras() {
  if (modoLocal()) {
    const c = lerContaLocal() || {};
    c.regras = estado.conta.regras;
    localStorage.setItem("conta_local", JSON.stringify(c));
    return;
  }
  await dbUsuario("PUT", "/regras", estado.conta.regras);
}
function validarAtividade(a) {
  if (!String(a.nome || "").trim()) return "Dê um nome à atividade.";
  for (const r of a.regras) {
    if (!VARIAVEIS[r.v]) return "Escolha a variável de cada critério.";
    if (r.lim === "" || r.lim === null || !Number.isFinite(Number(r.lim))) return "Informe um número válido em todos os limites.";
  }
  return null;
}
async function salvarAtividade(id, a) {
  exigirConta();
  const erro = validarAtividade(a);
  if (erro) throw new Error(erro);
  const salvo = estado.conta.regras[id];
  estado.conta.regras[id] = {
    nome: a.nome.trim(), perfil: a.perfil, nova: !(id in ATIVIDADES_PADRAO),
    dias: normalizarDias(a.dias || (salvo && salvo.dias)),
    regras: a.regras.map(r => ({ v: r.v, op: r.op, lim: Number(r.lim), nivel: r.nivel === "adiar" ? "adiar" : "atencao" }))
  };
  await contaSalvarRegras();
}
async function removerAtividade(id) {
  exigirConta();
  delete estado.conta.regras[id];
  await contaSalvarRegras();
}
async function restaurarRecomendada(id) {     // volta os critérios ao recomendado (mantém os dias agendados)
  exigirConta();
  if (!(id in ATIVIDADES_PADRAO)) throw new Error("Só atividades recomendadas têm critérios para restaurar.");
  const atual = estado.conta.regras[id];
  const nova = copiarRecomendada(id);
  if (atual) { nova.dias = atual.dias || {}; nova.nome = ATIVIDADES_PADRAO[id].nome; }
  estado.conta.regras[id] = nova;
  await contaSalvarRegras();
}
async function adicionarRecomendada(id) {
  exigirConta();
  if (!(id in ATIVIDADES_PADRAO)) throw new Error("Atividade recomendada não encontrada.");
  if (id in estado.conta.regras) return;
  estado.conta.regras[id] = copiarRecomendada(id);
  await contaSalvarRegras();
}
async function criarAtividade(nome, perfil) {
  exigirConta();
  if (!String(nome || "").trim()) throw new Error("Dê um nome à atividade.");
  const c = estado.conta;
  if (!c.perfis.includes(perfil)) throw new Error("Escolha um dos seus perfis.");
  const id = "x_" + Date.now().toString(36);
  c.regras[id] = { nome: nome.trim(), perfil, nova: true, dias: {}, regras: [] };
  await contaSalvarRegras();
  return id;
}
/* marca ou desmarca um dia agendado da atividade e salva na hora */
async function alternarDia(id, a, iso) {
  exigirConta();
  const dias = a.dias || (a.dias = {});
  if (iso in dias) delete dias[iso]; else dias[iso] = "";
  const salvo = estado.conta.regras[id];
  if (salvo) { salvo.dias = clonar(dias); await contaSalvarRegras(); }
}

/* ------------------------------ interface da conta ------------------------------ */
function textoFaixaConta() {
  const c = estado.conta;
  if (!c) return "Você está como visitante e vê as atividades recomendadas só para leitura. Crie uma conta para montar as suas atividades, editar os critérios e agendar os dias.";
  const perfis = c.perfis.map(p => PERFIS[p]).join(" e ");
  return `Perfil: ${perfis}. Ative uma recomendada ou crie a sua, ajuste os critérios e marque os dias agendados; a Agenda usa essas regras.`;
}
function renderConta() {
  const c = estado.conta;
  $("btn-conta").classList.toggle("oculto", !!c);
  $("btn-sair").classList.toggle("oculto", !c);
  const perfilTxt = c ? c.perfis.map(p => p === "agricola" ? "Agrícola" : "Escolar").join(" e ") : "";
  texto("lado-nome", c ? (c.nome || c.email) : "Acessar conta");
  texto("lado-sub", c ? perfilTxt : "Sincronize seus dados");
  $("btn-conta-lado").classList.toggle("static", !!c);
  saudacao();
}

/* aviso rápido no canto da tela (confirmações de ações) */
let _avisoTimer = null;
function avisar(msg, erro) {
  const a = $("aviso");
  if (!a) return;
  a.textContent = msg;
  a.className = "aviso" + (erro ? " erro" : "");
  clearTimeout(_avisoTimer);
  _avisoTimer = setTimeout(() => a.classList.add("oculto"), erro ? 6000 : 4000);
}

function el(tag, props, filhos) {
  const e = document.createElement(tag);
  Object.assign(e, props || {});
  (filhos || []).forEach(f => e.appendChild(typeof f === "string" ? document.createTextNode(f) : f));
  return e;
}
function statusRegras(msg, erro) {
  const e = $("regras-status");
  if (e) { e.textContent = msg; e.className = "muted-note" + (erro ? " erro" : ""); }
}
function rascunhoDe(id) {
  if (!estado.rascunho[id]) estado.rascunho[id] = clonar(atividadesAtivas()[id]);
  return estado.rascunho[id];
}
function textoCriterio(r) {
  const [nome, un] = VARIAVEIS[r.v] || [r.v, ""];
  const op = OPERADORES.find(o => o[0] === r.op);
  return `${nome} ${op ? op[1] : r.op} ${String(r.lim).replace(".", ",")} ${un}`;
}
function linhaEditavel(a, regra) {
  const selVar = el("select");
  Object.entries(VARIAVEIS).forEach(([k, [nome, un]]) => {
    const o = el("option", { value: k, textContent: `${nome} (${un})` });
    if (k === regra.v) o.selected = true;
    selVar.appendChild(o);
  });
  const selOp = el("select");
  OPERADORES.forEach(([k, nome]) => {
    const o = el("option", { value: k, textContent: nome });
    if (k === regra.op) o.selected = true;
    selOp.appendChild(o);
  });
  const num = el("input", { type: "number", step: "any", value: String(regra.lim) });
  const un = el("span", { className: "un", textContent: (VARIAVEIS[regra.v] || ["", ""])[1] });
  selVar.addEventListener("change", () => { regra.v = selVar.value; un.textContent = VARIAVEIS[regra.v][1]; });
  selOp.addEventListener("change", () => { regra.op = selOp.value; });
  num.addEventListener("input", () => { regra.lim = num.value === "" ? "" : Number(num.value); });
  const rem = el("button", { type: "button", className: "remover", textContent: "×", title: "Remover critério" });
  rem.addEventListener("click", () => { a.regras.splice(a.regras.indexOf(regra), 1); renderRegras(); });
  return el("div", { className: "criterion" }, [selVar, selOp, num, un, rem]);
}
function secaoRegras(a, nivel, titulo, edita) {
  const box = el("div", { className: "rule-section n-" + nivel }, [el("h4", { textContent: titulo })]);
  const itens = a.regras.filter(x => x.nivel === nivel);
  if (!itens.length) box.appendChild(el("p", { className: "rule-none", textContent: "Nenhum critério." }));
  itens.forEach(regra => box.appendChild(edita ? linhaEditavel(a, regra)
    : el("p", { className: "rule-text", textContent: textoCriterio(regra) })));
  if (edita) {
    const b = el("button", { type: "button", className: "btn-sm", textContent: "+ Adicionar critério" });
    b.addEventListener("click", () => { a.regras.push({ v: "chuva_api_3h", op: ">=", lim: 50, nivel }); renderRegras(); });
    box.appendChild(b);
  }
  return box;
}
function cartaoRegras(id, base, edita) {
  const a = edita ? rascunhoDe(id) : base;
  const padrao = ATIVIDADES_PADRAO[id];
  const salva = estado.conta && estado.conta.regras[id];
  const editada = !!(padrao && salva && JSON.stringify(salva.regras) !== JSON.stringify(padrao.regras));
  const selo = !padrao ? "criada por você" : (editada ? "recomendada · editada" : "recomendada");
  const icone_ = el("span", { className: "rule-icon safe", innerHTML: icone(iconeAtividade(id, a), 20) });
  const titulo = el("div", {}, [el("small", { textContent: PERFIS[a.perfil] || a.perfil }), el("h3", { textContent: a.nome })]);
  const topo = el("div", { className: "rule-editor-head" }, [icone_, titulo, el("span", { className: "tag", textContent: selo })]);
  const cartao = el("div", { className: "rule-editor" }, [topo]);
  if (edita) {
    const nome = el("input", { type: "text", value: a.nome, className: "rule-name", placeholder: "Nome da atividade" });
    nome.addEventListener("input", () => { a.nome = nome.value; });
    cartao.appendChild(nome);
  }
  cartao.appendChild(secaoRegras(a, "adiar", "Adiar quando qualquer um destes critérios ocorrer", edita));
  cartao.appendChild(secaoRegras(a, "atencao", "Atenção quando qualquer um destes critérios ocorrer", edita));
  cartao.appendChild(el("p", { className: "rule-free", textContent: "Liberado: quando nenhum critério acima se aplica." }));
  if (edita) cartao.appendChild(seletorDias(id, a));
  if (edita) {
    const acoes = el("div", { className: "rule-actions" });
    const salvar = el("button", { type: "button", className: "btn-sm solid", textContent: "Salvar regras" });
    salvar.addEventListener("click", async () => {
      try {
        await salvarAtividade(id, a);
        delete estado.rascunho[id];
        statusRegras(`Regras de "${a.nome.trim()}" salvas.`, false);
        avisar(`Regras de "${a.nome.trim()}" salvas.`);
        renderRegras(); renderTudo();
      } catch (e) { statusRegras("Não foi possível salvar: " + e.message, true); avisar("Não foi possível salvar: " + e.message, true); }
    });
    acoes.appendChild(salvar);
    const descartar = el("button", { type: "button", className: "btn-sm", textContent: "Descartar alterações" });
    descartar.addEventListener("click", () => { delete estado.rascunho[id]; statusRegras("Alterações descartadas.", false); renderRegras(); });
    acoes.appendChild(descartar);
    if (padrao && editada) {
      const volta = el("button", { type: "button", className: "btn-sm", textContent: "Voltar ao recomendado" });
      volta.addEventListener("click", async () => {
        try {
          await restaurarRecomendada(id);
          delete estado.rascunho[id];
          statusRegras("Critérios recomendados restaurados.", false);
          avisar("Critérios recomendados restaurados.");
          renderRegras(); renderTudo();
        } catch (e) { statusRegras("Não foi possível concluir: " + e.message, true); }
      });
      acoes.appendChild(volta);
    }
    const rem = el("button", { type: "button", className: "btn-sm", textContent: "Remover atividade" });
    rem.addEventListener("click", async () => {
      if (!confirm(`Remover "${a.nome}" e os dias agendados dela?`)) return;
      try {
        await removerAtividade(id);
        delete estado.rascunho[id];
        statusRegras("Atividade removida.", false);
        avisar("Atividade removida.");
        renderRegras(); renderTudo();
      } catch (e) { statusRegras("Não foi possível concluir: " + e.message, true); }
    });
    acoes.appendChild(rem);
    cartao.appendChild(acoes);
  }
  return cartao;
}
/* calendário do mês para marcar os dias agendados da atividade (salva ao clicar) */
const DIAS_SEMANA = ["D", "S", "T", "Q", "Q", "S", "S"];
function seletorDias(id, a) {
  const hoje = new Date();
  const isoHoje = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(hoje.getDate()).padStart(2, "0")}`;
  const cal = estado.calMes[id] || (estado.calMes[id] = { a: hoje.getFullYear(), m: hoje.getMonth() });
  const raiz = el("div", { className: "dias-cal" });
  function desenhar() {
    raiz.innerHTML = "";
    const dias = a.dias || (a.dias = {});
    const tituloMes = new Date(cal.a, cal.m, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    const titulo = tituloMes.charAt(0).toUpperCase() + tituloMes.slice(1);
    const prefixo = `${cal.a}-${String(cal.m + 1).padStart(2, "0")}-`;
    const noMes = Object.keys(dias).filter(k => k.startsWith(prefixo)).length;
    const mover = n => { const d = new Date(cal.a, cal.m + n, 1); cal.a = d.getFullYear(); cal.m = d.getMonth(); desenhar(); };
    const ant = el("button", { type: "button", className: "btn-sm", textContent: "‹", title: "Mês anterior" });
    const prox = el("button", { type: "button", className: "btn-sm", textContent: "›", title: "Próximo mês" });
    ant.addEventListener("click", () => mover(-1)); prox.addEventListener("click", () => mover(1));
    raiz.appendChild(el("div", { className: "dias-cab" }, [
      el("strong", { textContent: "Dias agendados" }), ant,
      el("span", { className: "dias-mes", textContent: titulo }), prox,
      el("small", { textContent: noMes ? `${noMes} ${noMes === 1 ? "dia" : "dias"} neste mês` : "Clique nos dias para marcar" })]));
    const grade = el("div", { className: "dias-grade" });
    DIAS_SEMANA.forEach(n => grade.appendChild(el("span", { className: "dias-sem", textContent: n })));
    const primeiro = new Date(cal.a, cal.m, 1).getDay(), total = new Date(cal.a, cal.m + 1, 0).getDate();
    for (let i = 0; i < primeiro; i++) grade.appendChild(el("span"));
    for (let d = 1; d <= total; d++) {
      const iso = prefixo + String(d).padStart(2, "0");
      const b = el("button", { type: "button", textContent: String(d),
        className: "dia" + (iso in dias ? " on" : "") + (iso === isoHoje ? " hoje" : ""), title: iso in dias ? "Desmarcar" : "Agendar" });
      b.setAttribute("aria-pressed", iso in dias ? "true" : "false");
      b.addEventListener("click", async () => {
        try { await alternarDia(id, a, iso); desenhar(); }
        catch (e) { statusRegras("Não foi possível salvar o dia: " + e.message, true); avisar("Não foi possível salvar o dia: " + e.message, true); }
      });
      grade.appendChild(b);
    }
    raiz.appendChild(grade);
  }
  desenhar();
  return raiz;
}
function blocoRecomendadas() {
  const disp = recomendadasDisponiveis();
  if (!disp.length) return null;
  const box = el("div", { className: "new-activity recomendadas" }, [
    el("h3", { textContent: "Atividades recomendadas" }),
    el("p", { className: "muted-note", textContent: "Ative uma para trazer os critérios sugeridos. Depois você pode editar tudo." })]);
  disp.forEach(([id, a]) => {
    const b = el("button", { type: "button", className: "btn-sm solid", textContent: "Ativar" });
    b.addEventListener("click", async () => {
      try {
        await adicionarRecomendada(id);
        statusRegras(`"${a.nome}" ativada. Ajuste os critérios se quiser.`, false);
        avisar(`"${a.nome}" ativada.`);
        renderRegras(); renderTudo();
      } catch (e) { statusRegras(e.message, true); avisar(e.message, true); }
    });
    box.appendChild(el("div", { className: "rec-linha" }, [
      el("span", {}, [el("strong", { textContent: a.nome }), el("small", { textContent: `${PERFIS[a.perfil]} · ${a.regras.length} critérios` })]), b]));
  });
  return box;
}
function formNovaAtividade() {
  const sel = el("select");
  estado.conta.perfis.forEach(p => sel.appendChild(el("option", { value: p, textContent: PERFIS[p] })));
  const nome = el("input", { type: "text", placeholder: "Nome da nova atividade" });
  const b = el("button", { type: "button", className: "btn-sm solid", textContent: "Criar atividade" });
  b.addEventListener("click", async () => {
    try {
      await criarAtividade(nome.value, sel.value);
      statusRegras("Atividade criada. Defina os critérios, marque os dias e salve.", false);
      avisar(`Atividade "${nome.value.trim()}" criada. Defina os critérios e salve.`);
      renderRegras(); renderTudo();
    } catch (e) { statusRegras(e.message, true); avisar(e.message, true); }
  });
  return el("div", { className: "new-activity" }, [el("h3", { textContent: "Nova atividade" }), nome, sel, b]);
}
function renderRegras() {
  const raiz = $("regras-conteudo");
  if (!raiz) return;
  raiz.innerHTML = "";
  texto("faixa-regras", textoFaixaConta());
  const edita = !!estado.conta;
  const av = $("tg-avancado"); if (av) av.classList.toggle("oculto", !edita);
  const busca = estado.buscaRegras.trim().toLowerCase();
  const itens = Object.entries(atividadesAtivas()).filter(([, a]) =>
    (estado.filtroRegras === "todos" || a.perfil === estado.filtroRegras) && (!busca || a.nome.toLowerCase().includes(busca)));
  itens.forEach(([id, a]) => raiz.appendChild(cartaoRegras(id, a, edita)));
  if (!itens.length) raiz.appendChild(el("p", { className: "muted-note", textContent: edita && !Object.keys(atividadesAtivas()).length
    ? "Você ainda não tem atividades. Ative uma recomendada ou crie a sua para começar."
    : "Nenhuma atividade encontrada para esse filtro." }));
  if (edita) {
    const rec = blocoRecomendadas();
    if (rec) raiz.appendChild(rec);
    raiz.appendChild(formNovaAtividade());
  }
}

/* ------------------------------ CEP, local e estação ------------------------------ */
const UF_ESTADO = { AC: "Acre", AL: "Alagoas", AP: "Amapá", AM: "Amazonas", BA: "Bahia", CE: "Ceará", DF: "Distrito Federal",
  ES: "Espírito Santo", GO: "Goiás", MA: "Maranhão", MT: "Mato Grosso", MS: "Mato Grosso do Sul", MG: "Minas Gerais", PA: "Pará",
  PB: "Paraíba", PR: "Paraná", PE: "Pernambuco", PI: "Piauí", RJ: "Rio de Janeiro", RN: "Rio Grande do Norte",
  RS: "Rio Grande do Sul", RO: "Rondônia", RR: "Roraima", SC: "Santa Catarina", SP: "São Paulo", SE: "Sergipe", TO: "Tocantins" };

/* CEP -> endereço (BrasilAPI, com ViaCEP de reserva) -> coordenadas (BrasilAPI ou, na falta, o centro da
   cidade pela geocodificação da Open-Meteo) -> altitude (API de elevação da Open-Meteo, ~90 m de resolução).
   Sem coordenadas exatas do CEP, usa a cidade e avisa; a altitude então é a do centro da cidade. */
async function buscarCep(cep) {
  cep = String(cep || "").replace(/\D/g, "");
  if (cep.length !== 8) throw new Error("Informe um CEP com 8 números.");
  const json = async url => { const r = await fetch(url); if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); };
  let end = null, lat = null, lon = null, exato = false;
  try {
    const j = await json(`https://brasilapi.com.br/api/cep/v2/${cep}`);
    end = { cidade: j.city, uf: j.state, bairro: j.neighborhood };
    const c = j.location && j.location.coordinates;
    if (c && Number.isFinite(Number(c.latitude)) && Number.isFinite(Number(c.longitude)) && c.latitude !== "" && c.longitude !== "") {
      lat = Number(c.latitude); lon = Number(c.longitude); exato = true;
    }
  } catch (e) { /* tenta o ViaCEP */ }
  if (!end) {
    try {
      const j = await json(`https://viacep.com.br/ws/${cep}/json/`);
      if (j.erro) throw new Error("CEP não encontrado.");
      end = { cidade: j.localidade, uf: j.uf, bairro: j.bairro };
    } catch (e) { throw new Error(e.message === "CEP não encontrado." ? e.message : "Não foi possível consultar o CEP agora. Tente de novo."); }
  }
  let altGeo = null;
  if (lat === null) {
    try {
      const g = await json(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(end.cidade)}&count=10&language=pt&countryCode=BR`);
      const estadoNome = UF_ESTADO[end.uf];
      const achado = (g.results || []).find(x => x.admin1 === estadoNome) || (g.results || [])[0];
      if (achado) { lat = achado.latitude; lon = achado.longitude; altGeo = achado.elevation; }
    } catch (e) { /* segue sem coordenadas */ }
  }
  if (lat === null) throw new Error("Achei o endereço, mas não as coordenadas. Tente outro CEP da mesma cidade.");
  let altitude = altGeo;
  try {
    const el = await json(`https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`);
    if (el && Array.isArray(el.elevation) && Number.isFinite(el.elevation[0])) altitude = el.elevation[0];
  } catch (e) { /* usa a altitude da geocodificação, se houver */ }
  if (!Number.isFinite(altitude)) throw new Error("Não consegui obter a altitude desse local.");
  const nome = [end.bairro, end.cidade && `${end.cidade} (${end.uf})`].filter(Boolean).join(", ");
  return { nome, lat: Math.round(lat * 1000) / 1000, lon: Math.round(lon * 1000) / 1000, altitude: Math.round(altitude), exato };
}

function preencherSeletoresEstacao() {
  document.querySelectorAll("select[data-estacoes]").forEach(sel => {
    sel.innerHTML = "";
    Object.entries(CONFIG.estacoes).forEach(([id, e]) => sel.appendChild(el("option", { value: id, textContent: e.nome })));
    sel.value = idEstacao();
  });
}
function atualizarTextosLocal() {
  texto("local", localAtivo().nome);
  document.querySelectorAll("select[data-estacoes]").forEach(sel => { if (sel.id !== "c-estacao") sel.value = idEstacao(); });
}
function iniciarEstacao() {
  const guardada = localStorage.getItem("estacao");
  if (estacaoValida(guardada)) estado.estacao = guardada;
  preencherSeletoresEstacao();
  atualizarTextosLocal();
  $("sel-estacao").addEventListener("change", e => escolherEstacao(e.target.value));
}
function aplicarEstacaoDaConta() {            // ao entrar, vale a estação salva na conta
  if (estado.conta && estado.conta.estacao) estado.estacao = estado.conta.estacao;
  atualizarTextosLocal();
}
async function escolherEstacao(id) {
  if (!estacaoValida(id)) return;
  estado.estacao = id; estado.leituras = [];
  localStorage.setItem("estacao", id);
  if (estado.conta && !modoLocal()) { try { await dbUsuario("PUT", "/estacao", id); estado.conta.estacao = id; } catch (e) { /* a escolha vale nesta sessão */ } }
  else if (estado.conta) { const c = lerContaLocal() || {}; c.estacao = id; localStorage.setItem("conta_local", JSON.stringify(c)); estado.conta.estacao = id; }
  Object.keys(graficos).forEach(k => { try { graficos[k].destroy(); } catch (e) { /* ignora */ } delete graficos[k]; });
  renderTudo(); atualizar();
}
let localCadastro = null;                      // resultado da última busca de CEP no cadastro
async function acharCepCadastro() {
  const res = $("c-cep-res"), btn = $("c-cep-buscar");
  res.className = "auth-note"; res.textContent = "Buscando…"; btn.disabled = true; localCadastro = null;
  try {
    localCadastro = await buscarCep($("c-cep").value);
    res.textContent = `${localCadastro.nome} · altitude ${localCadastro.altitude} m` + (localCadastro.exato ? "" : " (centro da cidade)");
  } catch (e) { res.className = "auth-note erro"; res.textContent = e.message; }
  finally { btn.disabled = false; }
}

/* ------------------------------ janela de login ------------------------------ */
let modoModal = "entrar";
function definirModoModal(modo) {
  modoModal = modo;
  const local = modoLocal();
  $("tab-entrar").classList.toggle("active", modo === "entrar");
  $("tab-criar").classList.toggle("active", modo === "criar");
  ["campo-nome", "campo-perfis", "campo-ativ", "campo-local"].forEach(id => $(id).classList.toggle("oculto", modo !== "criar"));
  ["campo-email", "campo-senha"].forEach(id => $(id).classList.toggle("oculto", local));
  texto("c-enviar-txt", modo === "criar" ? "Criar minha conta" : (local ? "Continuar" : "Entrar na minha conta"));
  texto("auth-titulo", modo === "criar" ? "Crie sua conta" : "Que bom ter você de volta");
  texto("auth-sub", modo === "criar" ? "Personalize as regras e acompanhe sua estação de qualquer lugar." : "Entre para salvar suas preferências e receber alertas.");
  $("c-senha").autocomplete = modo === "criar" ? "new-password" : "current-password";
  $("c-senha").placeholder = modo === "criar" ? "Mínimo de 6 caracteres" : "Digite sua senha";
  const c = lerContaLocal();
  texto("aviso-modo", local
    ? "Modo demonstração: o perfil fica só neste navegador e não usa senha." + (modo === "entrar" && c ? ` Perfil salvo: ${c.nome}.` : "")
    : "");
  $("aviso-modo").classList.toggle("oculto", !$("aviso-modo").textContent);
  $("c-erro").textContent = "";
  if (modo === "criar") renderAtivCadastro();
}
function abrirModal(modo) { definirModoModal(modo || "entrar"); $("dlg-conta").showModal(); }
/* escolha das atividades iniciais no cadastro (pelo menos uma) */
const cadastroAtiv = { sel: new Set(), custom: [] };
function renderAtivCadastro() {
  const lista = $("c-ativ-lista");
  if (!lista) return;
  const perfis = Array.from(document.querySelectorAll('input[name="c-perfil"]:checked')).map(x => x.value);
  [...cadastroAtiv.sel].forEach(id => { if (!ATIVIDADES_PADRAO[id] || !perfis.includes(ATIVIDADES_PADRAO[id].perfil)) cadastroAtiv.sel.delete(id); });
  lista.innerHTML = "";
  Object.entries(ATIVIDADES_PADRAO).filter(([, a]) => perfis.includes(a.perfil)).forEach(([id, a]) => {
    const cx = el("input", { type: "checkbox", checked: cadastroAtiv.sel.has(id) });
    cx.addEventListener("change", () => { if (cx.checked) cadastroAtiv.sel.add(id); else cadastroAtiv.sel.delete(id); });
    lista.appendChild(el("label", { className: "chip" }, [cx, el("span", { textContent: a.nome })]));
  });
  cadastroAtiv.custom.forEach((nome, i) => {
    const x = el("button", { type: "button", className: "chip-x", textContent: "×", title: "Remover" });
    x.addEventListener("click", () => { cadastroAtiv.custom.splice(i, 1); renderAtivCadastro(); });
    lista.appendChild(el("span", { className: "chip on" }, [el("span", { textContent: nome }), x]));
  });
  if (!lista.children.length) lista.appendChild(el("p", { className: "auth-note", textContent: "Escolha um perfil acima ou crie a sua atividade." }));
}
function adicionarAtivCadastro() {
  const campo = $("c-ativ-nome");
  const nome = campo.value.trim().slice(0, 60);
  if (!nome) return;
  if (!cadastroAtiv.custom.includes(nome)) cadastroAtiv.custom.push(nome);
  campo.value = "";
  renderAtivCadastro();
}
async function enviarModal() {
  const erro = $("c-erro");
  erro.textContent = "";
  $("c-enviar").disabled = true;
  try {
    if (modoModal === "criar") {
      if ($("c-cep").value.trim() && !localCadastro) await acharCepCadastro();   // CEP digitado e ainda não buscado
      if ($("c-cep").value.trim() && !localCadastro) throw new Error("Corrija o CEP ou deixe o campo em branco para usar o local padrão.");
      const perfisEsc = Array.from(document.querySelectorAll('input[name="c-perfil"]:checked')).map(x => x.value);
      const atividades = { ids: [...cadastroAtiv.sel].filter(id => ATIVIDADES_PADRAO[id] && perfisEsc.includes(ATIVIDADES_PADRAO[id].perfil)), custom: cadastroAtiv.custom.slice() };
      if (!atividades.ids.length && !atividades.custom.length) throw new Error("Escolha ou crie pelo menos uma atividade.");
      await contaCriar({
        atividades,
        estacao: $("c-estacao").value, local: localCadastro,
        nome: $("c-nome").value, email: $("c-email").value.trim(), senha: $("c-senha").value,
        perfis: Array.from(document.querySelectorAll('input[name="c-perfil"]:checked')).map(x => x.value)
      });
    } else if (modoLocal()) contaContinuarLocal();
    else await contaEntrar($("c-email").value.trim(), $("c-senha").value);
    $("dlg-conta").close();
    estado.rascunho = {};
    cadastroAtiv.sel.clear(); cadastroAtiv.custom.length = 0;
    renderTudo(); renderRegras();
    if (window.Agenda && window.Agenda.aoMudarConta) window.Agenda.aoMudarConta();
  } catch (e) { erro.textContent = e.message; }
  finally { $("c-enviar").disabled = false; }
}
function ligarConta() {
  const dlg = $("dlg-conta");
  $("btn-conta").addEventListener("click", () => abrirModal("entrar"));
  $("btn-conta-lado").addEventListener("click", () => { if (!estado.conta) abrirModal("entrar"); else irParaAba("regras"); });
  $("btn-sair").addEventListener("click", () => {
    contaSair(); limparDadosDoNavegador();
    Object.keys(graficos).forEach(k => { try { graficos[k].destroy(); } catch (e) { /* ignora */ } delete graficos[k]; });
    renderTudo(); renderRegras(); atualizar();
    avisar("Você saiu. Os dados deste navegador foram apagados.");
  });
  $("tab-entrar").addEventListener("click", () => definirModoModal("entrar"));
  $("tab-criar").addEventListener("click", () => definirModoModal("criar"));
  $("c-cancelar").addEventListener("click", () => dlg.close());
  $("c-fechar").addEventListener("click", () => dlg.close());
  dlg.addEventListener("mousedown", e => { if (e.target === dlg) dlg.close(); });
  document.querySelectorAll('input[name="c-perfil"]').forEach(x => x.addEventListener("change", renderAtivCadastro));
  $("c-ativ-add").addEventListener("click", adicionarAtivCadastro);
  $("c-ativ-nome").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); adicionarAtivCadastro(); } });
  $("c-ver").addEventListener("click", () => { const i = $("c-senha"); i.type = i.type === "password" ? "text" : "password"; });
  $("c-cep-buscar").addEventListener("click", acharCepCadastro);
  $("c-cep").addEventListener("input", () => { localCadastro = null; texto("c-cep-res", ""); });
  $("form-conta").addEventListener("submit", e => { e.preventDefault(); enviarModal(); });
}

/* ------------------------------ ciclo de atualização ------------------------------ */
async function atualizar() {
  try { estado.leituras = await buscarLeituras(); estado.erro = null; }
  catch (e) { estado.erro = e.message; }
  renderTudo();
}
async function atualizarApi() {
  try { estado.api = await buscarApi(); estado.apiErro = null; }
  catch (e) { estado.apiErro = e.message; }
  renderTudo();
}

/* ------------------------------ navegação ------------------------------ */
function fecharMenu() {
  $("sidebar").classList.remove("mobile-open");
  $("nav-scrim").classList.add("oculto");
}
function irParaAba(id) {
  const b = document.querySelector(`#abas button[data-aba="${id}"]`);
  if (!b) return;
  document.querySelectorAll("#abas button").forEach(x => x.classList.toggle("active", x === b));
  document.querySelectorAll(".aba").forEach(x => x.classList.toggle("ativa", x.id === id));
  texto("crumb", b.dataset.titulo);
  if (id === "regras") renderRegras();
  if (id === "atividades") {                    // abriu a aba: o que era novo vira "visto" e brilha por um instante
    const novas = atividadesNovas();
    estado.vistoNiveis = { ...estado.niveisAtuais };
    atualizarSelosNovidade();
    if (novas.length) setTimeout(() => brilhar(novas.map(i => document.querySelector(`#cards [data-id="${i}"]`))), 120);
  } else atualizarSelosNovidade();
  if (id === "agenda" && typeof iniciarAgenda === "function") iniciarAgenda();   // agenda.js
  fecharMenu();
  window.scrollTo({ top: 0 });
  try { history.replaceState(null, "", "#" + id); } catch (e) { /* ignora */ }
  window.dispatchEvent(new Event("resize"));
}

function iniciar() {
  montarIcones();
  if (typeof Chart !== "undefined") {
    Chart.defaults.font.family = '"DM Sans", system-ui, sans-serif';
    Chart.defaults.font.size = 11;
    Chart.defaults.color = COR.mudo;
    Object.assign(Chart.defaults.plugins.tooltip, { backgroundColor: "#172724", padding: 10, cornerRadius: 8, titleFont: { weight: "600" }, boxPadding: 4 });
  }
  iniciarEstacao();
  saudacao();
  document.querySelectorAll("#abas button").forEach(b => b.addEventListener("click", () => irParaAba(b.dataset.aba)));
  document.querySelectorAll("[data-ir]").forEach(b => b.addEventListener("click", () => irParaAba(b.dataset.ir)));
  $("menu-toggle").addEventListener("click", () => {
    const abrir = !$("sidebar").classList.contains("mobile-open");
    $("sidebar").classList.toggle("mobile-open", abrir);
    $("nav-scrim").classList.toggle("oculto", !abrir);
  });
  $("nav-scrim").addEventListener("click", fecharMenu);
  $("btn-sino").addEventListener("click", () => {
    irParaAba("visao");
    estado.alertasVistos = estado.alertasSig; atualizarSelosNovidade();
    setTimeout(() => {
      $("alertas").scrollIntoView({ behavior: "smooth", block: "center" });
      brilhar($("alertas").querySelectorAll('li[data-pendente="1"]'));     // o que foi notificado brilha
    }, 80);
  });
  document.querySelectorAll("#periodos button").forEach(b => b.addEventListener("click", () => {
    document.querySelectorAll("#periodos button").forEach(x => x.classList.remove("active"));
    b.classList.add("active"); estado.periodo = b.dataset.periodo; renderHistorico();
  }));
  document.querySelectorAll("#filtro-regras button").forEach(b => b.addEventListener("click", () => {
    document.querySelectorAll("#filtro-regras button").forEach(x => x.classList.remove("active"));
    b.classList.add("active"); estado.filtroRegras = b.dataset.filtro; renderRegras();
  }));
  $("busca-regras").addEventListener("input", e => { estado.buscaRegras = e.target.value; renderRegras(); });
  $("btn-csv").addEventListener("click", exportarCsv);
  $("btn-zoom-mais").addEventListener("click", () => zoomGraficos(1.5));
  $("btn-zoom-menos").addEventListener("click", () => zoomGraficos(0.67));
  $("btn-zoom-reset").addEventListener("click", resetarZoom);
  $("btn-escala").addEventListener("click", () => { estado.escalaTotal = !estado.escalaTotal; resetarZoom(); });
  $("tg-token").value = TG.token();
  $("tg-chat").value = TG.chat();
  $("tg-auto").checked = TG.auto();
  $("btn-tg-salvar").addEventListener("click", () => {
    const token = $("tg-token").value.trim(), chat = $("tg-chat").value.trim();
    if (!/^\d{6,12}:[A-Za-z0-9_-]{30,}$/.test(token)) return statusTg("O token não parece certo. Ele tem o formato 123456789:ABC… (copie inteiro do @BotFather).", true);
    if (!/^(-?\d{5,}|@[A-Za-z]\w{4,})$/.test(chat)) return statusTg("O chat id não parece certo. Grupos têm um número negativo, como -1001234567890.", true);
    localStorage.setItem("tg_token", token);
    localStorage.setItem("tg_chat", chat);
    statusTg("Configuração salva neste navegador.", false);
  });
  $("btn-tg-remover").addEventListener("click", () => {
    ["tg_token", "tg_chat", "tg_auto"].forEach(k => localStorage.removeItem(k));
    $("tg-token").value = ""; $("tg-chat").value = ""; $("tg-auto").checked = false;
    statusTg("Configuração do Telegram removida deste navegador.", false);
  });
  $("tg-auto").addEventListener("change", e => localStorage.setItem("tg_auto", e.target.checked ? "1" : "0"));
  $("btn-telegram").addEventListener("click", async () => {
    $("btn-telegram").disabled = true;
    statusTg("Enviando…", false);
    await enviarTelegram(mensagemAviso("telegram"));
    $("btn-telegram").disabled = false;
  });
  $("btn-whats").addEventListener("click", () =>
    window.open("https://wa.me/?text=" + encodeURIComponent(mensagemAviso("whatsapp")), "_blank", "noopener"));
  ligarConta();
  const inicial = (location.hash || "").slice(1);
  if (inicial && document.getElementById(inicial) && document.getElementById(inicial).classList.contains("aba")) irParaAba(inicial);
  restaurarConta();
  atualizar(); atualizarApi();
  setInterval(atualizar, CONFIG.atualizarMs);
  setInterval(atualizarApi, CONFIG.atualizarApiMs);
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", iniciar);
}
if (typeof module !== "undefined") {
  module.exports = { sessoesDe, construirEixo, serie, buscarCep, normalizarLocal, pressaoNivelMar, idEstacao, localAtivo, inicioUltimaSessao, comQuebras, reduzir, pontoIsolado, leituraValida, buscarLeituras, CONFIG, atividadesAtivas, contaCriar, contaEntrar, contaSair, contaContinuarLocal, restaurarConta, salvarAtividade, removerAtividade, restaurarRecomendada, adicionarRecomendada, criarAtividade, limparDadosDoNavegador, normalizarConta, renderRegras, renderConta, textoFaixaConta, traduzErroAuth, limitesY, rotuloX, renderTudo, estado, enviarTelegram, verificarMudancas, mensagemAviso, derivados, pontoOrvalho, indiceCalor, tendencia, anomalia, estimarChuva, avaliarAtividade, ATIVIDADES_PADRAO };
}