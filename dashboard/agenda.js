"use strict";

/* =====================================================================
   ClimaSense: aba Agenda (Parte 1: importar e editar a planilha)

   - SheetJS (xlsx) lê arquivos .xlsx e .xls. O .csv é lido aqui mesmo,
     porque o CSV brasileiro costuma vir com ";" e em Windows-1252.
   - Jspreadsheet CE mostra a planilha editável (digitar ou colar do Excel).
   - As bibliotecas só são baixadas quando a aba Agenda é aberta.

   Entrada da Parte 2: window.Agenda.lerTabela()
   -> [{ linha, dataISO, dataBR, atividade, responsavel, erros: [] }]
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

  let planilha = null;      // instância do Jspreadsheet
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
          onafterchanges: () => setTimeout(atualizarResumo, 0),
          oninsertrow: () => setTimeout(atualizarResumo, 0),
          ondeleterow: () => setTimeout(atualizarResumo, 0)
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

  /* ---------- 6) interface ---------- */
  const $ = id => document.getElementById(id);

  function status(msg, erro) {
    const el = $("agenda-status");
    el.textContent = msg;
    el.className = "agenda-status" + (erro ? " erro" : msg ? " ok" : "");
  }

  function atualizarResumo() {
    const el = $("agenda-resumo");
    if (!el || !planilha) return;
    const linhas = lerTabela();
    const ruins = linhas.filter(l => l.erros.length);
    // pinta de vermelho claro a célula da data inválida
    try {
      const dados = planilha.getData();
      const comErro = new Set(ruins.filter(l => !l.dataISO).map(l => l.linha));
      for (let i = 0; i < dados.length; i++) planilha.setStyle("A" + (i + 1), "background-color", comErro.has(i + 1) ? "#fbe9e5" : "");
    } catch (e) { /* o estilo é só um detalhe visual */ }
    if (!linhas.length) { el.textContent = "Nenhum agendamento ainda."; el.className = "agenda-resumo"; return; }
    el.className = "agenda-resumo" + (ruins.length ? " aviso" : "");
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

  window.Agenda = { normalizarData, isoParaBR, parseCSV, matrizParaLinhas, lerArquivo, lerTabela, carregarLinhas, montarPlanilha };
  window.iniciarAgenda = iniciarAgenda;

  // se a página abriu direto em #agenda
  if (typeof document !== "undefined") {
    const secao = document.getElementById("agenda");
    if (secao && secao.classList.contains("ativa")) iniciarAgenda();
  }
})();