# diretorio-ldap-api

[![CI](https://github.com/sidsidoso/diretorio-ldap-api/actions/workflows/ci.yml/badge.svg)](https://github.com/sidsidoso/diretorio-ldap-api/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.12-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Licença: MIT](https://img.shields.io/badge/licen%C3%A7a-MIT-blue.svg)](LICENSE)

API REST em Node.js + Express, **protegida por JWT**, para consultar um **diretório LDAP** corporativo: buscar usuários por nome e departamento com **paginação**, ver detalhes de um usuário, listar **grupos** e seus **membros** e **exportar a busca para Excel (.xlsx)** em streaming com ExcelJS.

Inclui um **servidor LDAP fake em memória** (22 usuários, 6 grupos) para rodar a demo e os testes sem um diretório real. Os tokens aceitos são compatíveis com os emitidos pelo projeto [login-ldap-jwt](https://github.com/sidsidoso/login-ldap-jwt).

## Tecnologias

- [Node.js](https://nodejs.org/) ≥ 20.12 (ES Modules, `node:test`, `fetch` nativo)
- [Express 5](https://expressjs.com/)
- [ldapjs 3.0.7](https://github.com/ldapjs/node-ldapjs) — cliente e servidor LDAP
- [jsonwebtoken](https://github.com/auth0/node-jsonwebtoken) — verificação de JWT (HS256)
- [ExcelJS 4.4.0](https://github.com/exceljs/exceljs) — geração de `.xlsx` via `stream.xlsx.WorkbookWriter`

## Arquitetura

```
 Cliente                       API (Express)                               Diretório LDAP
 ───────                       ─────────────                               ──────────────
 GET /usuarios?nome=ana ──▶ exigirToken (HS256, iss, aud, exp)
 Authorization: Bearer          │
                                ├─ valida query (nome, departamento, pagina, limite)
                                ├─ monta filtro com valores escapados (RFC 4515)
                                │     (&(objectClass=inetOrgPerson)(|(cn=*ana*)(uid=*ana*)))
                                ├─ conexão persistente (bind da conta de serviço,
                                │   feito uma vez e compartilhado) ── search ──▶  entradas
                                ├─ ordena (pt-BR) e pagina
 ◀── { total, itens, ... } ─────┘

 GET /usuarios/exportar ──▶ exigirPapel(admin|rh) ─▶ busca ─▶ ExcelJS WorkbookWriter
 ◀── .xlsx (Transfer-Encoding: chunked) ◀── linhas commitadas direto na resposta
```

Camadas: `rotas` (HTTP e validação) → `servicos` (`diretorio.js` com as consultas, `exportacao.js` com a planilha, `ldap.js` com os helpers do ldapjs) e `middlewares` (JWT, papéis, erros). O `src/app.js` recebe a configuração e o serviço de diretório por **injeção de dependências**.

## Endpoints

Todos, exceto `/saude`, exigem `Authorization: Bearer <jwt>`.

| Método | Rota                       | Parâmetros                                    | Descrição                                          |
|--------|----------------------------|-----------------------------------------------|----------------------------------------------------|
| GET    | `/saude`                   | —                                             | Verificação de saúde (pública)                     |
| GET    | `/usuarios`                | `nome`, `departamento`, `pagina` (1), `limite` (20, máx. 100) | Busca paginada de usuários       |
| GET    | `/usuarios/:uid`           | —                                             | Detalhes de um usuário, com grupos                 |
| GET    | `/usuarios/exportar`       | `nome`, `departamento`                        | Exporta a busca para `.xlsx` (papel `admin` ou `rh`) |
| GET    | `/grupos`                  | —                                             | Lista grupos com descrição e total de membros      |
| GET    | `/grupos/:cn/membros`      | —                                             | Membros de um grupo                                |

`nome` faz busca parcial em `cn` e `uid` (sem diferenciar maiúsculas); `departamento` compara o atributo `departmentNumber`. Erros em JSON: `400`, `401`, `403`, `404`, `503` (LDAP indisponível).

### A planilha exportada

- Aba **Usuarios**: colunas Usuário, Nome, E-mail, Cargo, Departamento e Telefone;
- cabeçalho estilizado (negrito, fonte branca, fundo azul `#1F4E78`), **autofiltro** em todo o intervalo e **linha 1 congelada**;
- **larguras automáticas** (maior conteúdo da coluna + folga, entre 8 e 60);
- aba **Filtros** com data de geração, filtros usados e total de linhas.

## Exemplos (saídas reais)

Gere um token de demonstração (usa o `JWT_SEGREDO` do `.env`):

```bash
TOKEN=$(npm run -s token -- ana.souza admin,usuario)
```

Busca paginada por departamento:

```bash
curl -s "http://localhost:3001/usuarios?departamento=TI&pagina=1&limite=3" -H "Authorization: Bearer $TOKEN"
```

```json
{
  "pagina": 1,
  "limite": 3,
  "total": 6,
  "totalPaginas": 2,
  "truncado": false,
  "itens": [
    { "uid": "ana.souza", "nome": "Ana Souza", "email": "ana.souza@empresa.local", "cargo": "Gerente de TI", "departamento": "TI", "telefone": "+55 11 3000-1000" },
    { "uid": "diego.ferreira", "nome": "Diego Ferreira", "email": "diego.ferreira@empresa.local", "cargo": "Desenvolvedor", "departamento": "TI", "telefone": "+55 11 3000-1021" },
    { "uid": "gabriela.alves", "nome": "Gabriela Alves", "email": "gabriela.alves@empresa.local", "cargo": "Analista de Suporte", "departamento": "TI", "telefone": "+55 11 3000-1042" }
  ]
}
```

Busca por nome (`?nome=ana`, itens resumidos aos nomes):

```json
{"pagina":1,"limite":20,"total":3,"totalPaginas":1,"truncado":false,"itens":["Ana Souza","Mariana Teixeira","Tatiana Moreira"]}
```

Detalhes de um usuário:

```bash
curl -s http://localhost:3001/usuarios/isabela.ribeiro -H "Authorization: Bearer $TOKEN"
```

```json
{
  "uid": "isabela.ribeiro",
  "nome": "Isabela Ribeiro",
  "email": "isabela.ribeiro@empresa.local",
  "cargo": "Gerente de RH",
  "departamento": "RH",
  "telefone": "+55 11 3000-1056",
  "grupos": ["colaboradores", "gestores", "rh"]
}
```

Grupos e membros:

```bash
curl -s http://localhost:3001/grupos -H "Authorization: Bearer $TOKEN"
```

```json
{
  "total": 6,
  "itens": [
    { "cn": "colaboradores", "descricao": "Todos os colaboradores", "totalMembros": 22 },
    { "cn": "comercial", "descricao": "Equipe comercial", "totalMembros": 5 },
    { "cn": "financeiro", "descricao": "Equipe financeira", "totalMembros": 4 },
    { "cn": "gestores", "descricao": "Gestores e coordenadores", "totalMembros": 5 },
    { "cn": "rh", "descricao": "Recursos Humanos", "totalMembros": 3 },
    { "cn": "ti-admins", "descricao": "Administradores de TI", "totalMembros": 3 }
  ]
}
```

```bash
curl -s http://localhost:3001/grupos/rh/membros -H "Authorization: Bearer $TOKEN"
```

```json
{
  "cn": "rh",
  "descricao": "Recursos Humanos",
  "total": 3,
  "membros": [
    { "uid": "carla.mendes", "nome": "Carla Mendes", "email": "carla.mendes@empresa.local", "cargo": "Analista de RH", "departamento": "RH", "telefone": "+55 11 3000-1014" },
    { "uid": "isabela.ribeiro", "nome": "Isabela Ribeiro", "email": "isabela.ribeiro@empresa.local", "cargo": "Gerente de RH", "departamento": "RH", "telefone": "+55 11 3000-1056" },
    { "uid": "olivia.cardoso", "nome": "Olívia Cardoso", "email": "olivia.cardoso@empresa.local", "cargo": "Assistente de RH", "departamento": "RH", "telefone": "+55 11 3000-1098" }
  ]
}
```

Exportação para Excel:

```bash
curl -s -o usuarios-ti.xlsx -D - "http://localhost:3001/usuarios/exportar?departamento=TI" -H "Authorization: Bearer $TOKEN"
```

```
HTTP/1.1 200 OK
Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
Content-Disposition: attachment; filename="usuarios-2026-11-05.xlsx"
Transfer-Encoding: chunked
```

Sem o papel exigido, ou sem token:

```bash
curl -s -i http://localhost:3001/usuarios/exportar -H "Authorization: Bearer $TOKEN_SO_USUARIO"
# HTTP/1.1 403 Forbidden
# {"erro":"Acesso negado para o seu perfil"}

curl -s http://localhost:3001/usuarios
# {"erro":"Token ausente"}
```

> No Windows (PowerShell), use `curl.exe` (e não o alias `curl`) ou `Invoke-RestMethod`, por exemplo:
> `$TOKEN = npm run -s token -- ana.souza admin; Invoke-RestMethod http://localhost:3001/grupos -Headers @{ Authorization = "Bearer $TOKEN" }`

## Decisões de implementação, otimizações e segurança

- **Conexão LDAP persistente e compartilhada:** o bind da conta de serviço é feito uma vez; as requisições seguintes reaproveitam o mesmo socket (o LDAP multiplexa operações por `messageID`). Se a conexão cair, ela é descartada e recriada na próxima consulta, com uma nova tentativa automática. No desligamento (`SIGINT`/`SIGTERM`) é feito `unbind`. Há um teste que confirma que nenhuma conexão nova é aberta entre requisições.
- **Membros de grupo em uma única busca** usando `(memberOf=<DN do grupo>)`, em vez de uma consulta por membro.
- **Escape de filtros (RFC 4515)** em todo valor vindo do cliente: `*` vira `\2a`, então `?nome=*` não lista o diretório inteiro. Parâmetros também têm validação de formato e tamanho.
- **Limites:** `sizeLimit` (padrão 1000, `LDAP_LIMITE_RESULTADOS`) e `timeLimit` nas buscas, timeouts de conexão e de operação; quando o limite é atingido a resposta indica `"truncado": true`. `limite` de paginação vai até 100.
- **Exportação em streaming:** `ExcelJS.stream.xlsx.WorkbookWriter` escreve direto na resposta HTTP (`Transfer-Encoding: chunked`), cada linha é `commit()`ada assim que é escrita e as strings vão inline (`useSharedStrings: false`), reduzindo o uso de memória. Como no streaming o `<cols>` é gravado no início do XML, as larguras são calculadas antes, a partir dos dados já obtidos.
- **JWT:** `HS256` fixado na verificação (bloqueia `alg: none`), `iss`/`aud` conferidos, segredo de 32+ caracteres por variável de ambiente; exportação restrita por papel (`PAPEIS_EXPORTACAO`).
- **Express endurecido:** `x-powered-by` desabilitado, `express.json({ limit: '100kb' })`, 404 e erros centralizados em JSON; se um erro ocorrer no meio de um download, a conexão é encerrada em vez de enviar um JSON corrompido.
- Paginação feita na API após ordenar os resultados (ordem estável entre páginas). Para diretórios muito grandes, o próximo passo seria usar o controle *Simple Paged Results* (RFC 2696) ou VLV no servidor.

## Como rodar

Pré-requisitos: Node.js 20.12 ou superior e npm.

```bash
git clone https://github.com/sidsidoso/diretorio-ldap-api.git
cd diretorio-ldap-api
npm install
```

Crie o `.env` a partir do exemplo (carregado automaticamente pelo `server.js` e pelo gerador de token):

```bash
cp .env.example .env              # Linux/macOS
```

```powershell
Copy-Item .env.example .env       # Windows (PowerShell)
```

Em dois terminais:

```bash
npm run ldap:fake    # terminal 1: LDAP fake em ldap://127.0.0.1:1389
npm start            # terminal 2: API em http://localhost:3001
```

`npm run dev` reinicia a API ao salvar (`node --watch`). Para gerar tokens de teste: `npm run token -- <usuario> <papel1,papel2>`.

Para usar um diretório real, ajuste `LDAP_URL` (prefira `ldaps://`), as bases e a conta de serviço. Para aceitar os tokens do **login-ldap-jwt**, use o mesmo `JWT_SEGREDO`, `JWT_EMISSOR` e `JWT_AUDIENCIA` nos dois serviços.

| Variável                 | Padrão                                            | Descrição                               |
|--------------------------|---------------------------------------------------|-----------------------------------------|
| `PORTA`                  | `3001`                                            | Porta HTTP                              |
| `LDAP_URL`               | `ldap://127.0.0.1:1389`                           | URL do servidor LDAP                    |
| `LDAP_BASE_USUARIOS`     | `ou=usuarios,dc=empresa,dc=local`                 | Base de usuários                        |
| `LDAP_BASE_GRUPOS`       | `ou=grupos,dc=empresa,dc=local`                   | Base de grupos                          |
| `LDAP_BIND_DN`           | `cn=svc-diretorio,ou=servicos,dc=empresa,dc=local`| Conta de serviço (somente leitura)      |
| `LDAP_BIND_SENHA`        | —                                                 | Senha da conta de serviço (obrigatória) |
| `LDAP_TIMEOUT_MS`        | `5000`                                            | Timeout de conexão e operações          |
| `LDAP_LIMITE_RESULTADOS` | `1000`                                            | `sizeLimit` das buscas                  |
| `JWT_SEGREDO`            | —                                                 | Segredo HS256 (≥ 32 caracteres)         |
| `JWT_EMISSOR` / `JWT_AUDIENCIA` | `login-ldap-jwt` / `apis-internas`         | `iss` e `aud` esperados                 |
| `PAPEIS_EXPORTACAO`      | `admin,rh`                                        | Papéis que podem exportar               |

## Testes

```bash
npm test
```

Os testes usam `node:test`, `node:assert/strict` e `fetch`; sobem o LDAP fake e a API em **portas aleatórias (porta 0)** e funcionam igual no Windows, Linux e macOS. A planilha exportada é **reaberta com ExcelJS** para conferir cabeçalho, estilos, valores, autofiltro, linha congelada e larguras.

```
ℹ tests 18
ℹ suites 3
ℹ pass 18
ℹ fail 0
```

## Estrutura de pastas

```
diretorio-ldap-api/
├── .github/workflows/ci.yml       # CI: Node 20 e 22
├── scripts/
│   ├── servidor-ldap-fake.js      # LDAP em memória (demo/testes)
│   └── gerar-token.js             # JWT de demonstração
├── src/
│   ├── app.js                     # monta o Express (injeção de dependências)
│   ├── server.js                  # ponto de entrada (carrega .env, encerramento gracioso)
│   ├── config.js                  # variáveis de ambiente
│   ├── middlewares/
│   │   ├── autenticacao.js        # exigirToken e exigirPapel
│   │   └── erros.js               # ErroHttp, 404 e tratador central
│   ├── rotas/
│   │   ├── grupos.js
│   │   └── usuarios.js            # busca, detalhes e exportação
│   └── servicos/
│       ├── diretorio.js           # consultas + conexão persistente
│       ├── exportacao.js          # planilha em streaming (ExcelJS)
│       └── ldap.js                # helpers do ldapjs (Promises, escape, unbind)
├── tests/
│   ├── api.test.js
│   └── unitarios.test.js
├── .env.example
└── LICENSE
```

## Observações

- O pacote **`ldapjs` foi descontinuado pelos mantenedores** (o npm o marca como *deprecated*). Foi usado aqui por oferecer cliente **e** servidor LDAP, o que viabiliza o servidor fake. Para projetos novos em produção, considere o [`ldapts`](https://github.com/ldapts/ldapts) como cliente.
- O `exceljs@4.4.0` depende de uma versão antiga do `uuid`, que o `npm audit` aponta com severidade moderada (o problema afeta `v3`/`v5`/`v6` quando recebem o parâmetro `buf`; o ExcelJS só chama `v4()` sem `buf`). A versão foi mantida fixa de propósito.
- O servidor fake é só para desenvolvimento: compara valores sem diferenciar maiúsculas (como o LDAP real faz para `cn`/`uid`), guarda senhas em memória e não usa TLS.

## Referências

- [RFC 4511 — LDAP: The Protocol](https://www.rfc-editor.org/rfc/rfc4511)
- [RFC 4515 — LDAP: String Representation of Search Filters](https://www.rfc-editor.org/rfc/rfc4515)
- [RFC 2696 — LDAP Control Extension for Simple Paged Results](https://www.rfc-editor.org/rfc/rfc2696)
- [OWASP — LDAP Injection Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/LDAP_Injection_Prevention_Cheat_Sheet.html)
- [ExcelJS — Streaming I/O](https://github.com/exceljs/exceljs#streaming-io)
- [Documentação do ldapjs](http://ldapjs.org/)

## Licença

[MIT](LICENSE) © 2026 sidsidoso
