"use strict";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ---------------------------------------------------------------- utils ----

async function apiGet(path) {
  const resposta = await fetch(path, { headers: { accept: "application/json" } });
  const texto = await resposta.text();
  let dados = null;
  try { dados = JSON.parse(texto); } catch { /* não-JSON */ }
  if (!resposta.ok) {
    throw new Error(dados?.erro || dados?.mensagem || `HTTP ${resposta.status}: ${texto.slice(0, 200)}`);
  }
  return { resposta, dados };
}

async function apiPost(path, corpo, contentType = "application/json") {
  const resposta = await fetch(path, {
    method: "POST",
    headers: { "content-type": contentType, accept: "*/*" },
    body: typeof corpo === "string" ? corpo : JSON.stringify(corpo),
  });
  const texto = await resposta.text();
  const tipo = resposta.headers.get("content-type") ?? "";
  if (tipo.includes("json")) {
    let dados = null;
    try { dados = JSON.parse(texto); } catch { /* não-JSON */ }
    if (!resposta.ok) {
      throw new Error(dados?.erro || dados?.mensagem || `HTTP ${resposta.status}`);
    }
    return { resposta, dados };
  }
  if (!resposta.ok) {
    throw new Error(`HTTP ${resposta.status}: ${texto.slice(0, 200)}`);
  }
  return { resposta, blob: new Blob([texto], { type: tipo || "application/octet-stream" }) };
}

function num(valor) {
  if (valor === null || valor === undefined || valor === "") return undefined;
  const n = Number(valor);
  return Number.isFinite(n) ? n : undefined;
}

function fmt(valor) {
  if (valor === null || valor === undefined) return "";
  if (typeof valor === "number") {
    return valor.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 8 });
  }
  if (typeof valor === "string" && /^-?\d+([.,]\d+)?$/.test(valor)) {
    return valor;
  }
  return String(valor);
}

function el(tag, atributos = {}, texto = "") {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(atributos)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  if (texto) e.textContent = texto;
  return e;
}

function caixaErro(onde, mensagem) {
  const alvo = $(onde);
  alvo.prepend(el("div", { class: "caixa-erro" }, `⚠ ${mensagem}`));
}

const BADGES = {
  CALCULADO: "badge-calc",
  CALCULO_SIMULADO: "badge-simulado",
  INCONSISTENCIA_ENTRADA: "badge-erro",
  NAO_IMPLEMENTADO: "badge-cinza",
  FALHA_TECNICA: "badge-erro",
};

function badgeEstado(estado) {
  return el("span", { class: `badge ${BADGES[estado] ?? "badge-cinza"}` }, estado || "SEM_ESTADO");
}

const UFS = ["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"];

// ------------------------------------------------------- tabs / status ----

function trocarAba(id) {
  $$("#menu button").forEach((b) => b.classList.toggle("ativo", b.dataset.aba === id));
  $$(".aba").forEach((s) => s.classList.toggle("ativa", s.id === `aba-${id}`));
}

$$("#menu button").forEach((b) => b.addEventListener("click", () => trocarAba(b.dataset.aba)));
$$("[data-ir]").forEach((b) => b.addEventListener("click", () => trocarAba(b.dataset.ir)));

async function atualizarStatus() {
  const area = $("#status-rapido");
  try {
    const { dados } = await apiGet("/api/health");
    const classes = { ok: "dot-ok", degradado: "dot-degradado", indisponivel: "dot-indisponivel" };
    area.innerHTML = "";
    area.appendChild(el("span", { class: `dot ${classes[dados.geral] ?? "dot-desconhecido"}` }));
    area.appendChild(document.createTextNode(
      dados.geral === "ok" ? "Serviços OK" : dados.geral === "degradado" ? "Parcial" : "Indisponível"
    ));
    const painel = $("#painel-health");
    painel.innerHTML = "";
    const nomeTitulo = {
      "regime-regular": "Calculadora — Regime Geral",
      "simples-nacional": "Calculadora — Simples Nacional",
      danfse: "Gerador DANFSe",
    };
    for (const [nome, info] of Object.entries(dados.servicos)) {
      const card = el("article", { class: "card" });
      const dot = { ok: "dot-ok", degradado: "dot-degradado", indisponivel: "dot-indisponivel" }[info.status] ?? "dot-desconhecido";
      card.appendChild(el("div", { class: "status" }, nomeTitulo[nome] ?? nome));
      const linha = el("div", {}, "");
      linha.style.display = "flex";
      linha.style.alignItems = "center";
      linha.style.gap = "8px";
      linha.appendChild(el("span", { class: `dot ${dot}` }));
      linha.appendChild(el("strong", {}, info.status === "ok" ? "Operacional" : info.status));
      card.appendChild(linha);
      if (info.resposta?.app?.version ?? info.resposta?.info?.app?.version) {
        card.appendChild(el("p", {}, `Versão: ${info.resposta.app.version}`));
      } else if (info.resposta?.status) {
        card.appendChild(el("p", {}, `Resposta: ${JSON.stringify(info.resposta.status)}`));
      }
      if (info.erro) card.appendChild(el("p", {}, info.erro));
      painel.appendChild(card);
    }
  } catch (erro) {
    area.innerHTML = "";
    area.appendChild(el("span", { class: "dot dot-indisponivel" }));
    area.appendChild(document.createTextNode("Gateway offline"));
    $("#painel-health").innerHTML = "";
    $("#painel-health").appendChild(el("div", { class: "caixa-erro" }, `⚠ ${erro.message}`));
  }
}

// ------------------------------------------- builder de operação (itens) ----

function construirFormOperacao(SeletorContainer, { seletivo = false, aliquotas = false } = {}) {
  const container = typeof SeletorContainer === "string" ? $(SeletorContainer) : SeletorContainer;
  container.innerHTML = "";

  const dados = el("div", { class: "grade-form" });
  const camposOperacao = {};
  const linhaOp = (rotulo, input) => {
    const l = el("label", {}, rotulo);
    l.appendChild(input);
    dados.appendChild(l);
  };

  const inId = el("input", { type: "text", placeholder: "opcional" });
  const inVersao = el("input", { type: "text", value: "1.0.0" });
  const inDh = el("input", { type: "datetime-local", value: "2027-03-10T10:00" });
  const inUf = el("select", {});
  for (const uf of UFS) inUf.appendChild(new Option(uf, uf));
  inUf.value = "RS";
  const inMun = el("input", { type: "number", value: "4314902", placeholder: "Código IBGE" });
  camposOperacao.id = inId; camposOperacao.versao = inVersao; camposOperacao.dh = inDh; camposOperacao.uf = inUf; camposOperacao.municipio = inMun;
  linhaOp("Identificador da operação", inId);
  linhaOp("Versão do documento", inVersao);
  linhaOp("Data/hora do fato gerador", inDh);
  linhaOp("UF", inUf);
  linhaOp("Município (IBGE)", inMun);
  container.appendChild(dados);

  const lista = el("div");
  container.appendChild(lista);

  const btnAdd = el("button", { type: "button" }, "+ Adicionar item");
  btnAdd.addEventListener("click", () => adicionarItem());
  container.appendChild(btnAdd);

  function camposItem(itemCard, is) {
    const campos = el("div", { class: "campos" });
    const add = (rotulo, input) => {
      const l = el("label", {}, rotulo);
      l.appendChild(input);
      campos.appendChild(l);
      return input;
    };
    const c = {};
    c.tipoLista = add("Produto/Serviço por", (() => {
      const s = el("select", {});
      s.appendChild(new Option("NCM", "ncm"));
      s.appendChild(new Option("NBS", "nbs"));
      s.addEventListener("change", () => (c.codigo.placeholder = s.value === "ncm" ? "10063021" : "122011200"));
      return s;
    })());
    c.codigo = add("Código NCM/NBS", el("input", { type: "text", value: "10063021" }));
    c.cst = add("CST", el("input", { type: "text", value: "200" }));
    c.cClassTrib = add("cClassTrib", el("input", { type: "text", value: "200003" }));
    c.baseCalculo = add("Base de cálculo (R$)", el("input", { type: "number", step: "0.01", min: "0", value: "100.00" }));
    c.quantidade = add("Quantidade", el("input", { type: "number", step: "0.0001", min: "0", value: "20" }));
    c.unidade = add("Unidade", el("input", { type: "text", value: "KG" }));
    if (aliquotas) {
      c.alqCbs = add("Alíq. CBS (%)", el("input", { type: "number", step: "0.01", value: "8.8" }));
      c.alqIbsEst = add("Alíq. IBS UF (%)", el("input", { type: "number", step: "0.0001", value: "0.05" }));
      c.alqIbsMun = add("Alíq. IBS Mun (%)", el("input", { type: "number", step: "0.0001", value: "0.05" }));
    }
    itemCard.appendChild(campos);
    if (seletivo) {
      const bloco = el("div", { class: `is ${is.ativo ? "" : "fechado"}` });
      const titulo = el("div", { class: "titulo" }, "▢ Imposto Seletivo (opcional)");
      const camposIs = el("div", { class: "campos oculto" });
      const addIs = (rotulo, input) => {
        const l = el("label", {}, rotulo);
        l.appendChild(input);
        camposIs.appendChild(l);
        return input;
      };
      c.isBase = addIs("Base IS (R$)", el("input", { type: "number", step: "0.01", value: "150.00" }));
      c.isQuantidade = addIs("Quantidade", el("input", { type: "number", step: "0.0001", value: "12" }));
      c.isUnidade = addIs("Unidade", el("input", { type: "text", value: "LT" }));
      c.isInformado = addIs("Imposto informado (R$)", el("input", { type: "number", step: "0.01", value: "15.00" }));
      c.isAdvalorem = addIs("IS ad valorem (%)", el("input", { type: "number", step: "0.01", value: "10.0" }));
      titulo.addEventListener("click", () => camposIs.classList.toggle("oculto"));
      bloco.appendChild(titulo);
      bloco.appendChild(camposIs);
      itemCard.appendChild(bloco);
    }
    return c;
  }

  function adicionarItem(dadosIniciais = null, is = { ativo: !!dadosIniciais?.impostoSeletivo }) {
    const n = lista.children.length + 1;
    const card = el("div", { class: "card-item" });
    const cab = el("div", { class: "cabecalho" });
    cab.appendChild(el("strong", {}, `Item ${n}`));
    const btnRem = el("button", { type: "button", class: "perigo" }, "Remover");
    btnRem.addEventListener("click", () => { card.remove(); renumerar(); });
    cab.appendChild(btnRem);
    card.appendChild(cab);

    const c = camposItem(card, is);
    if (dadosIniciais) {
      c.tipoLista.value = dadosIniciais.ncm ? "ncm" : "nbs";
      c.codigo.value = dadosIniciais.ncm ?? dadosIniciais.nbs ?? c.codigo.value;
      c.codigo.placeholder = c.tipoLista.value;
      c.cst.value = dadosIniciais.cst ?? "200";
      c.cClassTrib.value = dadosIniciais.cClassTrib ?? "";
      c.baseCalculo.value = dadosIniciais.baseCalculo ?? "";
      c.quantidade.value = dadosIniciais.quantidade ?? "";
      c.unidade.value = dadosIniciais.unidade ?? "";
      if (aliquotas && dadosIniciais.aliquotasNominais) {
        c.alqCbs.value = dadosIniciais.aliquotasNominais.cbs ?? "8.8";
        c.alqIbsEst.value = dadosIniciais.aliquotasNominais.ibsEstadual ?? "0.05";
        c.alqIbsMun.value = dadosIniciais.aliquotasNominais.ibsMunicipal ?? "0.05";
      }
      if (dadosIniciais.impostoSeletivo) {
        c.isBase.value = dadosIniciais.impostoSeletivo.baseCalculo ?? "";
        c.isQuantidade.value = dadosIniciais.impostoSeletivo.quantidade ?? "";
        c.isUnidade.value = dadosIniciais.impostoSeletivo.unidade ?? "";
        c.isInformado.value = dadosIniciais.impostoSeletivo.impostoInformado ?? "";
        c.isAdvalorem.value = dadosIniciais.impostoSeletivo.impostoSelecionado ?? dadosIniciais.impostoSeletivo.adValorem ?? "";
      }
    }
    card._campos = c;
    lista.appendChild(card);
  }

  function renumerar() {
    [...lista.children].forEach((card, i) => {
      card.querySelector(".cabecalho strong").textContent = `Item ${i + 1}`;
    });
  }

  return {
    construirOperacao() {
      const operacao = {
        id: inId.value || undefined,
        versao: inVersao.value || "1.0.0",
        dhFatoGerador: inDh.value ? `${inDh.value}:00-03:00` : undefined,
        uf: inUf.value,
        municipio: num(inMun.value),
        itens: [...lista.children].map((card, i) => {
          const c = card._campos;
          const item = {
            numero: i + 1,
            baseCalculo: num(c.baseCalculo.value),
            cst: c.cst.value || undefined,
            cClassTrib: c.cClassTrib.value || undefined,
            quantidade: num(c.quantidade.value),
            unidade: c.unidade.value || undefined,
          };
          item[c.tipoLista.value] = c.codigo.value || undefined;
          if (aliquotas) {
            const alq = {
              cbs: num(c.alqCbs.value),
              ibsEstadual: num(c.alqIbsEst.value),
              ibsMunicipal: num(c.alqIbsMun.value),
            };
            if (alq.cbs !== undefined || alq.ibsEstadual !== undefined || alq.ibsMunicipal !== undefined) {
              item.aliquotasNominais = alq;
            }
          }
          if (seletivo) {
            const ativo = c.isBase.value !== "" || c.isInformado.value !== "" || c.isAdvalorem.value !== "";
            if (ativo) {
              item.impostoSeletivo = {
                cst: c.cst.value || "000",
                cClassTrib: c.cClassTrib.value || "000001",
                baseCalculo: num(c.isBase.value),
                quantidade: num(c.isQuantidade.value),
                unidade: c.isUnidade.value || undefined,
              };
              if (c.isInformado.value !== "") item.impostoSeletivo.impostoInformado = num(c.isInformado.value);
              if (c.isAdvalorem.value !== "") {
                item.aliquotasNominais = item.aliquotasNominais ?? {};
                item.aliquotasNominais.impostoSeletivo = { adValorem: num(c.isAdvalorem.value) };
              }
            }
          }
          return item;
        }),
      };
      return operacao;
    },
    limpar() {
      lista.innerHTML = "";
      adicionarItem();
    },
    adicionarItens(itens) {
      lista.innerHTML = "";
      for (const item of itens ?? []) adicionarItem(item);
      if (!lista.children.length) adicionarItem();
    },
    get quantidadeItens() { return lista.children.length; },
    get temItens() { return lista.children.length > 0; },
  };
}

// ------------------------------------------------------------ resultados ----

function buscarValores(obj, chaves, achados = {}) {
  if (!obj || typeof obj !== "object") return achados;
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === "object") buscarValores(v, chaves, achados);
    else if (chaves.includes(k) && achados[k] === undefined) achados[k] = v;
  }
  return achados;
}

function arvoreNivel(pai, obj, profundidade, prefixo = "") {
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === "object") {
      const d = el("details", {});
      if (profundidade < 2) d.open = true;
      d.appendChild(el("summary", {}, `${prefixo}${k}`));
      arvoreNivel(d, v, profundidade + 1);
      pai.appendChild(d);
    } else {
      const folha = el("div", { class: "folha" });
      folha.appendChild(el("span", { class: "chave" }, `${k}`));
      folha.appendChild(el("span", { class: "valor" }, `${fmt(v)}`));
      pai.appendChild(folha);
    }
  }
}

function renderArvore(obj) {
  const raiz = el("div", { class: "arvore" });
  arvoreNivel(raiz, obj, 0);
  return raiz;
}

function cardTotais(de, chaves) {
  const achados = buscarValores(de, chaves);
  if (!Object.keys(achados).length) return null;
  const box = el("div", { class: "totais" });
  const rotulos = { vBC: "Base de cálculo", vCBS: "CBS", vIBS: "IBS", vIBSUF: "IBS UF", vIBSMun: "IBS Município", vIS: "Imposto Seletivo", vBCIBSCBS: "Base CBS/IBS" };
  for (const k of chaves) {
    if (achados[k] === undefined) continue;
    const t = el("div", { class: "total" });
    t.appendChild(el("div", { class: "rotulo" }, rotulos[k] ?? k));
    t.appendChild(el("div", { class: "valor" }, fmt(achados[k])));
    box.appendChild(t);
  }
  return box;
}

function renderResultadoObservabilidade(alvo, dados) {
  alvo.innerHTML = "";
  const bloco = el("div", { class: "resultado-bloco" });

  const objetos = dados?.objetos ?? [];
  if (!objetos.length) {
    bloco.appendChild(el("p", {}, "Resposta sem objetos calculados."));
    alvo.appendChild(bloco);
    return;
  }

  const totais = dados?.total?.tribCalc;
  const boxTotais = cardTotais(totais, ["vBCIBSCBS", "vIS", "vIBS", "vCBS"]);
  if (boxTotais) {
    bloco.appendChild(el("h3", {}, "Totais (somente itens calculados)"));
    bloco.appendChild(boxTotais);
    bloco.appendChild(renderArvore(totais ?? {}));
  }

  bloco.appendChild(el("h3", {}, "Itens"));
  for (const objeto of objetos) {
    const card = el("div", { class: "card-item" });
    const cab = el("div", { class: "cabecalho" });
    cab.appendChild(el("strong", {}, `Item ${objeto.nObj ?? objeto.numeroItem ?? "?"}`));
    cab.appendChild(badgeEstado(objeto.estadoItem));
    card.appendChild(cab);

    if (Array.isArray(objeto.erros) && objeto.erros.length) {
      for (const erro of objeto.erros) {
        card.appendChild(el(
          "div",
          { class: "caixa-erro" },
          `${erro.code ?? ""} — ${erro.title ?? erro.detail ?? "erro"}\n${erro.detail ?? ""}${erro.pointer ? `\nLocal: ${erro.pointer}` : ""}`
        ));
      }
    }

    if (objeto.tribCalc && Object.keys(objeto.tribCalc).length) {
      const chave = ["vCBS", "vIBS", "vIS", "vBC"];
      const mini = cardTotais(objeto.tribCalc, chave);
      if (mini) card.appendChild(mini);
      card.appendChild(renderArvore(objeto.tribCalc));
    } else if (!objeto.erros?.length) {
      card.appendChild(el("p", { class: "hint" }, "Nenhum resultado de cálculo para este item."));
    }
    bloco.appendChild(card);
  }

  alvo.appendChild(bloco);
}

const EXEMPLO_REGIME = {
  id: "6194602ea71cbf9431c236de4409d920",
  versao: "1.0.0",
  dhFatoGerador: "2027-03-10T10:00:00-03:00",
  municipio: 4314902,
  uf: "RS",
  itens: [
    { numero: 1, ncm: "10063021", cst: "200", cClassTrib: "200003", baseCalculo: 100.0, quantidade: 20, unidade: "KG", aliquotasNominais: { cbs: 8.8, ibsEstadual: 0.05, ibsMunicipal: 0.05 } },
    { numero: 2, ncm: "22030000", cst: "000", cClassTrib: "000001", quantidade: 12, unidade: "LT", impostoSeletivo: { cst: "000", cClassTrib: "000001", baseCalculo: 150.0, quantidade: 12, unidade: "LT", impostoInformado: 15.0 }, aliquotasNominais: { cbs: 8.8, ibsEstadual: 0.05, ibsMunicipal: 0.05, impostoSeletivo: { adValorem: 10.0 } } },
    { numero: 3, nbs: "122011200", cst: "200", cClassTrib: "200028", baseCalculo: 1200.0, aliquotasNominais: { cbs: 8.8, ibsEstadual: 0.05, ibsMunicipal: 0.05 } },
    { numero: 4, ncm: "02013000", cst: "200", cClassTrib: "200035", baseCalculo: 80.0, aliquotasNominais: { cbs: 8.8, ibsEstadual: 0.05, ibsMunicipal: 0.05 } },
  ],
};

// ---------------------------------------------------------- regime geral ----

const formRegime = construirFormOperacao("#regime-formulario", { seletivo: true, aliquotas: true });
formRegime.adicionarItens(EXEMPLO_REGIME.itens);

$("#regime-carregar-exemplo").addEventListener("click", () => {
  formRegime.adicionarItens(EXEMPLO_REGIME.itens);
  $("#regime-resultado").innerHTML = "";
});

$("#regime-modo-json").addEventListener("change", (e) => {
  const manual = e.target.checked;
  $("#regime-formulario").classList.toggle("oculto", manual);
  $("#regime-json-lote").classList.toggle("oculto", !manual);
  if (manual && !$("#regime-json").value) {
    $("#regime-json").value = JSON.stringify(EXEMPLO_REGIME, null, 2);
  }
});

$("#regime-calcular").addEventListener("click", async (e) => {
  const botao = e.target;
  const alvo = $("#regime-resultado");
  botao.disabled = true;
  alvo.innerHTML = "";
  const modo = $("#regime-modo-json").checked ? "estrito" : "observabilidade";
  try {
    let corpo;
    if ($("#regime-modo-json").checked) {
      corpo = JSON.parse($("#regime-json").value);
      const { resposta, dados } = await apiPost(`/api/calculo/regime-geral?modo=observabilidade`, corpo);
      renderResultadoObservabilidade(alvo, dados);
    } else {
      const operacao = formRegime.construirOperacao();
      if (!formRegime.temItens) throw new Error("Adicione pelo menos um item à operação.");
      const { dados } = await apiPost(`/api/calculo/regime-geral?modo=${modo}`, operacao);
      renderResultadoObservabilidade(alvo, dados);
    }
  } catch (erro) {
    caixaErro("#regime-resultado", erro.message);
  } finally {
    botao.disabled = false;
  }
});

// -------------------------------------------------------- simples nacional ----

const formSimples = construirFormOperacao("#simples-formulario", { seletivo: false, aliquotas: false });
formSimples.adicionarItens(EXEMPLO_REGIME.itens.filter((i) => !i.impostoSeletivo).map(({ aliquotasNominais: _a, ...resto }) => resto));

$("#simples-carregar-exemplo").addEventListener("click", () => {
  formSimples.adicionarItens(EXEMPLO_REGIME.itens.filter((i) => !i.impostoSeletivo).map(({ aliquotasNominais: _a, ...resto }) => resto));
  $("#simples-resultado").innerHTML = "";
});

$("#simples-calcular").addEventListener("click", async (e) => {
  const botao = e.target;
  const alvo = $("#simples-resultado");
  botao.disabled = true;
  alvo.innerHTML = "";
  try {
    if (!formSimples.temItens) throw new Error("Adicione pelo menos um item à operação.");
    const { dados } = await apiPost("/api/calculo/simples-nacional", formSimples.construirOperacao());
    renderResultadoObservabilidade(alvo, dados);
  } catch (erro) {
    caixaErro("#simples-resultado", erro.message);
  } finally {
    botao.disabled = false;
  }
});

$("#simples-consultar-atividades").addEventListener("click", () => {
  $("#simples-atividades").classList.toggle("oculto");
});

$("#simples-buscar-atividades").addEventListener("click", async () => {
  const alvo = $("#simples-atividades-resultado");
  alvo.innerHTML = "";
  try {
    const params = new URLSearchParams();
    if ($("#simples-data").value) params.set("data", $("#simples-data").value);
    if ($("#simples-filtro-anexo").value) params.set("anexo", $("#simples-filtro-anexo").value);
    const { dados } = await apiGet(`/api/simples/atividades?${params}`);
    const lista = Array.isArray(dados) ? dados : dados?.atividades ?? dados?.conteudo ?? [];
    const tabela = el("table", { class: "tabela" });
    const thead = el("thead");
    const headRow = el("tr");
    const colunas = Object.keys(lista[0] ?? { codigo: "" });
    for (const c of colunas) headRow.appendChild(el("th", {}, c));
    thead.appendChild(headRow);
    tabela.appendChild(thead);
    const tbody = el("tbody");
    for (const atividade of lista.slice(0, 200)) {
      const tr = el("tr");
      for (const c of colunas) {
        const v = atividade[c];
        tr.appendChild(el("td", {}, typeof v === "object" ? JSON.stringify(v) : fmt(v)));
      }
      tbody.appendChild(tr);
    }
    tabela.appendChild(tbody);
    const bloco = el("div", { class: "resultado-bloco" });
    bloco.appendChild(el("p", { class: "hint" }, `${lista.length} atividade(s) — mostrando até 200.`));
    bloco.appendChild(tabela);
    alvo.appendChild(bloco);
  } catch (erro) {
    caixaErro("#simples-atividades-resultado", erro.message);
  }
});

// ---------------------------------------------------------- base unificada ----

$("#base-calcular").addEventListener("click", async () => {
  const alvo = $("#base-resultado");
  alvo.innerHTML = "";
  try {
    const tipoDoc = $("#base-tipo-doc").value;
    const selecao = tipoDoc === "nfse" ? "nfse" : "nfe";
    const corpo = {
      anoFatoGerador: num($("#base-ano").value),
      tipoDocumento: tipoDoc === "nfse" ? undefined : tipoDoc === "nfce" ? 65 : 55,
      natureza: $("#base-natureza").value,
    };
    const nomesCampos = ["vProd", "vFrete", "vSeg", "vOutro", "vDesc", "vIS", "vPIS", "vCOFINS", "vICMS", "vFCP"];
    const inputsValores = $$("#base-form input[type=number]").filter((i) => i.id !== "base-ano");
    nomesCampos.forEach((nome, i) => {
      if (inputsValores[i] !== undefined) corpo[nome] = num(inputsValores[i].value) ?? 0;
    });
    if (corpo.tipoDocumento === undefined) delete corpo.tipoDocumento;

    const { dados } = await apiPost(`/api/calculo/base-unificada?tipo=${selecao}`, corpo);
    const bloco = el("div", { class: "resultado-bloco" });
    bloco.appendChild(el("h3", {}, "Bases calculadas"));
    const box = el("div", { class: "totais" });
    const nomes = { baseRG: "Base regime geral", baseIS: "Base Imposto Seletivo", baseSN: "Base Simples Nacional" };
    for (const [k, rotulo] of Object.entries(nomes)) {
      if (dados?.[k] === undefined) continue;
      const t = el("div", { class: "total" });
      t.appendChild(el("div", { class: "rotulo" }, rotulo));
      t.appendChild(el("div", { class: "valor" }, fmt(dados[k])));
      box.appendChild(t);
    }
    bloco.appendChild(box);
    for (const aviso of dados?.avisos ?? []) bloco.appendChild(el("div", { class: "caixa-aviso" }, `ℹ ${aviso}`));
    alvo.appendChild(bloco);
  } catch (erro) {
    caixaErro("#base-resultado", erro.message);
  }
});

// ------------------------------------------------------------ dados abertos ----

{
  const selUf = $("#lista-uf");
  for (const uf of UFS) selUf.appendChild(new Option(uf, uf));
}

$("#dados-consultar").addEventListener("click", async () => {
  const alvo = $("#dados-resultado");
  alvo.innerHTML = "";
  try {
    const [caminho, campos] = $("#dados-endpoint").value.split(" | ");
    const precisos = campos.split(",");
    const codigo = $("#dados-codigo").value.trim();
    let caminhoFinal = caminho;
    if (caminho.includes("*codigo")) {
      if (!codigo) throw new Error("Informe o código da classificação tributária (cClassTrib).");
      caminhoFinal = caminho.replace("*codigo", encodeURIComponent(codigo));
    }
    const params = new URLSearchParams();
    if (precisos.includes("data") && $("#dados-data").value) params.set("data", $("#dados-data").value);
    if (precisos.includes("codigo") && codigo) params.set("codigo", codigo);
    if (precisos.includes("uf") && $("#dados-uf").value) params.set("uf", $("#dados-uf").value.toUpperCase());
    if (precisos.includes("codigoIbge") && $("#dados-ibge").value) params.set("codigoIbge", $("#dados-ibge").value);
    const qs = params.toString();
    const { dados } = await apiGet(`/api/dados-abertos/${caminhoFinal}${qs ? `?${qs}` : ""}`);
    const bloco = el("div", { class: "resultado-bloco" });
    const totais = Array.isArray(dados) ? dados.length : Object.keys(dados ?? {}).length;
    bloco.appendChild(el("p", { class: "hint" }, `GET /api/dados-abertos/${caminhoFinal}${qs ? `?${qs}` : ""} — ${totais} registro(s)`));
    const pre = el("pre", { class: "bloco-codigo" });
    pre.textContent = JSON.stringify(dados, null, 2);
    bloco.appendChild(pre);
    alvo.appendChild(bloco);
  } catch (erro) {
    caixaErro("#dados-resultado", erro.message);
  }
});

// ---------------------------------------------------------------- da nfse ----

$("#danfse-arquivo").addEventListener("change", (e) => {
  const arquivo = e.target.files?.[0];
  if (!arquivo) return;
  const leitor = new FileReader();
  leitor.onload = () => { $("#danfse-xml").value = leitor.result; };
  leitor.readAsText(arquivo, "utf-8");
});

$("#danfse-gerar").addEventListener("click", async (e) => {
  const botao = e.target;
  const alvo = $("#danfse-resultado");
  botao.disabled = true;
  $("#danfse-download").classList.add("oculto");
  alvo.innerHTML = "";
  try {
    const xml = $("#danfse-xml").value.trim();
    if (!xml.startsWith("<?xml") && !xml.startsWith("<NFSe")) {
      throw new Error("Cole o XML da NFS-e (deve começar com <?xml ou <NFSe).");
    }
    const params = new URLSearchParams({ stc: $("#danfse-stc").value, canhoto: String($("#danfse-canhoto").checked) });
    const { resposta, blob } = await apiPost(`/api/danfse?${params}`, xml, "application/xml");
    const url = URL.createObjectURL(blob);
    const download = $("#danfse-download");
    download.href = url;
    download.classList.remove("oculto");
    const pre = el("embed", { type: "application/pdf", src: url });
    pre.style.width = "100%";
    pre.style.height = "640px";
    const bloco = el("div", { class: "resultado-bloco" });
    bloco.appendChild(el("p", { class: "hint" }, `PDF recebido (${(blob.size / 1024).toFixed(1)} KiB, HTTP ${resposta.status}). Pré-visualização abaixo; use o botão para baixar.`));
    bloco.appendChild(pre);
    alvo.appendChild(bloco);
  } catch (erro) {
    caixaErro("#danfse-resultado", erro.message);
  } finally {
    botao.disabled = false;
  }
});

// ------------------------------------------------------------------ boot ----

atualizarStatus();
setInterval(atualizarStatus, 30000);
