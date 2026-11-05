// Consultas ao diretório usando UMA conexão persistente, autenticada com a conta de serviço.
// O LDAP multiplexa operações por messageID, então requisições concorrentes compartilham o socket.
import ldap from 'ldapjs';
import { ErroHttp } from '../middlewares/erros.js';
import { bind, buscar, conectar, encerrar, escaparFiltro } from './ldap.js';

const ATRIBUTOS_USUARIO = ['uid', 'cn', 'mail', 'title', 'departmentNumber', 'telephoneNumber'];
const colecao = new Intl.Collator('pt-BR', { sensitivity: 'base' });

const primeiro = (entrada, atributo) => entrada[atributo]?.[0] ?? null;

export function paraUsuario(entrada) {
  return {
    uid: primeiro(entrada, 'uid'),
    nome: primeiro(entrada, 'cn'),
    email: primeiro(entrada, 'mail'),
    cargo: primeiro(entrada, 'title'),
    departamento: primeiro(entrada, 'departmentNumber'),
    telefone: primeiro(entrada, 'telephoneNumber')
  };
}

/** "cn=rh,ou=grupos,..." -> "rh" */
export function cnDoDn(dn) {
  const m = /^cn=((?:\\.|[^,])+)/i.exec(String(dn).trim());
  return m ? m[1].replace(/\\(.)/g, '$1') : null;
}

/** Monta o filtro de usuários; todo valor vindo do cliente é escapado. */
export function filtroUsuarios({ nome, departamento } = {}) {
  let filtro = '(objectClass=inetOrgPerson)';
  if (nome) filtro += `(|(cn=*${escaparFiltro(nome)}*)(uid=*${escaparFiltro(nome)}*))`;
  if (departamento) filtro += `(departmentNumber=${escaparFiltro(departamento)})`;
  return `(&${filtro})`;
}

export function criarServicoDiretorio(cfg) {
  let conexao = null; // Promise<Client> compartilhada

  function obterConexao() {
    if (!conexao) {
      const atual = (async () => {
        const cliente = await conectar(cfg);
        try {
          await bind(cliente, cfg.bindDn, cfg.bindSenha);
        } catch (err) {
          cliente.destroy();
          throw err;
        }
        // Se o socket cair, a próxima requisição reconecta
        cliente.once('close', () => {
          if (conexao === atual) conexao = null;
        });
        return cliente;
      })();
      atual.catch(() => {
        if (conexao === atual) conexao = null;
      });
      conexao = atual;
    }
    return conexao;
  }

  async function pesquisar(base, opcoes, tentativa = 1) {
    let cliente;
    try {
      cliente = await obterConexao();
      return await buscar(cliente, base, {
        scope: 'sub',
        sizeLimit: cfg.limiteResultados,
        timeLimit: Math.ceil(cfg.timeoutMs / 1000),
        ...opcoes
      });
    } catch (err) {
      if (err instanceof ldap.NoSuchObjectError) return [];
      // Descarta a conexão problemática e tenta mais uma vez com uma nova
      cliente?.destroy();
      conexao = null;
      if (tentativa < 2) return pesquisar(base, opcoes, tentativa + 1);
      throw new ErroHttp(503, 'Serviço de diretório indisponível');
    }
  }

  return {
    async buscarUsuarios(criterios) {
      const entradas = await pesquisar(cfg.baseUsuarios, {
        filter: filtroUsuarios(criterios),
        attributes: ATRIBUTOS_USUARIO
      });
      const usuarios = entradas.map(paraUsuario).sort((a, b) => colecao.compare(a.nome ?? '', b.nome ?? ''));
      return { usuarios, truncado: entradas.truncado };
    },

    async obterUsuario(uid) {
      const [entrada] = await pesquisar(cfg.baseUsuarios, {
        filter: `(&(objectClass=inetOrgPerson)(uid=${escaparFiltro(uid)}))`,
        attributes: [...ATRIBUTOS_USUARIO, 'memberOf'],
        sizeLimit: 1
      });
      if (!entrada) return null;
      return { ...paraUsuario(entrada), grupos: (entrada.memberOf ?? []).map(cnDoDn).filter(Boolean).sort() };
    },

    async listarGrupos() {
      const entradas = await pesquisar(cfg.baseGrupos, {
        filter: '(objectClass=groupOfNames)',
        attributes: ['cn', 'description', 'member']
      });
      return entradas
        .map((e) => ({ cn: primeiro(e, 'cn'), descricao: primeiro(e, 'description'), totalMembros: e.member?.length ?? 0 }))
        .sort((a, b) => colecao.compare(a.cn, b.cn));
    },

    async membrosDoGrupo(cn) {
      const [grupo] = await pesquisar(cfg.baseGrupos, {
        filter: `(&(objectClass=groupOfNames)(cn=${escaparFiltro(cn)}))`,
        attributes: ['cn', 'description'],
        sizeLimit: 1
      });
      if (!grupo) return null;
      // Uma única busca usando memberOf, em vez de uma consulta por membro
      const entradas = await pesquisar(cfg.baseUsuarios, {
        filter: `(&(objectClass=inetOrgPerson)(memberOf=${escaparFiltro(grupo.dn)}))`,
        attributes: ATRIBUTOS_USUARIO
      });
      return {
        grupo: { cn: primeiro(grupo, 'cn'), descricao: primeiro(grupo, 'description') },
        membros: entradas.map(paraUsuario).sort((a, b) => colecao.compare(a.nome ?? '', b.nome ?? ''))
      };
    },

    /** Fecha a conexão persistente (unbind) — chamado no desligamento. */
    async fechar() {
      const atual = conexao;
      conexao = null;
      if (!atual) return;
      const cliente = await atual.catch(() => null);
      if (cliente) await encerrar(cliente);
    }
  };
}
