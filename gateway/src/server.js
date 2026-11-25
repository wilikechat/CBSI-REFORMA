import http from "node:http";
import { existsSync, statSync, createReadStream } from "node:fs";
import path from "node:path";
import config from "./config.js";
import { createProxy, UpstreamError, readBody, forward } from "./proxy.js";

const { proxy, send } = createProxy(config);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

function json(res, status, data, extraHeaders = {}) {
  const body = Buffer.from(JSON.stringify(data, null, 2), "utf8");
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": body.length,
    ...extraHeaders,
  });
  res.end(body);
}

function baseHeaders(res) {
  res.setHeader("access-control-allow-origin", config.corsOrigin);
  res.setHeader(
    "access-control-allow-methods",
    "GET, POST, PUT, PATCH, DELETE, OPTIONS"
  );
  res.setHeader("access-control-allow-headers", "content-type, accept");
}

function searchParams(url) {
  return url.search || "";
}

async function health() {
  const check = async (name, url) => {
    try {
      const result = await forward(url, null, {
        method: "GET",
        headers: { accept: "application/json" },
        body: undefined,
        requestTimeoutMs: 5000,
      });
      let details;
      if (result.headers.get("content-type")?.includes("application/json")) {
        try {
          details = JSON.parse(result.payload.toString("utf8"));
        } catch {
          details = undefined;
        }
      }
      return { servico: name, status: result.status >= 200 && result.status < 500 ? "ok" : "degradado", resposta: details };
    } catch (error) {
      return { servico: name, status: "indisponivel", erro: error.message };
    }
  };

  const [regime, simples, danfse] = await Promise.all([
    check("regime-regular", `${config.regimeBase}/v3/api-docs`),
    check("simples-nacional", `${config.upstreams.simples}/versao`),
    check("danfse", `${config.danfseBase}/health/live`),
  ]);

  const statuses = [regime, simples, danfse].map((c) => c.status);
  const geral = statuses.every((s) => s === "ok") ? "ok" : statuses.some((s) => s === "ok") ? "degradado" : "indisponivel";
  return {
    geral,
    gateway: "ok",
    servicos: { "regime-regular": regime, "simples-nacional": simples, danfse },
  };
}

const DADOS_ABERTOS_PREFIX = "/api/dados-abertos/";

const DADOS_ABERTOS_WHITELIST = [
  "situacoes-tributarias/cbs-ibs",
  "classificacoes-tributarias/cbs-ibs",
  "fundamentacoes-legais",
  "ncm",
  "nbs",
  "aliquota-uniao",
  "aliquota-uf",
  "aliquota-municipio",
];

function isDadosAbertosRest(rest) {
  return DADOS_ABERTOS_WHITELIST.some(
    (allowed) => rest === allowed || rest.startsWith(`${allowed}/`)
  );
}

async function route(req, res) {
  const url = new URL(req.url, "http://gateway.local");
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    json(res, 400, { erro: "URL malformada" });
    return;
  }
  const method = req.method.toUpperCase();

  baseHeaders(res);

  if (method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (method === "GET" && pathname === "/api/health") {
    json(res, 200, await health());
    return;
  }

  if (pathname === "/api/calculo/regime-geral") {
    if (method !== "POST") return json(res, 405, { erro: "Use POST" });
    const modo = url.searchParams.get("modo") ?? "observabilidade";
    const target =
      modo === "estrito"
        ? `${config.regimeBase}/regime-geral`
        : `${config.regimeBase}/observabilidade/regime-geral`;
    await proxy(req, res, target);
    return;
  }

  if (pathname === "/api/calculo/simples-nacional") {
    if (method !== "POST") return json(res, 405, { erro: "Use POST" });
    await proxy(req, res, `${config.simplesBase}/observabilidade/simples-nacional`);
    return;
  }

  if (pathname === "/api/calculo") {
    if (method !== "POST") return json(res, 405, { erro: "Use POST" });
    const body = await readBody(req, config.bodyLimitBytes);
    let operacao;
    try {
      operacao = JSON.parse(body.toString("utf8"));
    } catch {
      return json(res, 400, { erro: "Corpo deve ser um JSON válido" });
    }
    const target = operacao?.regime === "simples-nacional"
      ? `${config.simplesBase}/observabilidade/simples-nacional`
      : operacao?.regime === "regime-geral"
        ? `${config.regimeBase}/observabilidade/regime-geral`
        : null;
    if (!target) {
      return json(res, 400, {
        erro: "Campo 'regime' ausente ou inválido (use 'regime-geral' ou 'simples-nacional')",
      });
    }
    const result = await forward(target, req, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-by": "cbsi-gateway" },
      body,
      requestTimeoutMs: config.requestTimeoutMs,
    });
    await send(res, result);
    return;
  }

  if (pathname === "/api/calculo/base-unificada") {
    const tipo = url.searchParams.get("tipo") ?? "nfe";
    if (!["nfe", "nfse"].includes(tipo)) {
      return json(res, 400, { erro: "Parâmetro 'tipo' aceita 'nfe' ou 'nfse'" });
    }
    if (method !== "POST") return json(res, 405, { erro: "Use POST" });
    const sufixo = tipo === "nfse" ? "base-calculo-unificada-nfse" : "base-calculo-unificada";
    await proxy(req, res, `${config.regimeBase}/base-calculo/${sufixo}`);
    return;
  }

  if (pathname === "/api/calculo/erros") {
    if (method !== "GET") return json(res, 405, { erro: "Use GET" });
    const codigo = url.searchParams.get("codigo") ?? "";
    const isSimples = codigo.startsWith("VSN-");
    const isRegime = codigo.startsWith("REG-");
    if (!codigo || (!isSimples && !isRegime)) {
      return json(res, 400, {
        erro: "Informe o parâmetro 'codigo' com prefixo REG- (regime geral) ou VSN- (simples nacional)",
      });
    }
    const target = isSimples
      ? `${config.simplesBase}/observabilidade/simples-nacional/erros?codigo=${encodeURIComponent(codigo)}`
      : `${config.regimeBase}/observabilidade/erros?codigo=${encodeURIComponent(codigo)}`;
    await proxy(req, res, target);
    return;
  }

  if (pathname === "/api/simples/atividades") {
    if (method !== "GET") return json(res, 405, { erro: "Use GET" });
    await proxy(req, res, `${config.simplesBase}/simples-nacional/atividades${searchParams(url)}`);
    return;
  }

  const atividadeMatch = pathname.match(/^\/api\/simples\/atividades\/([^/]+)$/);
  if (atividadeMatch) {
    if (method !== "GET") return json(res, 405, { erro: "Use GET" });
    await proxy(
      req,
      res,
      `${config.simplesBase}/simples-nacional/atividades/${encodeURIComponent(atividadeMatch[1])}${searchParams(url)}`
    );
    return;
  }

  if (pathname === "/api/versao") {
    await proxy(req, res, `${config.upstreams.simples}/versao`);
    return;
  }

  if (pathname.startsWith(DADOS_ABERTOS_PREFIX)) {
    if (method !== "GET") return json(res, 405, { erro: "Use GET" });
    const rest = pathname.slice(DADOS_ABERTOS_PREFIX.length);
    if (!rest || !isDadosAbertosRest(rest)) {
      return json(res, 404, { erro: "Endpoint de dados abertos não suportado" });
    }
    await proxy(req, res, `${config.regimeBase}/dados-abertos/${rest}${searchParams(url)}`);
    return;
  }

  if (pathname === "/api/danfse") {
    if (method !== "POST") return json(res, 405, { erro: "Use POST com o XML da NFS-e no corpo" });
    const query = searchParams(url);
    const result = await forward(`${config.danfseBase}/danfse${query}`, req, {
      method: "POST",
      headers: {
        "content-type": req.headers["content-type"] ?? "application/xml",
        "x-forwarded-by": "cbsi-gateway",
      },
      body: await readBody(req, config.bodyLimitBytes),
      requestTimeoutMs: config.requestTimeoutMs,
    });
    await send(res, result);
    return;
  }

  const upstreamMatch = pathname.match(/^\/api\/upstream\/(regime|simples|danfse)\/(.+)$/);
  if (upstreamMatch) {
    const [, service, rest] = upstreamMatch;
    const bases = {
      regime: config.upstreams.regime,
      simples: config.upstreams.simples,
      danfse: config.upstreams.danfse,
    };
    await proxy(req, res, `${bases[service]}/${rest}${searchParams(url)}`);
    return;
  }

  if (pathname.startsWith("/api/")) {
    json(res, 404, { erro: "Endpoint não encontrado no gateway" });
    return;
  }

  serveStatic(res, pathname);
}

function serveStatic(res, pathname) {
  const dist = path.resolve(config.webDist);
  let filePath = path.join(dist, pathname === "/" ? "index.html" : pathname);
  filePath = path.resolve(filePath);
  if (!filePath.startsWith(dist)) {
    json(res, 403, { erro: "Acesso negado" });
    return;
  }
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = path.join(dist, "index.html");
  }
  if (!existsSync(filePath)) {
    json(res, 404, { erro: "Interface web não encontrada" });
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    "content-type": MIME[ext] ?? "application/octet-stream",
    "cache-control": "no-store",
  });
  createReadStream(filePath).pipe(res);
}

const server = http.createServer((req, res) => {
  route(req, res).catch((error) => {
    const status = error instanceof UpstreamError ? error.status : 500;
    const message =
      error instanceof UpstreamError
        ? error.message
        : "Erro interno do gateway";
    if (!res.headersSent) {
      json(res, status, { erro: message });
    } else {
      res.end();
    }
  });
});

server.listen(config.port, config.host, () => {
  console.log(`[cbsi-gateway] listening on ${config.host}:${config.port}`);
  console.log(`[cbsi-gateway] regime=${config.upstreams.regime} simples=${config.upstreams.simples} danfse=${config.upstreams.danfse}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
