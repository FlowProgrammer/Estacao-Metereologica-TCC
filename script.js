"use strict";

/* =====================================================================
   Dashboard da estação meteorológica
   ESP32 -> Firebase Realtime Database -> este dashboard (+ API Open-Meteo)

   Para usar: troque firebaseUrl abaixo pela URL do seu Realtime Database.
   Enquanto o valor tiver "SEU-PROJETO", o dashboard roda em modo
   demonstração, com dados simulados no próprio navegador.
   ===================================================================== */
const CONFIG = {
  firebaseUrl: "https://estacao-metereologica-50584-default-rtdb.firebaseio.com/",
  apiKey: "AIzaSyAKvbL4f6C-MEYAD_lGusr9OjvKryRQ7Ys",             // Web API Key do Firebase (Authentication). Vazio = perfil local, sem senha.
  estacao: "est01",
  lat: -12.27,            // Feira de Santana (BA), aproximado. Ajuste para o seu local.
  lon: -38.97,
  fusoApi: "America/Bahia",
  atualizarMs: 10000,     // consulta ao Firebase
  atualizarApiMs: 600000, // consulta à Open-Meteo (10 min)
  limiteLeituras: 3000,
  localNome: "SENAI, Feira de Santana (BA)"
};
const DEMO = CONFIG.firebaseUrl.includes("SEU-PROJETO");

const COR = { est: "#0B6E7F", estClara: "#7FA3AB", api: "#B7791F", alerta: "#A8402B",
              chuva: "#3B6EA8", grade: "#E3EBE9", mudo: "#5B6E73" };
const NIVEIS = ["Liberado", "Atenção", "Adiar"];

/* Atividades e regras predefinidas, por perfil. Os limites são exemplos e devem
   ser validados com professores e técnicos da área. Um especialista pode
   sobrescrever os critérios (salvos na conta dele, no Firebase).
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
  return { p3: inclinacao("p") * 3, u3: inclinacao("u") * 3, delta: j[j.length - 1].p - j[0].p,
           horas: (j[j.length - 1].ts - j[0].ts) / 3600 };
}

/* Com menos de 3 h de dados, mostra a variação real da janela (ex.: "9,9 hPa em 17 min")
   em vez de extrapolar para 3 h. O ritmo equivalente a 3 h continua valendo para a pontuação. */
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
        ? `${sgn(v.delta)} hPa em ${Math.max(1, Math.round(v.horas * 60))} min (ritmo equivalente a ${sgn(v.p3)} hPa em 3 h)`
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
  return { fatores: f, total, cat };
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
const estado = { leituras: [], api: null, conta: null, rascunho: {}, erro: null, periodo: "24h", apiErro: null };

function gerarDemo() {
  const agora = Math.floor(Date.now() / 1000);
  const passo = 600, n = 3 * 144;
  const out = [];
  const alt = CONFIG.altitude || 234;
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

async function buscarLeituras() {
  if (DEMO) return gerarDemo();
  const q = `orderBy=${encodeURIComponent('"$key"')}&limitToLast=${CONFIG.limiteLeituras}`;
  const r = await fetch(`${CONFIG.firebaseUrl}/estacoes/${CONFIG.estacao}/leituras.json?${q}`);
  if (!r.ok) throw new Error("Firebase respondeu HTTP " + r.status);
  const obj = await r.json();
  if (!obj) return [];
  return Object.entries(obj)
    .map(([k, v]) => ({ ts: Number(v.ts ?? k), t: Number(v.t), u: Number(v.u), pe: Number(v.pe), p: Number(v.p) }))
    .filter(l => isFinite(l.ts) && isFinite(l.p) && isFinite(l.t) && isFinite(l.u))
    .sort((a, b) => a.ts - b.ts);
}

async function buscarApi() {
  const url = "https://api.open-meteo.com/v1/forecast"
    + `?latitude=${CONFIG.lat}&longitude=${CONFIG.lon}`
    + "&hourly=precipitation_probability,precipitation,wind_speed_10m"
    + `&timezone=${encodeURIComponent(CONFIG.fusoApi)}&timeformat=unixtime&forecast_days=2`;
  const r = await fetch(url);
  if (!r.ok) throw new Error("Open-Meteo respondeu HTTP " + r.status);
  const j = await r.json();
  const h = j.hourly, agora = Date.now() / 1000;
  let idx = 0;
  for (let i = 0; i < h.time.length; i++) if (h.time[i] <= agora) idx = i;
  const fatia = (arr, n) => arr.slice(idx, idx + n);
  const max = a => a.length ? Math.max(...a.filter(x => x != null)) : null;
  return {
    consultadoEm: Date.now(),
    horas: fatia(h.time, 12),
    prob: fatia(h.precipitation_probability, 12),
    mm: fatia(h.precipitation, 12),
    vento: fatia(h.wind_speed_10m, 12),
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
function conjunto(label, pontos, cor, tracejado) {
  return { label, data: pontos, borderColor: cor, borderWidth: tracejado ? 1.6 : 2.4, borderDash: tracejado ? [5, 4] : [],
           pointRadius: pontos.length < 40 ? 3 : 0, tension: 0.2, fill: false };
}
const decs = {};
function rotuloX(ms, faixa) {
  const d = new Date(ms);
  if (faixa <= 36 * 3600 * 1000) return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}
function limitesY(datasets, spanMin) {   // eixo ajustado aos dados, com altura mínima
  const ys = [];
  datasets.forEach(d => d.data.forEach(p => ys.push(p.y)));
  if (!ys.length) return { min: undefined, max: undefined, dec: 1 };
  let lo = Math.min(...ys), hi = Math.max(...ys);
  if (hi - lo < spanMin) { const c = (lo + hi) / 2; lo = c - spanMin / 2; hi = c + spanMin / 2; }
  const pad = (hi - lo) * 0.08;
  return { min: lo - pad, max: hi + pad, dec: (hi - lo) < 5 ? 1 : 0 };
}
function desenharLinha(id, datasets, xmin, xmax, spanMin = 0) {
  const el = document.getElementById(id);
  if (!el || typeof Chart === "undefined") return;
  if (xmax - xmin < 60000) xmax = xmin + 60000;
  const ly = limitesY(datasets, spanMin);
  decs[id] = ly.dec;
  if (graficos[id]) {
    const g = graficos[id];
    g.data.datasets = datasets;
    g.options.scales.x.min = xmin; g.options.scales.x.max = xmax;
    g.options.scales.y.min = ly.min; g.options.scales.y.max = ly.max;
    g.update("none");
    return;
  }
  graficos[id] = new Chart(el, {
    type: "line", data: { datasets },
    options: {
      animation: false, responsive: true, maintainAspectRatio: false, parsing: false,
      interaction: { mode: "nearest", intersect: false },
      plugins: { legend: { display: datasets.length > 1, labels: { boxWidth: 12 } } },
      scales: {
        x: { type: "linear", min: xmin, max: xmax, grid: { color: COR.grade },
             ticks: { maxTicksLimit: 8, callback: function (v) { return rotuloX(v, this.max - this.min); } } },
        y: { min: ly.min, max: ly.max, grid: { color: COR.grade },
             ticks: { callback: v => fmt(v, decs[id] ?? 0) } }
      }
    }
  });
}
function desenharBarras(id, rotulos, valores) {
  const el = document.getElementById(id);
  if (!el || typeof Chart === "undefined") return;
  if (graficos[id]) {
    graficos[id].data.labels = rotulos; graficos[id].data.datasets[0].data = valores;
    graficos[id].update("none"); return;
  }
  graficos[id] = new Chart(el, {
    type: "bar",
    data: { labels: rotulos, datasets: [{ data: valores, backgroundColor: COR.api, borderRadius: 3 }] },
    options: {
      animation: false, responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { min: 0, max: 100, ticks: { callback: v => v + " %" }, grid: { color: COR.grade } }, x: { grid: { display: false } } }
    }
  });
}
const serie = (L, campo) => L.map(l => ({ x: l.ts * 1000, y: l[campo] }));

/* ------------------------------ renderização ------------------------------ */
const $ = id => document.getElementById(id);
function texto(id, t) { const e = $(id); if (e) e.textContent = t; }

function renderStatus() {
  const L = estado.leituras;
  let cls = "off", msg;
  if (DEMO) { cls = "demo"; msg = "Modo demonstração (dados simulados no navegador)"; }
  else if (estado.erro) { msg = "Sem conexão com o Firebase: " + estado.erro; }
  else if (!L.length) { msg = "Aguardando as primeiras leituras do ESP32"; }
  else {
    const ult = L[L.length - 1];
    const deltas = L.slice(-6).slice(1).map((l, i) => l.ts - L.slice(-6)[i].ts).sort((a, b) => a - b);
    const intervalo = deltas.length ? deltas[Math.floor(deltas.length / 2)] : 60;
    const limite = Math.max(30, intervalo * 3);
    const idade = Date.now() / 1000 - ult.ts;
    if (idade <= limite) { cls = "on"; msg = `Online, atualizada às ${hhmm(ult.ts * 1000)}`; }
    else { msg = `Offline, última leitura às ${hhmm(ult.ts * 1000)}`; }
  }
  $("ponto").className = "ponto " + cls;
  texto("status-texto", msg);
}

function valor(id, n, un) {
  const e = $(id);
  if (e) e.innerHTML = n + "<small> " + un + "</small>";
}

function renderLeituras(d) {
  if (!d) return;
  const { ult, orv, trend, calor } = d;
  const hoje = estado.leituras.filter(l => l.ts >= ult.ts - 24 * 3600);
  valor("v-temp", fmt(ult.t), "°C");
  texto("s-temp", `mín. ${fmt(Math.min(...hoje.map(l => l.t)))} °C, máx. ${fmt(Math.max(...hoje.map(l => l.t)))} °C em 24 h`);
  valor("v-umid", fmt(ult.u, 0), "%");
  texto("s-umid", trend ? `${sgn(trend.u3, 0)} pontos em 3 h` : "variação indisponível");
  valor("v-pres", fmt(ult.p), "hPa");
  texto("s-pres", trend ? (() => { const v = variacaoPressao(trend); return `${sgn(v.cai ? -v.valor : v.valor)} hPa em ${v.janela}`; })() : "variação indisponível");
  $("v-pres").classList.toggle("alerta", !!trend && trend.p3 <= -2);
  valor("v-orv", fmt(orv), "°C");
  texto("s-orv", `${fmt(ult.t - orv)} °C abaixo da temperatura`);
  valor("v-calor", fmt(calor), "°C");
  texto("s-calor", calor >= 51 ? "perigo extremo (referência NWS)" : calor >= 39 ? "perigo (referência NWS)" : calor >= 32 ? "cuidado extremo (referência NWS)" : calor >= 27 ? "cuidado (referência NWS)" : "igual à temperatura (a fórmula vale acima de 27 °C)");
}

function renderPressao(d) {
  const L = estado.leituras;
  if (!d) return;
  const fim = d.ult.ts * 1000, dia = 24 * 3600 * 1000;
  const hoje = L.filter(l => l.ts * 1000 >= fim - dia);
  const ontem = L.filter(l => l.ts * 1000 >= fim - 2 * dia && l.ts * 1000 < fim - dia)
                 .map(l => ({ x: l.ts * 1000 + dia, y: l.p }));
  const ds = [conjunto("hoje", serie(hoje, "p"), COR.est, false)];
  if (ontem.length) ds.push(conjunto("mesmo horário de ontem", ontem, COR.estClara, true));
  const inicio = hoje.length ? Math.max(fim - dia, hoje[0].ts * 1000) : fim - dia;
  desenharLinha("graf-pressao", ds, inicio, fim, 4);
  if (d.trend) {
    const cai = d.trend.p3 < 0;
    const t = $("tend-titulo");
    const vp = variacaoPressao(d.trend);
    t.textContent = `${cai ? "Caindo" : "Subindo"} ${fmt(vp.valor)} hPa em ${vp.janela}`;
    t.className = cai && d.trend.p3 <= -2 ? "alerta" : "";
    const parcial = d.trend.horas < 2.9 ? `ritmo equivalente a ${sgn(d.trend.p3)} hPa em 3 h. ` : "";
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
  texto("est-motivo", top.length ? "Pesaram: " + top.join(", ") + "." : "Nenhum fator indica chuva agora.");
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
}

function renderAlertas(d) {
  const ul = $("alertas"); ul.innerHTML = "";
  const add = (cls, titulo, det) => {
    const li = document.createElement("li"); li.className = cls;
    li.innerHTML = `<strong></strong><span></span>`;
    li.querySelector("strong").textContent = titulo; li.querySelector("span").textContent = det;
    ul.appendChild(li);
  };
  if (!d) { add("neutro", "Sem leituras", "O dashboard mostra os alertas quando houver dados."); return; }
  if (d.trend && d.trend.p3 <= -2) {
    const v = variacaoPressao(d.trend);
    add("perigo", "Queda de pressão", v.parcial
      ? `${fmt(v.valor)} hPa em ${v.janela} (ritmo equivalente a ${fmt(Math.abs(d.trend.p3))} hPa em 3 h; limite: 2,0 hPa em 3 h)`
      : `${fmt(v.valor)} hPa em 3 h (limite: 2,0 hPa)`);
  }
  if (estado.api && d.est.cat !== "Baixa" && estado.api.chuva3h >= 50) add("ok", "Estação e API concordam", "As duas apontam chuva nas próximas horas.");
  if (estado.api && d.est.cat !== "Baixa" && estado.api.chuva3h < 20)
    add("atencao", "Estação e API divergem", `A estação indica chuva ${d.est.cat.toLowerCase()}, mas a API prevê ${fmt(estado.api.chuva3h, 0)} %. Pode ser mudança local ou leitura atípica do sensor.`);
  if (estado.api && d.est.cat === "Baixa" && estado.api.chuva3h >= 60)
    add("atencao", "Estação e API divergem", `A API prevê ${fmt(estado.api.chuva3h, 0)} % de chuva, mas a estação indica chance baixa.`);
  const ativ = atividadesAtivas();
  for (const a of Object.values(ativ)) {
    const r = avaliarAtividade(a, d.vars);
    if (r.nivel === 2) add("perigo", `${a.nome}: adiar`, r.motivos.filter(m => m.n === 2).map(m => m.texto).join("; "));
  }
  if (!ul.children.length) add("ok", "Tudo tranquilo", "Nenhum alerta ativo no momento.");
}

function recorte(L) {
  if (!L.length) return L;
  const fim = L[L.length - 1].ts;
  const janela = { "24h": 24 * 3600, "7d": 7 * 24 * 3600, tudo: Infinity }[estado.periodo];
  return L.filter(l => l.ts >= fim - janela);
}

function renderHistorico() {
  const L = recorte(estado.leituras);
  if (!L.length) return;
  const xmin = L[0].ts * 1000, xmax = L[L.length - 1].ts * 1000;
  desenharLinha("graf-temp", [conjunto("Temperatura (°C)", serie(L, "t"), COR.est, false)], xmin, xmax, 4);
  desenharLinha("graf-umid", [conjunto("Umidade (%)", serie(L, "u"), COR.est, false)], xmin, xmax, 10);
  desenharLinha("graf-pres", [conjunto("Pressão (hPa)", serie(L, "p"), COR.est, false)], xmin, xmax, 6);
  const linhas = [["Temperatura (°C)", "t", 1], ["Umidade (%)", "u", 0], ["Pressão (hPa)", "p", 1]].map(([nome, c, d]) => {
    const v = L.map(l => l[c]);
    const media = v.reduce((a, b) => a + b, 0) / v.length;
    return `<tr><td>${nome}</td><td>${fmt(Math.min(...v), d)}</td><td>${fmt(media, d)}</td><td>${fmt(Math.max(...v), d)}</td></tr>`;
  });
  $("resumo").innerHTML = linhas.join("");
}

function renderPrevisao(d) {
  if (!d) return;
  const caixa = $("fatores"); caixa.innerHTML = "";
  d.est.fatores.forEach(f => {
    const div = document.createElement("div"); div.className = "fator";
    div.innerHTML = `<div><strong></strong><span class="mudo"></span></div><div class="trilho"><div class="preench"></div><b></b></div>`;
    div.querySelector("strong").textContent = f.nome;
    div.querySelector(".mudo").textContent = f.det;
    div.querySelector(".preench").style.width = (f.pts * 2.5) + "px";
    div.querySelector("b").textContent = "+" + f.pts;
    caixa.appendChild(div);
  });
  texto("total-pts", `${d.est.total}: ${d.est.cat.toLowerCase()}`);
  $("marcador").style.left = clip(d.est.total, 0, 100) + "%";
}

function renderAtividades() {
  texto("faixa-ativ", textoFaixaConta());
  const d = derivados();
  const caixa = $("cards"); caixa.innerHTML = "";
  const ativ = atividadesAtivas();
  if (!d) { caixa.innerHTML = '<p class="mudo">Aguardando leituras para avaliar as atividades.</p>'; return; }
  for (const a of Object.values(ativ)) {
    const r = avaliarAtividade(a, d.vars);
    const div = document.createElement("div");
    div.className = "cartao n" + r.nivel;
    div.innerHTML = `<div class="topo-cartao"><h3></h3><span class="selo"></span></div><p class="mudo perfil"></p><ul></ul>`;
    div.querySelector("h3").textContent = a.nome;
    div.querySelector(".selo").textContent = NIVEIS[r.nivel];
    div.querySelector(".perfil").textContent = "Perfil: " + (a.perfil || "geral");
    const ul = div.querySelector("ul");
    (r.motivos.length ? r.motivos : [{ texto: "Nenhuma regra disparada." }]).forEach(m => {
      const li = document.createElement("li"); li.textContent = m.texto; ul.appendChild(li);
    });
    caixa.appendChild(div);
  }
}

function mensagemAviso() {
  const d = derivados();
  if (!d) return "Estação meteorológica: sem leituras no momento.";
  const ativ = atividadesAtivas();
  const linhas = [`Estação meteorológica, ${CONFIG.localNome} (${hhmm(Date.now())})`,
    `Temperatura ${fmt(d.ult.t)} °C, umidade ${fmt(d.ult.u, 0)} %, pressão ${fmt(d.ult.p)} hPa.`];
  for (const a of Object.values(ativ)) {
    const r = avaliarAtividade(a, d.vars);
    linhas.push(`${a.nome}: ${NIVEIS[r.nivel]}` + (r.motivos.length ? ` (${r.motivos[0].texto})` : ""));
  }
  linhas.push("Apoio à decisão, não substitui o julgamento do responsável.");
  return linhas.join("\n");
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
  const e = $("tg-status");
  if (e) { e.textContent = msg; e.className = "mudo" + (erro ? " erro" : ""); }
}
async function enviarTelegram(texto) {
  if (!TG.token() || !TG.chat()) {
    statusTg("Configure o token e o chat id do Telegram primeiro.", true);
    return false;
  }
  try {
    const r = await fetch(`https://api.telegram.org/bot${TG.token()}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TG.chat(), text: texto })
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
      mudou.push(`${a.nome}: ${NIVEIS[niveisAnteriores[id]]} para ${NIVEIS[n]}`);
    niveisAnteriores[id] = n;
  }
  if (mudou.length && TG.auto() && Date.now() - ultimoAuto > 60000) {
    ultimoAuto = Date.now();
    enviarTelegram("Mudança de nível:\n" + mudou.join("\n") + "\n\n" + mensagemAviso());
  }
}

function exportarCsv() {
  const linhas = ["data_hora,temperatura_c,umidade_pct,pressao_estacao_hpa,pressao_nivel_mar_hpa"];
  estado.leituras.forEach(l => linhas.push([new Date(l.ts * 1000).toISOString(), l.t, l.u, l.pe, l.p].join(",")));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([linhas.join("\n")], { type: "text/csv" }));
  a.download = "leituras_estacao.csv"; a.click();
}

function renderTudo() {
  const d = derivados();
  renderStatus(); renderLeituras(d); renderPressao(d); renderChuva(d);
  renderApiGrafico(); renderAlertas(d); renderHistorico(); renderPrevisao(d); renderAtividades(); renderConta();
  verificarMudancas(d);
}

/* ===================== Conta, perfil e regras =====================
   Com apiKey configurada, a conta usa o Firebase Authentication (e-mail e senha,
   pela API REST) e os dados ficam em /usuarios/{uid}. Sem apiKey, vale um perfil
   local, só neste navegador e sem senha (modo demonstração).
   Observação: nesta versão o tipo de conta "especialista" é escolhido pelo próprio
   usuário e não é verificado. Em uso real, um administrador deveria aprovar. */
const PERFIS = {
  escola: "Atividades ao ar livre acadêmicas e educação física",
  agricola: "Atividades agrícolas (pulverização, irrigação, colheita)"
};
const OPERADORES = [[">=", "maior ou igual a"], [">", "maior que"], ["<=", "menor ou igual a"], ["<", "menor que"]];
const modoLocal = () => !CONFIG.apiKey || CONFIG.firebaseUrl.includes("SEU-PROJETO");
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

function normalizarRegras(r) {
  const out = {};
  for (const [id, a] of Object.entries(r || {})) {
    if (!a) continue;
    out[id] = {
      nome: String(a.nome || id), perfil: PERFIS[a.perfil] ? a.perfil : "escola", nova: !!a.nova,
      regras: lista(a.regras)
        .map(x => ({ v: x.v, op: x.op, lim: Number(x.lim), nivel: x.nivel === "adiar" ? "adiar" : "atencao" }))
        .filter(x => VARIAVEIS[x.v] && OPERADORES.some(o => o[0] === x.op) && Number.isFinite(x.lim))
    };
  }
  return out;
}
function normalizarConta(c) {
  const perfis = lista(c.perfis).filter(p => PERFIS[p]);
  return {
    uid: c.uid || "", email: c.email || "", nome: String(c.nome || ""),
    papel: c.papel === "especialista" ? "especialista" : "usuario",
    perfis: perfis.length ? perfis : ["escola"], regras: normalizarRegras(c.regras)
  };
}

/* Atividades que valem para quem está usando: padrão do(s) perfil(is) + critérios do especialista. */
function atividadesAtivas() {
  const c = estado.conta;
  const perfis = c ? c.perfis : Object.keys(PERFIS);
  const out = {};
  for (const [id, a] of Object.entries(ATIVIDADES_PADRAO)) if (perfis.includes(a.perfil)) out[id] = a;
  if (c) for (const [id, a] of Object.entries(c.regras)) if (perfis.includes(a.perfil)) out[id] = a;
  return out;
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
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:${acao}?key=${CONFIG.apiKey}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...corpo, returnSecureToken: true })
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
    const r = await fetch(`https://securetoken.googleapis.com/v1/token?key=${CONFIG.apiKey}`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(s.refreshToken)}`
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
  const r = await fetch(`${CONFIG.firebaseUrl}/usuarios/${s.uid}${caminho}.json?auth=${encodeURIComponent(t)}`, {
    method: metodo, headers: { "Content-Type": "application/json" },
    body: corpo === undefined ? undefined : JSON.stringify(corpo)
  });
  if (!r.ok) throw new Error(r.status === 401 || r.status === 403
    ? "Sem permissão no Firebase. Confira as regras do banco." : "Firebase respondeu HTTP " + r.status);
  return r.json();
}

async function contaCriar({ nome, email, senha, papel, perfis }) {
  if (!String(nome || "").trim()) throw new Error("Informe seu nome.");
  if (!perfis || !perfis.length) throw new Error("Escolha pelo menos um perfil.");
  papel = papel === "especialista" ? "especialista" : "usuario";
  if (modoLocal()) {
    const c = { uid: "local", email: "", nome: nome.trim(), papel, perfis, regras: {} };
    localStorage.setItem("conta_local", JSON.stringify(c));
    localStorage.setItem("conta_local_ativa", "1");
    estado.conta = normalizarConta(c);
    return;
  }
  if (!String(email || "").trim()) throw new Error("Informe o e-mail.");
  const j = await idCall("signUp", { email, password: senha });
  const s = gravarSessaoDe(j, email);
  const dados = { nome: nome.trim(), email, papel, perfis, criadoEm: Date.now() };
  try { await dbUsuario("PUT", "", dados); }
  catch (e) { throw new Error("Conta criada, mas não foi possível salvar o perfil: " + e.message); }
  estado.conta = normalizarConta({ uid: s.uid, ...dados });
}
async function carregarContaRemota() {
  const s = SESSAO.ler();
  if (!s) return;
  const d = await dbUsuario("GET", "");
  if (!d) {   // login ok, mas sem perfil salvo: cria um perfil básico
    const dados = { nome: (s.email || "").split("@")[0], email: s.email, papel: "usuario", perfis: ["escola"], criadoEm: Date.now() };
    await dbUsuario("PUT", "", dados);
    estado.conta = normalizarConta({ uid: s.uid, ...dados });
    return;
  }
  estado.conta = normalizarConta({ ...d, uid: s.uid, email: d.email || s.email });
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
}
function contaSair() {
  if (modoLocal()) localStorage.setItem("conta_local_ativa", "0"); else SESSAO.limpar();
  estado.conta = null; estado.rascunho = {};
}
async function restaurarConta() {
  try {
    if (modoLocal()) {
      const c = lerContaLocal();
      if (c && localStorage.getItem("conta_local_ativa") === "1") estado.conta = normalizarConta(c);
    } else if (SESSAO.ler()) await carregarContaRemota();
  } catch (e) { SESSAO.limpar(); }
  renderTudo(); renderRegras();
}

/* ------------------------- edição das regras (especialista) ------------------------- */
function exigirEspecialista() {
  if (!estado.conta || estado.conta.papel !== "especialista") throw new Error("Somente especialistas editam as regras.");
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
  exigirEspecialista();
  const erro = validarAtividade(a);
  if (erro) throw new Error(erro);
  estado.conta.regras[id] = {
    nome: a.nome.trim(), perfil: a.perfil, nova: !(id in ATIVIDADES_PADRAO),
    regras: a.regras.map(r => ({ v: r.v, op: r.op, lim: Number(r.lim), nivel: r.nivel === "adiar" ? "adiar" : "atencao" }))
  };
  await contaSalvarRegras();
}
async function restaurarAtividade(id) {     // volta ao padrão (ou exclui, se for atividade nova)
  exigirEspecialista();
  delete estado.conta.regras[id];
  await contaSalvarRegras();
}
async function criarAtividade(nome, perfil) {
  exigirEspecialista();
  if (!String(nome || "").trim()) throw new Error("Dê um nome à atividade.");
  const c = estado.conta;
  if (!c.perfis.includes(perfil)) throw new Error("Escolha um dos seus perfis.");
  const id = "x_" + Date.now().toString(36);
  c.regras[id] = { nome: nome.trim(), perfil, nova: true, regras: [] };
  await contaSalvarRegras();
  return id;
}

/* ------------------------------ interface da conta ------------------------------ */
function textoFaixaConta() {
  const c = estado.conta;
  if (!c) return "Você está como visitante e vê as regras padrão dos dois perfis. Crie uma conta para escolher o seu perfil.";
  const perfis = c.perfis.map(p => PERFIS[p]).join(" e ");
  return `Perfil: ${perfis}. ` + (c.papel === "especialista"
    ? "Como especialista, você pode definir os critérios na aba Regras."
    : "As regras são as padrão; só especialistas podem alterá-las.");
}
function renderConta() {
  const c = estado.conta;
  $("btn-conta").classList.toggle("oculto", !!c);
  $("conta-info").classList.toggle("oculto", !c);
  if (c) texto("conta-nome", `${c.nome || c.email}, ${c.papel === "especialista" ? "especialista" : "usuário"}`);
}

function el(tag, props, filhos) {
  const e = document.createElement(tag);
  Object.assign(e, props || {});
  (filhos || []).forEach(f => e.appendChild(typeof f === "string" ? document.createTextNode(f) : f));
  return e;
}
function statusRegras(msg, erro) {
  const e = $("regras-status");
  if (e) { e.textContent = msg; e.className = "mudo" + (erro ? " erro" : ""); }
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
  return el("div", { className: "criterio" }, [selVar, selOp, num, un, rem]);
}
function secaoRegras(a, nivel, titulo, edita) {
  const box = el("div", { className: "secao n-" + nivel }, [el("h4", { textContent: titulo })]);
  const itens = a.regras.filter(x => x.nivel === nivel);
  if (!itens.length) box.appendChild(el("p", { className: "mudo", textContent: "Nenhum critério." }));
  itens.forEach(regra => box.appendChild(edita ? linhaEditavel(a, regra)
    : el("p", { className: "criterio-texto", textContent: textoCriterio(regra) })));
  if (edita) {
    const b = el("button", { type: "button", className: "contorno peq", textContent: "+ Adicionar critério" });
    b.addEventListener("click", () => { a.regras.push({ v: "chuva_api_3h", op: ">=", lim: 50, nivel }); renderRegras(); });
    box.appendChild(b);
  }
  return box;
}
function cartaoRegras(id, base, edita) {
  const a = edita ? rascunhoDe(id) : base;
  const personalizada = !!(estado.conta && estado.conta.regras[id]);
  const selo = !(id in ATIVIDADES_PADRAO) ? "criada por especialista" : (personalizada ? "personalizada" : "padrão");
  const topo = el("div", { className: "topo-cartao" }, [el("h3", { textContent: a.nome }), el("span", { className: "selo-neutro", textContent: selo })]);
  const cartao = el("div", { className: "cartao-regras" }, [topo,
    el("p", { className: "mudo", textContent: "Perfil: " + (PERFIS[a.perfil] || a.perfil) })]);
  if (edita && !(id in ATIVIDADES_PADRAO)) {
    const nome = el("input", { type: "text", value: a.nome, className: "nome-atividade" });
    nome.addEventListener("input", () => { a.nome = nome.value; });
    cartao.appendChild(nome);
  }
  cartao.appendChild(secaoRegras(a, "adiar", "Adiar quando qualquer um destes critérios ocorrer", edita));
  cartao.appendChild(secaoRegras(a, "atencao", "Atenção quando qualquer um destes critérios ocorrer", edita));
  cartao.appendChild(el("p", { className: "mudo", textContent: "Liberado: quando nenhum critério acima se aplica." }));
  if (edita) {
    const acoes = el("div", { className: "botoes" });
    const salvar = el("button", { type: "button", className: "cheio peq", textContent: "Salvar regras" });
    salvar.addEventListener("click", async () => {
      try {
        await salvarAtividade(id, a);
        delete estado.rascunho[id];
        statusRegras(`Regras de "${a.nome.trim()}" salvas.`, false);
        renderRegras(); renderTudo();
      } catch (e) { statusRegras("Não foi possível salvar: " + e.message, true); }
    });
    acoes.appendChild(salvar);
    const descartar = el("button", { type: "button", className: "contorno peq", textContent: "Descartar alterações" });
    descartar.addEventListener("click", () => { delete estado.rascunho[id]; statusRegras("Alterações descartadas.", false); renderRegras(); });
    acoes.appendChild(descartar);
    if (personalizada) {
      const nova = !(id in ATIVIDADES_PADRAO);
      const rest = el("button", { type: "button", className: "contorno peq", textContent: nova ? "Excluir atividade" : "Restaurar padrão" });
      rest.addEventListener("click", async () => {
        try {
          await restaurarAtividade(id);
          delete estado.rascunho[id];
          statusRegras(nova ? "Atividade excluída." : "Critérios padrão restaurados.", false);
          renderRegras(); renderTudo();
        } catch (e) { statusRegras("Não foi possível concluir: " + e.message, true); }
      });
      acoes.appendChild(rest);
    }
    cartao.appendChild(acoes);
  }
  return cartao;
}
function formNovaAtividade() {
  const sel = el("select");
  estado.conta.perfis.forEach(p => sel.appendChild(el("option", { value: p, textContent: PERFIS[p] })));
  const nome = el("input", { type: "text", placeholder: "Nome da nova atividade" });
  const b = el("button", { type: "button", className: "contorno", textContent: "Criar atividade" });
  b.addEventListener("click", async () => {
    try {
      await criarAtividade(nome.value, sel.value);
      statusRegras("Atividade criada. Defina os critérios e salve.", false);
      renderRegras(); renderTudo();
    } catch (e) { statusRegras(e.message, true); }
  });
  return el("div", { className: "nova-atividade" }, [el("h3", { textContent: "Nova atividade" }), nome, sel, b]);
}
function renderRegras() {
  const raiz = $("regras-conteudo");
  if (!raiz) return;
  raiz.innerHTML = "";
  texto("faixa-regras", textoFaixaConta());
  const edita = !!estado.conta && estado.conta.papel === "especialista";
  Object.entries(atividadesAtivas()).forEach(([id, a]) => raiz.appendChild(cartaoRegras(id, a, edita)));
  if (edita) raiz.appendChild(formNovaAtividade());
}

/* ------------------------------ janela de login ------------------------------ */
let modoModal = "entrar";
function definirModoModal(modo) {
  modoModal = modo;
  const local = modoLocal();
  $("tab-entrar").classList.toggle("ativa", modo === "entrar");
  $("tab-criar").classList.toggle("ativa", modo === "criar");
  ["campo-nome", "campo-papel", "campo-perfis"].forEach(id => $(id).classList.toggle("oculto", modo !== "criar"));
  ["campo-email", "campo-senha"].forEach(id => $(id).classList.toggle("oculto", local));
  $("c-enviar").textContent = modo === "criar" ? "Criar conta" : (local ? "Continuar" : "Entrar");
  const c = lerContaLocal();
  $("aviso-modo").textContent = local
    ? "Modo demonstração: o perfil fica só neste navegador e não usa senha." + (modo === "entrar" && c ? ` Perfil salvo: ${c.nome}.` : "")
    : "";
  $("c-erro").textContent = "";
}
async function enviarModal() {
  const erro = $("c-erro");
  erro.textContent = "";
  $("c-enviar").disabled = true;
  try {
    if (modoModal === "criar") {
      const papel = document.querySelector('input[name="c-papel"]:checked');
      await contaCriar({
        nome: $("c-nome").value, email: $("c-email").value.trim(), senha: $("c-senha").value,
        papel: papel ? papel.value : "usuario",
        perfis: Array.from(document.querySelectorAll('input[name="c-perfil"]:checked')).map(x => x.value)
      });
    } else if (modoLocal()) contaContinuarLocal();
    else await contaEntrar($("c-email").value.trim(), $("c-senha").value);
    $("dlg-conta").close();
    estado.rascunho = {};
    renderTudo(); renderRegras();
  } catch (e) { erro.textContent = e.message; }
  finally { $("c-enviar").disabled = false; }
}
function ligarConta() {
  $("btn-conta").addEventListener("click", () => { definirModoModal("entrar"); $("dlg-conta").showModal(); });
  $("btn-sair").addEventListener("click", () => { contaSair(); renderTudo(); renderRegras(); });
  $("tab-entrar").addEventListener("click", () => definirModoModal("entrar"));
  $("tab-criar").addEventListener("click", () => definirModoModal("criar"));
  $("c-cancelar").addEventListener("click", () => $("dlg-conta").close());
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

function iniciar() {
  texto("local", CONFIG.localNome);
  document.querySelectorAll("#abas button").forEach(b => b.addEventListener("click", () => {
    document.querySelectorAll("#abas button").forEach(x => x.classList.remove("ativa"));
    document.querySelectorAll(".aba").forEach(x => x.classList.remove("ativa"));
    b.classList.add("ativa"); $(b.dataset.aba).classList.add("ativa");
    if (b.dataset.aba === "regras") renderRegras();
    window.dispatchEvent(new Event("resize"));
  }));
  document.querySelectorAll("#periodos button").forEach(b => b.addEventListener("click", () => {
    document.querySelectorAll("#periodos button").forEach(x => x.classList.remove("ativa"));
    b.classList.add("ativa"); estado.periodo = b.dataset.periodo; renderHistorico();
  }));
  $("btn-csv").addEventListener("click", exportarCsv);
  $("tg-token").value = TG.token();
  $("tg-chat").value = TG.chat();
  $("tg-auto").checked = TG.auto();
  $("btn-tg-salvar").addEventListener("click", () => {
    localStorage.setItem("tg_token", $("tg-token").value.trim());
    localStorage.setItem("tg_chat", $("tg-chat").value.trim());
    statusTg("Configuração salva neste navegador.", false);
  });
  $("tg-auto").addEventListener("change", e => localStorage.setItem("tg_auto", e.target.checked ? "1" : "0"));
  $("btn-telegram").addEventListener("click", async () => {
    $("btn-telegram").disabled = true;
    statusTg("Enviando…", false);
    await enviarTelegram(mensagemAviso());
    $("btn-telegram").disabled = false;
  });
  $("btn-whats").addEventListener("click", () =>
    window.open("https://wa.me/?text=" + encodeURIComponent(mensagemAviso()), "_blank"));
  ligarConta();
  restaurarConta();
  atualizar(); atualizarApi();
  setInterval(atualizar, CONFIG.atualizarMs);
  setInterval(atualizarApi, CONFIG.atualizarApiMs);
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", iniciar);
}
if (typeof module !== "undefined") {
  module.exports = { CONFIG, atividadesAtivas, contaCriar, contaEntrar, contaSair, contaContinuarLocal, restaurarConta, salvarAtividade, restaurarAtividade, criarAtividade, normalizarConta, renderRegras, renderConta, textoFaixaConta, traduzErroAuth, limitesY, rotuloX, renderTudo, estado, enviarTelegram, verificarMudancas, mensagemAviso, derivados, pontoOrvalho, indiceCalor, tendencia, anomalia, estimarChuva, avaliarAtividade, ATIVIDADES_PADRAO };
}