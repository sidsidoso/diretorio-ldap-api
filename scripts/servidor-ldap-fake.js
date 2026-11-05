// Servidor LDAP em memória (ldapjs) com um diretório de exemplo, para demo e testes.
// NÃO use em produção: senhas ficam em memória e não há TLS.
import { timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import ldap from 'ldapjs';

export const BASE_DN = 'dc=empresa,dc=local';
export const CONTA_SERVICO = { dn: `cn=svc-diretorio,ou=servicos,${BASE_DN}`, senha: 'svc-demo-123' };

const dnUsuario = (uid) => `uid=${uid},ou=usuarios,${BASE_DN}`;
const dnGrupo = (cn) => `cn=${cn},ou=grupos,${BASE_DN}`;

// [nome, departamento, cargo, grupos extras]
const PESSOAS = [
  ['Ana Souza', 'TI', 'Gerente de TI', ['ti-admins', 'gestores']],
  ['Bruno Lima', 'Financeiro', 'Analista Financeiro', ['financeiro']],
  ['Carla Mendes', 'RH', 'Analista de RH', ['rh']],
  ['Diego Ferreira', 'TI', 'Desenvolvedor', []],
  ['Eduarda Rocha', 'Comercial', 'Executiva de Contas', ['comercial']],
  ['Fábio Martins', 'Operações', 'Coordenador de Operações', ['gestores']],
  ['Gabriela Alves', 'TI', 'Analista de Suporte', ['ti-admins']],
  ['Henrique Costa', 'Financeiro', 'Controller', ['financeiro', 'gestores']],
  ['Isabela Ribeiro', 'RH', 'Gerente de RH', ['rh', 'gestores']],
  ['João Pereira', 'Comercial', 'Vendedor', ['comercial']],
  ['Karina Duarte', 'Operações', 'Analista de Logística', []],
  ['Lucas Araújo', 'TI', 'Desenvolvedor', []],
  ['Mariana Teixeira', 'Comercial', 'Gerente Comercial', ['comercial', 'gestores']],
  ['Nicolas Barbosa', 'Financeiro', 'Analista Contábil', ['financeiro']],
  ['Olívia Cardoso', 'RH', 'Assistente de RH', ['rh']],
  ['Pedro Nunes', 'Operações', 'Técnico de Manutenção', []],
  ['Rafaela Gomes', 'TI', 'Analista de Segurança', ['ti-admins']],
  ['Samuel Pinto', 'Comercial', 'Vendedor', ['comercial']],
  ['Tatiana Moreira', 'Financeiro', 'Tesoureira', ['financeiro']],
  ['Vinícius Lopes', 'Operações', 'Analista de Processos', []],
  ['Yasmin Freitas', 'TI', 'Cientista de Dados', []],
  ['Anderson Silva', 'Comercial', 'Pré-vendas', ['comercial']]
];

/** Gera o uid "nome.sobrenome" sem acentos. */
const paraUid = (nome) => nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(' ', '.');

export const USUARIOS_EXEMPLO = PESSOAS.map(([nome, departamento, cargo, extras], i) => ({
  uid: paraUid(nome),
  nome,
  departamento,
  cargo,
  telefone: `+55 11 3000-${String(1000 + i * 7).padStart(4, '0')}`,
  grupos: ['colaboradores', ...extras]
}));

const DESCRICOES = {
  colaboradores: 'Todos os colaboradores',
  'ti-admins': 'Administradores de TI',
  financeiro: 'Equipe financeira',
  rh: 'Recursos Humanos',
  comercial: 'Equipe comercial',
  gestores: 'Gestores e coordenadores'
};

function montarEntradas() {
  const entradas = [{
    dn: CONTA_SERVICO.dn,
    attributes: { objectClass: ['top', 'applicationProcess'], cn: 'svc-diretorio' }
  }];
  for (const u of USUARIOS_EXEMPLO) {
    const [givenName, ...resto] = u.nome.split(' ');
    entradas.push({
      dn: dnUsuario(u.uid),
      attributes: {
        objectClass: ['top', 'person', 'organizationalPerson', 'inetOrgPerson'],
        uid: u.uid,
        cn: u.nome,
        givenName,
        sn: resto.join(' '),
        mail: `${u.uid}@empresa.local`,
        title: u.cargo,
        departmentNumber: u.departamento,
        telephoneNumber: u.telefone,
        memberOf: u.grupos.map(dnGrupo)
      }
    });
  }
  for (const [cn, description] of Object.entries(DESCRICOES)) {
    entradas.push({
      dn: dnGrupo(cn),
      attributes: {
        objectClass: ['top', 'groupOfNames'],
        cn,
        description,
        member: USUARIOS_EXEMPLO.filter((u) => u.grupos.includes(cn)).map((u) => dnUsuario(u.uid))
      }
    });
  }
  return entradas;
}

const normalizarDn = (dn) => String(dn).replace(/\s*,\s*/g, ',').toLowerCase();

// Cópia com nomes e valores em minúsculas: simula a comparação sem distinção de caixa do LDAP real
const minusculas = (attrs) => Object.fromEntries(Object.entries(attrs).map(([k, v]) => [
  k.toLowerCase(), [v].flat().map((x) => x.toLowerCase())
]));

/** Converte "\2a", "\c3\a1"... (RFC 4515) de volta para texto. */
function desescapar(valor) {
  const bytes = Buffer.from(String(valor ?? ''), 'utf8');
  const saida = [];
  for (let i = 0; i < bytes.length; i++) {
    const hex = bytes.subarray(i + 1, i + 3).toString('latin1');
    if (bytes[i] === 0x5c && /^[0-9a-f]{2}$/i.test(hex)) {
      saida.push(Number.parseInt(hex, 16));
      i += 2;
    } else {
      saida.push(bytes[i]);
    }
  }
  return Buffer.from(saida).toString('utf8').toLowerCase();
}

const escaparRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Avalia o filtro recebido. O matches() do ldapjs compara os valores ainda escapados,
 * por isso o servidor fake usa este avaliador próprio (and/or/not/=/substring/presença).
 */
function casa(filtro, attrs) {
  const valores = attrs[filtro.attribute?.toLowerCase()] ?? [];
  switch (filtro.type) {
    case 'AndFilter': return filtro.clauses.every((f) => casa(f, attrs));
    case 'OrFilter': return filtro.clauses.some((f) => casa(f, attrs));
    case 'NotFilter': return !casa(filtro.filter, attrs);
    case 'PresenceFilter': return valores.length > 0;
    case 'EqualityFilter': return valores.includes(desescapar(filtro.value));
    case 'SubstringFilter': {
      const partes = [filtro.initial ?? '', ...filtro.any, filtro.final ?? ''].map((p) => escaparRegex(desescapar(p)));
      const regex = new RegExp(`^${partes.join('.*')}$`, 's');
      return valores.some((v) => regex.test(v));
    }
    default: return false;
  }
}

function senhaConfere(esperada, recebida) {
  const a = Buffer.from(String(esperada));
  const b = Buffer.from(String(recebida));
  return a.length === b.length && timingSafeEqual(a, b);
}

function dentroDoEscopo(dnEntrada, dnBase, escopo) {
  if (escopo === 'base') return dnEntrada === dnBase;
  if (dnEntrada !== dnBase && !dnEntrada.endsWith(`,${dnBase}`)) return false;
  if (escopo === 'single') return dnEntrada.split(',').length === dnBase.split(',').length + 1;
  return true;
}

/**
 * Sobe o servidor LDAP fake.
 * @returns {Promise<{ url: string, fechar: () => Promise<void>, buscas: () => number }>}
 */
export function iniciarServidorLdapFake({ porta = 0, host = '127.0.0.1' } = {}) {
  const indice = montarEntradas().map((e) => ({ ...e, dnNorm: normalizarDn(e.dn), busca: minusculas(e.attributes) }));
  const senhas = new Map([[normalizarDn(CONTA_SERVICO.dn), CONTA_SERVICO.senha]]);
  const servidor = ldap.createServer();
  let totalBuscas = 0;
  let totalConexoes = 0;
  servidor.on('connection', () => totalConexoes++);

  servidor.bind(BASE_DN, (req, res, next) => {
    const esperada = senhas.get(normalizarDn(req.dn.toString()));
    if (esperada === undefined || !senhaConfere(esperada, req.credentials)) {
      return next(new ldap.InvalidCredentialsError());
    }
    res.end();
    return next();
  });

  const exigirBind = (req, res, next) => {
    if (!senhas.has(normalizarDn(req.connection.ldap.bindDN.toString()))) {
      return next(new ldap.InsufficientAccessRightsError());
    }
    return next();
  };

  servidor.search(BASE_DN, exigirBind, (req, res, next) => {
    totalBuscas++;
    const base = normalizarDn(req.dn.toString());
    const limite = req.sizeLimit > 0 ? req.sizeLimit : Infinity;
    res.attributes = res.attributes.map((a) => a.toLowerCase());
    let enviados = 0;
    for (const e of indice) {
      if (!dentroDoEscopo(e.dnNorm, base, req.scopeName) || !casa(req.filter, e.busca)) continue;
      if (enviados >= limite) return next(new ldap.SizeLimitExceededError());
      res.send({ dn: e.dn, attributes: structuredClone(e.attributes) });
      enviados++;
    }
    res.end();
    return next();
  });

  return new Promise((resolve, reject) => {
    servidor.once('error', reject);
    servidor.listen(porta, host, () => resolve({
      url: `ldap://${host}:${servidor.port}`,
      buscas: () => totalBuscas,
      conexoes: () => totalConexoes,
      fechar: () => new Promise((r) => servidor.close(() => r()))
    }));
  });
}

// Execução direta: npm run ldap:fake
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const porta = Number(process.env.LDAP_FAKE_PORTA ?? 1389);
  const { url } = await iniciarServidorLdapFake({ porta });
  console.log(`Servidor LDAP fake ouvindo em ${url} (base ${BASE_DN})`);
  console.log(`Conta de serviço: ${CONTA_SERVICO.dn}`);
  console.log(`${USUARIOS_EXEMPLO.length} usuários e ${Object.keys(DESCRICOES).length} grupos carregados`);
}
