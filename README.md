# Plataforma CBS/IBS — Reforma Tributária (LC 214/2025)

Plataforma completa que **unifica as três calculadoras oficiais da Receita Federal** para a Reforma Tributária do Consumo em um único ponto de acesso:

| Componente | Repositório oficial | Papel na plataforma |
|---|---|---|
| Calculadora — Regime Geral | [ReceitaFederal/calculadora-rtc-regime-regular](https://github.com/ReceitaFederal/calculadora-rtc-regime-regular) | Cálculo de **CBS, IBS e Imposto Seletivo** (regime geral), base de cálculo unificada, dados abertos |
| Calculadora — Simples Nacional | [ReceitaFederal/calculadora-rtc-simples-nacional](https://github.com/ReceitaFederal/calculadora-rtc-simples-nacional) | Cálculo de **CBS e IBS no Simples Nacional** e consulta de atividades |
| Gerador DANFSe | [ReceitaFederal/calculadora-rtc-gerador-danfse](https://github.com/ReceitaFederal/calculadora-rtc-gerador-danfse) | Geração do **DANFSe em PDF** a partir do XML de uma NFS-e |

A plataforma adiciona:

- **`gateway/`** — API gateway Node.js (zero dependências) que expõe **uma API única** sobre os três serviços: cálculo unificado por regime, erros dos dois regimes em um endpoint só, dados abertos, DANFSe e check de saúde agregado.
- **`web/`** — interface web completa: calculadoras com formulário *ou* JSON, consulta de atividades, dados abertos, emissor de DANFSe com pré-visualização do PDF e painel de status.
- **`docker-compose.yml`** — orquestra tudo: constrói os serviços oficiais direto dos repositórios da Receita Federal (gerando o banco SQLite de dados abertos via Flyway *dentro* da imagem) e conecta ao gateway.

```
                                       ┌────────────────────────┐
   navegadores  ──►  :8085  ──►        │  gateway (Node 22)     │
                                       └───┬─────────┬──────┬───┘
               /api/calculo/regime-geral   │         │      │  /api/danfse
                           ┌───────────────┘         │      └─────────────┐
                   ┌───────▼────────┐   ┌────────────▼───────┐   ┌─────────▼────────┐
                   │ regime-regular │   │ simples-nacional   │   │ danfse (Go)      │
                   │ Java/Spring    │   │ Java/Spring        │   │ POST /api/danfse │
                   │ :8080 /api     │   │ :8082 /api         │   │ → PDF            │
                   └───────┬────────┘   └────────┬───────────┘   └──────────────────┘
                           └── SQLite oficial (dados abertos) gerado via Flyway ──┘
```

---

## Requisitos

- **Docker + Docker Compose v2.17+** (necessário para `dockerfile_inline`, usado para construir os serviços Java a partir dos repositórios oficiais)
- ~8 GB de RAM livres para os builds Java (Maven)
- Acesso à internet (Maven Wrapper, módulos Go e clonagem dos repositórios oficiais)

## Subir a plataforma

```bash
git clone https://github.com/wilikechat/CBSI-REFORMA.git
cd CBSI-REFORMA
cp .env.example .env          # opcional: ajuste a porta
docker compose up --build -d
```

O primeiro `up` leva alguns minutos (compila os dois serviços Java e gera o banco de dados). Ao terminar:

- **Interface web:** http://localhost:8085/
- **API do gateway:** `GET http://localhost:8085/api/health`

> A porta só é publicada em `127.0.0.1` por padrão. Para expor na rede local, ajuste `ports:` no `docker-compose.yml`.

## Sem Docker (modo nativo)

Siga a documentação de cada serviço oficial (Java 25; gere o banco com `./mvnw flyway:migrate -Dflyway.configFiles=./flyway/flyway-pro.conf` e rode com `./mvnw spring-boot:run -Dspring-boot.run.profiles=offline`) e aponte o gateway para eles:

```bash
REGIME_URL=http://localhost:8080/api \
SIMPLES_URL=http://localhost:8082/api \
DANFSE_URL=http://localhost:8080/api \
node gateway/src/server.js
```

---

## API do gateway

| Método | Endpoint | Descrição |
|---|---|---|
| GET | `/api/health` | Status agregado dos três serviços |
| POST | `/api/calculo` | Cálculo unificado — campo `regime`: `"regime-geral"` ou `"simples-nacional"` |
| POST | `/api/calculo/regime-geral?modo=observabilidade\|estrito` | CBS/IBS/IS do regime geral; `estrito` rejeita a operação inteira no primeiro erro (HTTP 422) |
| POST | `/api/calculo/simples-nacional` | CBS/IBS do Simples Nacional (observabilidade por item) |
| POST | `/api/calculo/base-unificada?tipo=nfe\|nfse` | Base de cálculo unificada NF-e/NFC-e ou NFS-e |
| GET | `/api/calculo/erros?codigo=REG-011` ou `VSN-001` | Descrição de código de erro dos dois regimes em um endpoint só |
| GET | `/api/simples/atividades?data=AAAA-MM-DD` (e `/{codigo}`) | Atividades do Simples vigentes |
| GET | `/api/versao` | Versão da aplicação Simples Nacional e da base de dados |
| GET | `/api/dados-abertos/ncm`, `/nbs`, `/situacoes-tributarias/cbs-ibs`, `/classificacoes-tributarias/cbs-ibs/class-trib/{codigo}`, `/fundamentacoes-legais`, `/aliquota-uniao`, `/aliquota-uf`, `/aliquota-municipio` | Dados abertos oficiais |
| POST | `/api/danfse?stc=0\|1\|2&canhoto=true\|false` | DANFSe em PDF (corpo: XML bruto da NFS-e, `Content-Type: application/xml`) |
| ANY | `/api/upstream/{regime\|simples\|danfse}/…` | Passagem direta parametrizada a qualquer caminho de um serviço integrado |

Exemplo rápido:

```bash
curl -s http://localhost:8085/api/calculo/regime-geral \
  -H 'Content-Type: application/json' -d @operacao.json | jq
```

Corpo de exemplo da operação e detalhes dos contratos em [docs/ARQUITETURA.md](docs/ARQUITETURA.md).

## Segurança

- Whitelist de dados abertos limita o proxy aos endpoints oficiais de leitura.
- Limite de tamanho de corpo (padrão 10 MiB) e tempo limite por chamada upstream.
- Porta publicada apenas em loopback por padrão; CORS configurável por `CORS_ORIGIN`.

## Créditos e avisos

Os três serviços integrados são de autoria da [Receita Federal do Brasil](https://github.com/ReceitaFederal); esta plataforma apenas os orquestra e adiciona gateway + interface web. Consulte os termos de uso/licença em cada repositório oficial antes do uso em produção.

**Aviso:** ferramenta de apoio — não substitui as fontes oficiais nem a legislação (LC 214/2025).
