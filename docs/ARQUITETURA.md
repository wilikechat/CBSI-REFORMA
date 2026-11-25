# Arquitetura da Plataforma CBS/IBS

## Componentes

### 1. Gateway (`gateway/`)

API Node.js 22 (ESM, **zero dependências externas**) que publica uma API única sob `/api/…`:

- **Roteamento semântico** — cada rota sabe qual serviço oficial atende:
  - `regime-regular` (Java/Spring, porta 8080, caminhos sob `/api/calculadora/…`);
  - `simples-nacional` (Java/Spring, porta 8082);
  - `danfse` (Go, porta 8080, caminhos `/api/danfse` e `/api/health/*`).
- **Cálculo unificado** (`POST /api/calculo`): lê o campo `regime` do corpo e despacha para a API do regime correspondente, mantendo o contrato oficial da Receita Federal intacto.
- **Erros unificados** (`GET /api/calculo/erros`): prefixo `REG-…` vai ao Regime Geral, `VSN-…` ao Simples Nacional.
- **DANFSe** (`POST /api/danfse`): repassa o XML bruto (`application/xml`) e devolve `application/pdf` com o cabeçalho `Content-Disposition`.
- **Dados abertos com whitelist**: só deixa passar os endpoints de leitura oficiais (`ncm`, `nbs`, `situacoes-tributarias/cbs-ibs`, `classificacoes-tributarias/cbs-ibs/**`, `fundamentacoes-legais`, `aliquota-uniao`, `aliquota-uf`, `aliquota-municipio`).
- **Saúde agregada** (`GET /api/health`): sonda `v3/api-docs` do Regime Geral, `/versao` do Simples e `/health/live` do DANFSe; retorna `ok` / `degradado` / `indisponivel`.
- **Passagem direta parametrizada** (`/api/upstream/{servico}/…`) para qualquer caminho de qualquer serviço integrado.
- Limites de corpo (10 MiB padrão), tempo limite por chamada upstream, CORS configurável e cabeçalhos úteis repassados (`x-warning-dados-simulados`, `content-disposition`).

### 2. Interface web (`web/public/`)

Aplicação SPA em HTML/CSS/JS puro servida pelo próprio gateway:

| Aba | Consumo |
|---|---|
| Início | `GET /api/health` (atualizado a cada 30s) |
| Calculadora — Regime Geral | `POST /api/calculo/regime-geral` (modo observabilidade ou estrito; formulário com itens dinâmicos, Imposto Seletivo opcional, alíquotas nominais, **ou** edição direta de JSON) |
| Calculadora — Simples Nacional | `POST /api/calculo/simples-nacional`; consulta de atividades `GET /api/simples/atividades` |
| Base de Cálculo Unificada | `POST /api/calculo/base-unificada` (NF-e, NFC-e ou NFS-e) |
| Dados Abertos | `GET /api/dados-abertos/…` com seletores de consulta |
| Emissor DANFSe | `POST /api/danfse` com XML colado ou arquivo; pré-visualização do PDF embutida |

Resultados de cálculo são renderizados com badge por `estadoItem` (`CALCULADO`, `CALCULO_SIMULADO`, `INCONSISTENCIA_ENTRADA`, …), árvore de `tribCalc` navegável e totais destacados.

### 3. Orquestração (`docker-compose.yml`)

- `gateway` — construído deste repositório (`gateway/Dockerfile`, Node 22 Alpine).
- `regime-regular` e `simples-nacional` — construídos **direto dos repositórios oficiais** via `build.context` Git com `dockerfile_inline`: multistage `eclipse-temurin:25-jdk` → `mvnw package -DskipTests` → migração Flyway que gera o banco SQLite oficial `calculadora/db/calculadora-pro.db` dentro da imagem → runtime JRE rodando o jar com `--spring.profiles.active=offline`. O Simples Nacional copia a pasta `flyway/` do repositório de regime geral, como exige sua documentação.
- `danfse` — usa o `Dockerfile` oficial do repositório Go.
- Rede interna: o gateway fala com os serviços por hostname (ex.: `http://regime-regular:8080/api`).

## Contrato de operação (Regime Geral)

Exemplo da documentação oficial (4 itens: cesta básica com redução, cerveja com IS, serviço de educação e um item com erro proposital):

```json
{
  "id": "6194602ea71cbf9431c236de4409d920",
  "versao": "1.0.0",
  "dhFatoGerador": "2027-03-10T10:00:00-03:00",
  "municipio": 4314902,
  "uf": "RS",
  "itens": [
    {
      "numero": 1, "ncm": "10063021", "cst": "200", "cClassTrib": "200003",
      "baseCalculo": 100.00, "quantidade": 20, "unidade": "KG",
      "aliquotasNominais": { "cbs": 8.8, "ibsEstadual": 0.05, "ibsMunicipal": 0.05 }
    },
    {
      "numero": 2, "ncm": "22030000", "cst": "000", "cClassTrib": "000001",
      "quantidade": 12, "unidade": "LT",
      "impostoSeletivo": {
        "cst": "000", "cClassTrib": "000001", "baseCalculo": 150.00,
        "quantidade": 12, "unidade": "LT", "impostoInformado": 15.00
      },
      "aliquotasNominais": {
        "cbs": 8.8, "ibsEstadual": 0.05, "ibsMunicipal": 0.05,
        "impostoSeletivo": { "adValorem": 10.0 }
      }
    }
  ]
}
```

Observações importantes mantidas pela plataforma:

- A resposta da API de observabilidade vem com HTTP 200 **mesmo com itens em erro** — a interface marca cada item pelo `estadoItem`.
- Os totais somam apenas os itens calculados.
- A partir de 2027 `aliquotasNominais` é obrigatório; antes disso é proibido (cálculos saem como `CALCULO_SIMULADO`).
- No modo estrito (`POST /regime-geral`), a operação inteira falha com HTTP 422 no primeiro erro.

## Fluxo de uma chamada de cálculo

1. O usuário preenche o formulário (ou cola JSON) na interface.
2. A interface envia `POST /api/calculo/regime-geral` ao gateway.
3. O gateway encaminha à API oficial com o contrato original.
4. A resposta (por item, com memória de cálculo e erros por `code`) volta transparente; o gateway só repassa cabeçalhos úteis.
5. A interface destaca estados, totais e erros por item.
