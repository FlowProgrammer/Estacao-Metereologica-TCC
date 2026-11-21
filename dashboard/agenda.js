"use strict";

/* =====================================================================
   ClimaSense: aba Agenda (Parte 1: importar e editar a planilha)

   - SheetJS (xlsx) lê arquivos .xlsx e .xls. O .csv é lido aqui mesmo,
     porque o CSV brasileiro costuma vir com ";" e em Windows-1252.
   - Jspreadsheet CE mostra a planilha editável (digitar ou colar do Excel).
   - As bibliotecas só são baixadas quando a aba Agenda é aberta.

   Parte 1: window.Agenda.lerTabela()
   -> [{ linha, dataISO, dataBR, atividade, responsavel, erros: [] }]
   Parte 2: window.Agenda.analisar() cruza cada data com a previsão da
   Open-Meteo e guarda o resultado em window.Agenda.resultado
   -> [{ ...linha, risco, motivo, previsao }]   (risco: alto | moderado | baixo | sem-previsao | passada | invalida)
   Parte 3: salvarAgenda() grava em /usuarios/{uid}/agenda (pela função api/usuario do Vercel);
   avisarRiscos() manda ao Telegram as atividades com risco alto ou em atenção.
   ===================================================================== */

(function () {
  /* ---------- configuração ---------- */
  const LIMITE_LINHAS = 500;               // máximo de agendamentos importados
  const LIMITE_BYTES = 2 * 1024 * 1024;    // máximo de 2 MB por arquivo
  const LINHAS_MINIMAS = 12;               // linhas vazias na tela, para colar à vontade
  const LIBS = {
    sheetjs: "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
    jsuitesJs: "https://cdn.jsdelivr.net/npm/jsuites@5/dist/jsuites.js",
    jsuitesCss: "https://cdn.jsdelivr.net/npm/jsuites@5/dist/jsuites.css",
    planilhaJs: "https://cdn.jsdelivr.net/npm/jspreadsheet-ce@4/dist/index.js",
    planilhaCss: "https://cdn.jsdelivr.net/npm/jspreadsheet-ce@4/dist/jspreadsheet.css"
  };

  /* Critérios de risco de chuva (Parte 2). Ajuste aqui se o professor definir outros limites. */
  const RISCO = {
    altoProb: 70, altoMm: 5,        // risco ALTO: chance >= 70 % ou chuva >= 5 mm no dia
    modProb: 40, modMm: 1,          // risco MODERADO: chance >= 40 % ou chuva >= 1 mm
    dias: 7                         // alcance da previsão consultada (hoje + 6 dias)
  };
  const CODIGOS_CHUVA = [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99];   // códigos WMO de garoa, chuva, pancadas e trovoada

  let planilha = null;      // instância do Jspreadsheet
  let resultado = [];       // última análise (Parte 2)
  let montando = null;      // promessa da montagem (evita montar duas vezes)

  /* ---------- 1) carregamento das bibliotecas ---------- */
  const _cache = {};
  function carregarScript(url) {
    if (!_cache[url]) {
      _cache[url] = new Promise((ok, erro) => {
        const s = document.createElement("script");
        s.src = url;
        s.onload = ok;
        s.onerror = () => { delete _cache[url]; erro(new Error("Não foi possível carregar " + url + ". Confira a internet e tente de novo.")); };
        document.head.appendChild(s);
      });
    }
    return _cache[url];
  }
  function carregarCss(url) {
    if (document.querySelector(`link[href="${url}"]`)) return;
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = url;
    document.head.appendChild(l);
  }
  async function garantirSheetJS() {
    if (window.XLSX) return;
    await carregarScript(LIBS.sheetjs);
    if (!window.XLSX) throw new Error("A biblioteca SheetJS não inicializou.");
  }

  /* ---------- 2) datas e textos ---------- */
  const doisDigitos = n => String(n).padStart(2, "0");
  const limpar = v => String(v === null || v === undefined ? "" : v).replace(/[<>]/g, "").trim();   // sem < > (a célula não vira HTML)
  const semAcento = s => String(s === null || s === undefined ? "" : s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();

  function isoValido(a, m, d) {
    if (a < 2000 || a > 2100) return "";
    const dt = new Date(Date.UTC(a, m - 1, d));
    if (dt.getUTCFullYear() !== a || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return "";
    return `${a}-${doisDigitos(m)}-${doisDigitos(d)}`;
  }

  /* Aceita: número de série do Excel, Date, "25/11/2026", "25-11-26", "2026-11-25".
     Devolve "AAAA-MM-DD" ou "" se não for uma data válida. */
  function normalizarData(valor) {
    if (valor instanceof Date && !isNaN(valor)) return isoValido(valor.getFullYear(), valor.getMonth() + 1, valor.getDate());
    if (typeof valor === "number" && isFinite(valor)) {
      if (valor < 36526 || valor > 73415) return "";                  // fora de 2000-2100: não é data
      const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(valor) * 86400000);
      return isoValido(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    }
    const t = limpar(valor);
    let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return isoValido(+m[1], +m[2], +m[3]);
    m = t.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2}|\d{4})$/);
    if (m) return isoValido(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
    return "";
  }
  const isoParaBR = iso => iso ? iso.split("-").reverse().join("/") : "";

  /* ---------- 3) leitura de arquivos ---------- */
  function decodificarTexto(buffer) {
    try { return new TextDecoder("utf-8", { fatal: true }).decode(buffer).replace(/^\uFEFF/, ""); }
    catch (e) { return new TextDecoder("windows-1252").decode(buffer); }   // CSV salvo pelo Excel em português
  }

  /* CSV simples: separador ";" "," ou tab (detectado), aspas e quebras de linha dentro de aspas */
  function parseCSV(texto) {
    const primeira = texto.split(/\r?\n/).find(l => l.trim()) || "";
    const conta = c => primeira.split(c).length - 1;
    const sep = [";", "\t", ","].sort((a, b) => conta(b) - conta(a))[0];
    const linhas = [];
    let campo = "", linha = [], aspas = false;
    for (let i = 0; i < texto.length; i++) {
      const c = texto[i];
      if (aspas) {
        if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
        else if (c === '"') aspas = false;
        else campo += c;
      } else if (c === '"') aspas = true;
      else if (c === sep) { linha.push(campo); campo = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && texto[i + 1] === "\n") i++;
        linha.push(campo); campo = "";
        linhas.push(linha); linha = [];
      } else campo += c;
    }
    if (campo !== "" || linha.length) { linha.push(campo); linhas.push(linha); }
    return linhas.filter(l => l.some(c => String(c).trim() !== ""));
  }

  function excelParaMatriz(buffer) {
    const wb = XLSX.read(buffer, { type: "array" });
    const aba = wb.Sheets[wb.SheetNames[0]];          // primeira aba da planilha
    if (!aba) throw new Error("A planilha está vazia.");
    return XLSX.utils.sheet_to_json(aba, { header: 1, raw: true, defval: "" });
  }

  /* Procura o cabeçalho (Data, Atividade, Responsável) nas 10 primeiras linhas.
     Sem cabeçalho, usa as 3 primeiras colunas nessa ordem. */
  function matrizParaLinhas(matriz) {
    let idx = { data: 0, atividade: 1, responsavel: 2 }, inicio = 0, achou = false;
    for (let i = 0; i < Math.min(matriz.length, 10); i++) {
      const nomes = matriz[i].map(semAcento);
      const d = nomes.indexOf("data"), a = nomes.indexOf("atividade");
      if (d >= 0 && a >= 0) { idx = { data: d, atividade: a, responsavel: nomes.indexOf("responsavel") }; inicio = i + 1; achou = true; break; }
    }
    const linhas = [];
    let cortou = false;
    for (let i = inicio; i < matriz.length; i++) {
      const r = matriz[i];
      const bruto = r[idx.data];
      const iso = normalizarData(bruto);
      const linha = [iso ? isoParaBR(iso) : limpar(bruto), limpar(r[idx.atividade]), idx.responsavel >= 0 ? limpar(r[idx.responsavel]) : ""];
      if (!linha[0] && !linha[1] && !linha[2]) continue;
      if (linhas.length >= LIMITE_LINHAS) { cortou = true; break; }
      linhas.push(linha);
    }
    const avisos = [];
    if (!achou) avisos.push("Não achei o cabeçalho; usei as 3 primeiras colunas como Data, Atividade e Responsável.");
    if (cortou) avisos.push(`Só as primeiras ${LIMITE_LINHAS} linhas foram importadas.`);
    return { linhas, avisos };
  }

  async function lerArquivo(arquivo) {
    if (arquivo.size > LIMITE_BYTES) throw new Error("O arquivo passa de 2 MB.");
    const ext = (arquivo.name.split(".").pop() || "").toLowerCase();
    if (!["xlsx", "xls", "csv"].includes(ext)) throw new Error("Formato não suportado. Use .xlsx, .xls ou .csv.");
    const buffer = await arquivo.arrayBuffer();
    let matriz;
    if (ext === "csv") matriz = parseCSV(decodificarTexto(buffer));
    else { await garantirSheetJS(); matriz = excelParaMatriz(buffer); }
    return matrizParaLinhas(matriz);
  }

  /* ---------- 4) planilha interativa (Jspreadsheet CE) ---------- */
  function montarPlanilha() {
    if (planilha) return Promise.resolve(planilha);
    if (!montando) {
      montando = (async () => {
        carregarCss(LIBS.jsuitesCss);
        carregarCss(LIBS.planilhaCss);
        if (!window.jSuites) await carregarScript(LIBS.jsuitesJs);
        if (!window.jspreadsheet) await carregarScript(LIBS.planilhaJs);
        if (!window.jspreadsheet) throw new Error("A biblioteca Jspreadsheet não inicializou.");
        planilha = window.jspreadsheet(document.getElementById("agenda-grid"), {
          data: linhasVazias(LINHAS_MINIMAS),
          columns: [
            { type: "text", title: "Data (dd/mm/aaaa)", width: 150 },
            { type: "text", title: "Atividade", width: 320 },
            { type: "text", title: "Responsável", width: 200 }
          ],
          minDimensions: [3, LINHAS_MINIMAS],
          allowInsertColumn: false, allowDeleteColumn: false, allowRenameColumn: false, allowManualInsertColumn: false,
          tableOverflow: true, tableWidth: "100%", tableHeight: "380px",
          onafterchanges: () => { esconderResultado(); setTimeout(atualizarResumo, 0); },
          oninsertrow: () => { esconderResultado(); setTimeout(atualizarResumo, 0); },
          ondeleterow: () => { esconderResultado(); setTimeout(atualizarResumo, 0); }
        });
        atualizarResumo();
        return planilha;
      })().catch(e => { montando = null; throw e; });
    }
    return montando;
  }

  const linhasVazias = n => Array.from({ length: n }, () => ["", "", ""]);

  /* Coloca as linhas na tabela (completa com linhas vazias para dar espaço de colar) */
  function carregarLinhas(linhas) {
    if (!planilha) return;
    const dados = linhas.slice();
    while (dados.length < LINHAS_MINIMAS) dados.push(["", "", ""]);
    planilha.setData(dados);
    esconderResultado();
    atualizarResumo();
  }

  /* ---------- 5) extração dos dados (entrada da Parte 2) ---------- */
  function lerTabela() {
    const dados = planilha ? planilha.getData() : [];
    const linhas = [];
    dados.forEach((r, i) => {
      const [d, a, p] = [r[0], r[1], r[2]].map(limpar);
      if (!d && !a && !p) return;
      const iso = normalizarData(d);
      const erros = [];
      if (!iso) erros.push("Data inválida ou vazia (use dd/mm/aaaa)");
      if (!a) erros.push("Atividade vazia");
      linhas.push({ linha: i + 1, dataISO: iso, dataBR: iso ? isoParaBR(iso) : d, atividade: a, responsavel: p, erros });
    });
    return linhas;
  }

  /* ---------- 6) previsão e risco climático (Parte 2) ---------- */
  function descreverTempo(c) {
    if (c === 0) return "Céu limpo";
    if (c >= 1 && c <= 3) return "Parcialmente nublado";
    if (c === 45 || c === 48) return "Neblina";
    if (c >= 51 && c <= 57) return "Garoa";
    if ((c >= 61 && c <= 67)) return "Chuva";
    if (c >= 80 && c <= 82) return "Pancadas de chuva";
    if (c >= 95) return "Trovoada";
    return "Tempo variável";
  }

  /* Uma consulta só (mesmo local da estação) traz os próximos 7 dias.
     Devolve { "AAAA-MM-DD": { prob, mm, tmax, tmin, vento, codigo } } */
  async function buscarPrevisaoDiaria() {
    const loc = localAtivo();                                  // script.js: local da estação ativa
    const url = "https://api.open-meteo.com/v1/forecast"
      + `?latitude=${loc.lat}&longitude=${loc.lon}`
      + "&daily=precipitation_probability_max,precipitation_sum,temperature_2m_max,temperature_2m_min,wind_speed_10m_max,weather_code"
      + `&timezone=${encodeURIComponent(CONFIG.fusoApi)}&forecast_days=${RISCO.dias}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error("A Open-Meteo respondeu HTTP " + r.status);
    const d = (await r.json()).daily;
    if (!d || !d.time) throw new Error("A Open-Meteo não devolveu a previsão diária.");
    const previsao = {};
    d.time.forEach((dia, i) => {
      previsao[dia] = {
        prob: d.precipitation_probability_max[i], mm: d.precipitation_sum[i],
        tmax: d.temperature_2m_max[i], tmin: d.temperature_2m_min[i],
        vento: d.wind_speed_10m_max[i], codigo: d.weather_code[i]
      };
    });
    return previsao;
  }

  /* Classifica o dia: alto, moderado ou baixo (por probabilidade, volume ou código de chuva) */
  function classificar(p) {
    const prob = p.prob == null ? 0 : p.prob, mm = p.mm == null ? 0 : p.mm;
    const motivos = [];
    if (prob >= RISCO.modProb) motivos.push(`chance de chuva de ${Math.round(prob)} %`);
    if (mm >= RISCO.modMm) motivos.push(`${mm.toFixed(1).replace(".", ",")} mm previstos`);
    const chuvoso = CODIGOS_CHUVA.includes(p.codigo);
    if (chuvoso && !motivos.length) motivos.push(descreverTempo(p.codigo).toLowerCase() + " previsto(a)");
    const nivel = (prob >= RISCO.altoProb || mm >= RISCO.altoMm) ? "alto"
      : (prob >= RISCO.modProb || mm >= RISCO.modMm || chuvoso) ? "moderado" : "baixo";
    return { risco: nivel, motivo: motivos.length ? motivos.join(" e ") : "Sem sinal de chuva", };
  }

  /* Cruza as linhas da tabela com a previsão. Função pura (não mexe na tela). */
  function analisarLinhas(linhas, previsao) {
    const dias = Object.keys(previsao).sort();
    const hoje = dias[0], ultimo = dias[dias.length - 1];
    const saida = linhas.map(l => {
      if (l.erros.length) return { ...l, risco: "invalida", motivo: l.erros[0], previsao: null };
      if (l.dataISO < hoje) return { ...l, risco: "passada", motivo: "A data já passou", previsao: null };
      const p = previsao[l.dataISO];
      if (!p) return { ...l, risco: "sem-previsao", motivo: `Fora do alcance da previsão (até ${isoParaBR(ultimo)})`, previsao: null };
      return { ...l, ...classificar(p), previsao: p };
    });
    return saida.sort(   // por data; linhas inválidas por último
      (a, b) => (a.risco === "invalida") - (b.risco === "invalida") || (a.dataISO || "9").localeCompare(b.dataISO || "9") || a.linha - b.linha);
  }

  const ROTULOS = { alto: "Risco alto", moderado: "Atenção", baixo: "Sem risco", "sem-previsao": "Sem previsão", passada: "Passada", invalida: "Corrigir" };

  function contar(lista) {
    const c = { alto: 0, moderado: 0, baixo: 0, "sem-previsao": 0, passada: 0, invalida: 0 };
    lista.forEach(i => c[i.risco]++);
    return c;
  }

  /* Desenha a faixa-resumo e a tabela de resultados (textContent: nada vira HTML) */
  function mostrarResultado(lista) {
    const c = contar(lista);
    const faixa = $("agenda-faixa");
    const partes = [];
    if (c.alto) partes.push(`${c.alto} com risco alto de chuva`);
    if (c.moderado) partes.push(`${c.moderado} em atenção`);
    if (c.baixo) partes.push(`${c.baixo} sem risco`);
    if (c["sem-previsao"] + c.passada) partes.push(`${c["sem-previsao"] + c.passada} sem previsão`);
    if (c.invalida) partes.push(`${c.invalida} para corrigir`);
    faixa.textContent = partes.join(" · ") || "Nenhuma atividade analisada.";
    faixa.className = "agenda-faixa " + (c.alto ? "alto" : c.moderado ? "moderado" : "baixo");

    const corpo = $("agenda-corpo");
    corpo.textContent = "";
    lista.forEach(i => {
      const tr = document.createElement("tr");
      const celula = (txt, classe) => { const td = document.createElement("td"); td.textContent = txt; if (classe) td.className = classe; tr.appendChild(td); return td; };
      celula(i.dataBR);
      celula(i.atividade || "(sem nome)");
      celula(i.responsavel || "-");
      const p = i.previsao;
      celula(p ? `${descreverTempo(p.codigo)}, ${Math.round(p.tmin)}° a ${Math.round(p.tmax)}°` : "-");
      celula(p ? `${p.prob == null ? "-" : Math.round(p.prob) + " %"} · ${(p.mm || 0).toFixed(1).replace(".", ",")} mm` : "-");
      const td = celula("", "agenda-col-risco");
      const selo = document.createElement("span");
      selo.className = "agenda-risco " + i.risco;
      selo.textContent = ROTULOS[i.risco];
      td.appendChild(selo);
      const m = document.createElement("small");
      m.textContent = i.motivo;
      td.appendChild(m);
      corpo.appendChild(tr);
    });
    $("agenda-resultado").classList.remove("oculto");
  }

  function esconderResultado() {
    resultado = [];
    window.Agenda.resultado = resultado;
    const r = $("agenda-resultado");
    if (r) r.classList.add("oculto");
  }

  /* Botão "Analisar clima": lê a tabela, consulta a previsão e mostra o risco de cada atividade */
  async function analisar() {
    const st = $("agenda-analise-status");
    const aviso = (msg, erro) => { st.textContent = msg; st.className = "agenda-status" + (erro ? " erro" : msg ? " ok" : ""); };
    try {
      await montarPlanilha();
      const linhas = lerTabela();
      if (!linhas.length) return aviso("Preencha a tabela antes de analisar.", true);
      if (!linhas.some(l => !l.erros.length)) return aviso("Nenhuma linha válida. Corrija as datas e as atividades.", true);
      aviso("Consultando a previsão na Open-Meteo…");
      const previsao = await buscarPrevisaoDiaria();
      resultado = analisarLinhas(linhas, previsao);
      window.Agenda.resultado = resultado;
      mostrarResultado(resultado);
      aviso("");
      if (localStorage.getItem(CHAVE_AUTO) === "1") {                 // aviso automático (só atividades novas)
        const r = await avisarRiscos(resultado, { apenasNovos: true });
        if (r.enviado) acao(`Alerta enviado ao Telegram (${r.qtd} ${r.qtd === 1 ? "atividade" : "atividades"}).`);
        else if (r.motivo) acao(r.motivo, !/já foram|Nenhuma/.test(r.motivo));
      }
    } catch (e) {
      aviso("Não foi possível analisar: " + e.message, true);
    }
  }

  /* ---------- 7) banco de dados e Telegram (Parte 3) ---------- */
  const MAX_MENSAGEM = 25;            // atividades por mensagem (o Telegram aceita até 4096 caracteres)
  const CHAVE_LOCAL = "agenda_local"; // modo demonstração: a agenda fica só neste navegador
  const CHAVE_ENVIADOS = "agenda_tg_enviados";
  const CHAVE_AUTO = "agenda_tg_auto";

  /* Monta o objeto que vai para o Firebase: { atualizadoEm, itens: { "AAAA-MM-DD-001": {...} } }
     (objeto com chaves, e não lista, porque é o formato natural do Realtime Database) */
  function montarRegistro(lista) {
    const itens = {};
    lista.filter(i => i.risco !== "invalida").forEach((i, n) => {
      const item = { dataISO: i.dataISO, atividade: i.atividade, responsavel: i.responsavel, risco: i.risco, motivo: i.motivo };
      if (i.previsao && i.previsao.prob != null) item.prob = i.previsao.prob;
      if (i.previsao && i.previsao.mm != null) item.mm = i.previsao.mm;
      itens[`${i.dataISO}-${String(n + 1).padStart(3, "0")}`] = item;   // chaves sem ponto, barra ou espaço
    });
    return { atualizadoEm: Date.now(), itens };
  }

  /* Texto do alerta em HTML do Telegram, com uma linha em branco entre as atividades */
  const escHtml = t => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const corta = (t, n) => t.length > n ? t.slice(0, n - 1) + "…" : t;
  function montarMensagemRiscos(lista) {
    const risco = lista.filter(i => i.risco === "alto" || i.risco === "moderado");
    if (!risco.length) return "";
    const blocos = risco.slice(0, MAX_MENSAGEM).map(i =>
      `${i.risco === "alto" ? "🔴" : "🟡"} <b>${i.dataBR} · ${escHtml(corta(i.atividade, 80))}</b>\n`
      + (i.responsavel ? `👤 ${escHtml(corta(i.responsavel, 60))}\n` : "")
      + escHtml(i.motivo));
    if (risco.length > MAX_MENSAGEM) blocos.push(`… e mais ${risco.length - MAX_MENSAGEM}.`);
    return ["🌧 <b>ClimaSense: atividades com risco de chuva</b>", ...blocos].join("\n\n");
  }

  const chaveAviso = i => `${i.dataISO}|${i.atividade}|${i.risco}`;
  function lerEnviados() {
    try { return new Set(JSON.parse(localStorage.getItem(CHAVE_ENVIADOS) || "[]")); } catch (e) { return new Set(); }
  }
  function gravarEnviados(lista) {
    const todos = [...lerEnviados(), ...lista.map(chaveAviso)].slice(-300);   // guarda só os 300 mais recentes
    try { localStorage.setItem(CHAVE_ENVIADOS, JSON.stringify(todos)); } catch (e) { /* sem espaço: tudo bem */ }
  }

  /* Avalia a lista e, havendo risco alto ou atenção, dispara o alerta no Telegram.
     Com { apenasNovos: true } não repete atividades que já foram avisadas.
     Devolve { enviado, qtd, motivo } e nunca lança erro. */
  async function avisarRiscos(lista, opcoes) {
    const risco = lista.filter(i => i.risco === "alto" || i.risco === "moderado");
    if (!risco.length) return { enviado: false, qtd: 0, motivo: "Nenhuma atividade com risco de chuva." };
    if (typeof TG === "undefined" || !TG.token() || !TG.chat()) {
      return { enviado: false, qtd: 0, motivo: "Configure o token e o chat id do Telegram na aba Atividades." };
    }
    let alvo = risco;
    if (opcoes && opcoes.apenasNovos) {
      const ja = lerEnviados();
      alvo = risco.filter(i => !ja.has(chaveAviso(i)));
      if (!alvo.length) return { enviado: false, qtd: 0, motivo: "Todas as atividades com risco já foram avisadas." };
    }
    const ok = await enviarTelegram(montarMensagemRiscos(alvo));      // script.js: POST em api.telegram.org/bot.../sendMessage
    if (!ok) {
      const e = document.getElementById("tg-status");
      return { enviado: false, qtd: 0, motivo: (e && e.textContent) || "Falha ao enviar para o Telegram." };
    }
    gravarEnviados(alvo);
    return { enviado: true, qtd: alvo.length, motivo: "" };
  }

  /* Salva a agenda processada: no Firebase (conta) ou, no modo demonstração, neste navegador */
  async function salvarAgenda() {
    if (typeof estado === "undefined" || !estado.conta) throw new Error("Entre na sua conta (botão Entrar) para salvar a agenda.");
    if (!resultado.length) await analisar();
    const lista = resultado.filter(i => i.risco !== "invalida");
    if (!lista.length) throw new Error("Não há atividades válidas para salvar.");
    const registro = montarRegistro(lista);
    if (modoLocal()) localStorage.setItem(CHAVE_LOCAL, JSON.stringify(registro));
    else await dbUsuario("PUT", "/agenda", registro);                // script.js: Vercel api/usuario -> /usuarios/{uid}/agenda
    return Object.keys(registro.itens).length;
  }

  /* Lê a agenda salva e devolve as linhas [data, atividade, responsável] para a tabela */
  async function carregarAgendaSalva() {
    if (typeof estado === "undefined" || !estado.conta) throw new Error("Entre na sua conta (botão Entrar) para carregar a agenda.");
    let reg;
    if (modoLocal()) { try { reg = JSON.parse(localStorage.getItem(CHAVE_LOCAL) || "null"); } catch (e) { reg = null; } }
    else reg = await dbUsuario("GET", "/agenda");
    if (!reg || !reg.itens) return [];
    return Object.keys(reg.itens).sort().map(k => {
      const i = reg.itens[k];
      return [isoParaBR(i.dataISO), limpar(i.atividade), limpar(i.responsavel)];
    });
  }

  /* ---------- 8) interface ---------- */
  const $ = id => document.getElementById(id);

  function status(msg, erro) {
    const el = $("agenda-status");
    el.textContent = msg;
    el.className = "agenda-status" + (erro ? " erro" : msg ? " ok" : "");
  }

  function acao(msg, erro) {
    const el = $("agenda-acao-status");
    if (!el) return;
    el.textContent = msg;
    el.className = "agenda-status" + (erro ? " erro" : msg ? " ok" : "");
  }

  let _atualizando = false;
  function atualizarResumo() {
    const el = $("agenda-resumo");
    if (!el || !planilha || _atualizando) return;
    _atualizando = true;
    try { desenharResumo(el); } finally { _atualizando = false; }
  }

  function desenharResumo(el) {
    const linhas = lerTabela();
    const ruins = linhas.filter(l => l.erros.length);
    // pinta de vermelho claro a célula da data inválida
    try {
      const dados = planilha.getData();
      const comErro = new Set(ruins.filter(l => !l.dataISO).map(l => l.linha));
      for (let i = 0; i < dados.length; i++) planilha.setStyle("A" + (i + 1), "background-color", comErro.has(i + 1) ? "#fbe9e5" : "");
    } catch (e) { /* o estilo é só um detalhe visual */ }
    if (!linhas.length) { el.textContent = "Nenhum agendamento ainda."; el.className = "agenda-resumo"; return; }
    el.className = "agenda-resumo" + (ruins.length ? " atencao" : "");
    el.textContent = `${linhas.length - ruins.length} de ${linhas.length} agendamentos válidos.`
      + (ruins.length ? ` Corrija: ${ruins.slice(0, 5).map(l => `linha ${l.linha} (${l.erros[0].toLowerCase()})`).join("; ")}${ruins.length > 5 ? "…" : ""}.` : "");
  }

  async function importar(arquivo) {
    status("Lendo " + arquivo.name + "…");
    try {
      const { linhas, avisos } = await lerArquivo(arquivo);
      if (!linhas.length) throw new Error("Não encontrei nenhuma linha com dados nesse arquivo.");
      await montarPlanilha();
      carregarLinhas(linhas);
      status(`${linhas.length} linhas importadas de ${arquivo.name}. ${avisos.join(" ")}`.trim());
    } catch (e) {
      status(e.message, true);
    }
  }

  function baixarModelo() {
    const dia = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${doisDigitos(d.getDate())}/${doisDigitos(d.getMonth() + 1)}/${d.getFullYear()}`; };
    const csv = "\uFEFF" + [
      "Data;Atividade;Responsável",
      `${dia(1)};Aula de educação física;Prof. Marcos`,
      `${dia(2)};Evento ao ar livre;Coordenação`,
      `${dia(3)};Pulverização;Equipe de campo`
    ].join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = "modelo-agenda.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  let _ligado = false;
  function ligarEventos() {
    if (_ligado) return;
    _ligado = true;
    $("agenda-arquivo").addEventListener("change", e => {
      const f = e.target.files[0];
      if (f) importar(f);
      e.target.value = "";                      // permite escolher o mesmo arquivo de novo
    });
    $("agenda-modelo").addEventListener("click", baixarModelo);
    $("agenda-analisar").addEventListener("click", analisar);
    $("agenda-tg-auto").checked = localStorage.getItem(CHAVE_AUTO) === "1";
    $("agenda-tg-auto").addEventListener("change", e => localStorage.setItem(CHAVE_AUTO, e.target.checked ? "1" : "0"));
    $("agenda-salvar").addEventListener("click", async () => {
      acao("Salvando…");
      try {
        const n = await salvarAgenda();
        acao(`${n} ${n === 1 ? "atividade salva" : "atividades salvas"} às ${hhmm(Date.now())}.`);
      } catch (e) { acao(e.message, true); }
    });
    $("agenda-carregar").addEventListener("click", async () => {
      acao("Buscando a agenda salva…");
      try {
        const linhas = await carregarAgendaSalva();
        if (!linhas.length) return acao("Ainda não há agenda salva nesta conta.", true);
        await montarPlanilha();
        carregarLinhas(linhas);
        acao(`${linhas.length} atividades carregadas. Clique em Analisar clima para atualizar o risco.`);
      } catch (e) { acao(e.message, true); }
    });
    $("agenda-telegram").addEventListener("click", async () => {
      try {
        if (!resultado.length) await analisar();
        if (!resultado.length) return acao("Analise o clima antes de avisar.", true);
        acao("Enviando…");
        const r = await avisarRiscos(resultado);                      // botão manual: reenvia mesmo as já avisadas
        if (r.enviado) acao(`Alerta enviado ao Telegram (${r.qtd} ${r.qtd === 1 ? "atividade" : "atividades"}).`);
        else acao(r.motivo, true);
      } catch (e) { acao(e.message, true); }
    });
    $("agenda-criterios").textContent = `Risco alto: chance de chuva ≥ ${RISCO.altoProb} % ou ≥ ${RISCO.altoMm} mm no dia. Atenção: ≥ ${RISCO.modProb} % ou ≥ ${RISCO.modMm} mm, ou chuva no código do tempo.`;
    $("agenda-add").addEventListener("click", async () => {
      try { (await montarPlanilha()).insertRow(); } catch (e) { status(e.message, true); }
    });
    $("agenda-limpar").addEventListener("click", async () => {
      if (!confirm("Limpar toda a tabela?")) return;
      try { await montarPlanilha(); carregarLinhas([]); status(""); } catch (e) { status(e.message, true); }
    });
  }

  /* Chamada quando a aba Agenda abre (ver irParaAba em script.js) */
  async function iniciarAgenda() {
    ligarEventos();
    try { await montarPlanilha(); }
    catch (e) { status(e.message, true); }
  }

  window.Agenda = { normalizarData, isoParaBR, parseCSV, matrizParaLinhas, lerArquivo, lerTabela, carregarLinhas, montarPlanilha,
                    classificar, analisarLinhas, buscarPrevisaoDiaria, analisar, resultado,
                    montarRegistro, montarMensagemRiscos, avisarRiscos, salvarAgenda, carregarAgendaSalva };
  window.iniciarAgenda = iniciarAgenda;

  // se a página abriu direto em #agenda
  if (typeof document !== "undefined") {
    const secao = document.getElementById("agenda");
    if (secao && secao.classList.contains("ativa")) iniciarAgenda();
  }
})();