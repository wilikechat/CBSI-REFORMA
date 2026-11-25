export class UpstreamError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = "UpstreamError";
    this.status = status;
  }
}

const PASSTHROUGH_HEADERS = [
  "content-type",
  "content-disposition",
  "x-warning-dados-simulados",
];

async function readBody(req, limitBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) {
      throw new UpstreamError("Corpo da requisição excede o limite permitido", 413);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function forward(upstreamUrl, req, { method, headers, body, requestTimeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("Tempo limite ao chamar o serviço de origem")),
    requestTimeoutMs
  );
  let response;
  try {
    response = await fetch(upstreamUrl, {
      method,
      headers,
      body: method === "GET" || method === "HEAD" ? undefined : body,
      signal: controller.signal,
      redirect: "manual",
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new UpstreamError(`Tempo limite ao chamar ${upstreamUrl}`, 504);
    }
    throw new UpstreamError(`Serviço de origem indisponível: ${upstreamUrl}`, 502);
  } finally {
    clearTimeout(timer);
  }

  const payload = Buffer.from(await response.arrayBuffer());
  return {
    status: response.status,
    headers: response.headers,
    payload,
  };
}

export function createProxy(config) {
  const headerFilter = (upstreamHeaders) => {
    const out = {};
    for (const name of PASSTHROUGH_HEADERS) {
      const value = upstreamHeaders.get?.(name);
      if (value) out[name] = value;
    }
    return out;
  };

  async function send(res, result) {
    const headers = headerFilter(result.headers);
    res.writeHead(result.status, headers);
    res.end(result.payload);
  }

  async function proxy(req, res, targetUrl, { method = req.method, forwarded = true } = {}) {
    const headers = {};
    const incomingType = req.headers["content-type"];
    if (incomingType) headers["content-type"] = incomingType;
    headers.accept = req.headers.accept ?? "application/json";
    if (forwarded) headers["x-forwarded-by"] = "cbsi-gateway";

    const body =
      method === "GET" || method === "HEAD"
        ? undefined
        : await readBody(req, config.bodyLimitBytes);

    if (body) headers["content-length"] = Buffer.byteLength(body).toString();

    const result = await forward(targetUrl, req, {
      method,
      headers,
      body,
      requestTimeoutMs: config.requestTimeoutMs,
    });
    await send(res, result);
    return result;
  }

  return { proxy, send };
}

export { readBody, forward };
