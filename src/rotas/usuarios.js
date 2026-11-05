import { Router } from 'express';
import { exigirPapel } from '../middlewares/autenticacao.js';
import { ErroHttp } from '../middlewares/erros.js';
import { escreverPlanilhaUsuarios } from '../servicos/exportacao.js';

const UID_VALIDO = /^[A-Za-z0-9._-]{1,64}$/;
const LIMITE_MAXIMO = 100;

/** Lê e valida os filtros de busca da query string. */
function lerFiltros(query) {
  const filtros = {};
  for (const campo of ['nome', 'departamento']) {
    const valor = query[campo];
    if (valor === undefined || valor === '') continue;
    if (typeof valor !== 'string' || valor.length > 64) throw new ErroHttp(400, `Parâmetro "${campo}" inválido`);
    filtros[campo] = valor.trim();
  }
  return filtros;
}

function lerInteiro(valor, padrao, nome, max = Infinity) {
  if (valor === undefined) return padrao;
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 1 || n > max) {
    throw new ErroHttp(400, `Parâmetro "${nome}" deve ser um inteiro entre 1 e ${max === Infinity ? 'N' : max}`);
  }
  return n;
}

export function rotasUsuarios({ diretorio, papeisExportacao }) {
  const router = Router();

  // GET /usuarios?nome=&departamento=&pagina=1&limite=20
  router.get('/', async (req, res) => {
    const filtros = lerFiltros(req.query);
    const pagina = lerInteiro(req.query.pagina, 1, 'pagina');
    const limite = lerInteiro(req.query.limite, 20, 'limite', LIMITE_MAXIMO);

    const { usuarios, truncado } = await diretorio.buscarUsuarios(filtros);
    const inicio = (pagina - 1) * limite;
    res.json({
      pagina,
      limite,
      total: usuarios.length,
      totalPaginas: Math.ceil(usuarios.length / limite),
      truncado,
      itens: usuarios.slice(inicio, inicio + limite)
    });
  });

  // GET /usuarios/exportar?nome=&departamento= -> .xlsx (streaming)
  router.get('/exportar', exigirPapel(...papeisExportacao), async (req, res) => {
    const filtros = lerFiltros(req.query);
    const { usuarios } = await diretorio.buscarUsuarios(filtros);
    const data = new Date().toISOString().slice(0, 10);

    res.status(200);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="usuarios-${data}.xlsx"`,
      'Cache-Control': 'no-store'
    });
    await escreverPlanilhaUsuarios(res, usuarios, { filtros });
  });

  router.get('/:uid', async (req, res) => {
    const { uid } = req.params;
    if (!UID_VALIDO.test(uid)) throw new ErroHttp(400, 'Identificador de usuário inválido');
    const usuario = await diretorio.obterUsuario(uid);
    if (!usuario) throw new ErroHttp(404, 'Usuário não encontrado');
    res.json(usuario);
  });

  return router;
}
