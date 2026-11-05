import assert from 'node:assert/strict';
import { once } from 'node:events';
import { after, before, describe, it } from 'node:test';
import ExcelJS from 'exceljs';
import jwt from 'jsonwebtoken';
import { CONTA_SERVICO, iniciarServidorLdapFake, USUARIOS_EXEMPLO } from '../scripts/servidor-ldap-fake.js';
import { criarApp } from '../src/app.js';
import { carregarConfig } from '../src/config.js';
import { criarServicoDiretorio } from '../src/servicos/diretorio.js';

const SEGREDO = 'segredo-de-teste-com-mais-de-32-caracteres';

function token(papeis, extras = {}) {
  return jwt.sign({ papeis }, SEGREDO, {
    algorithm: 'HS256', subject: 'teste', expiresIn: '5m', issuer: 'login-ldap-jwt', audience: 'apis-internas', ...extras
  });
}

async function subirApi(config, diretorio) {
  const servidor = criarApp(config, { diretorio }).listen(0, '127.0.0.1');
  await once(servidor, 'listening');
  return { servidor, base: `http://127.0.0.1:${servidor.address().port}` };
}

describe('API do diretório LDAP', () => {
  let ldap, api, config, diretorio;
  const tokenAdmin = token(['admin']);
  const tokenUsuario = token(['usuario']);
  const get = (rota, t = tokenUsuario) => fetch(`${api.base}${rota}`, { headers: { authorization: `Bearer ${t}` } });

  before(async () => {
    ldap = await iniciarServidorLdapFake({ porta: 0 });
    config = carregarConfig({
      LDAP_URL: ldap.url,
      LDAP_BIND_DN: CONTA_SERVICO.dn,
      LDAP_BIND_SENHA: CONTA_SERVICO.senha,
      LDAP_TIMEOUT_MS: '2000',
      JWT_SEGREDO: SEGREDO
    });
    diretorio = criarServicoDiretorio(config.ldap);
    api = await subirApi(config, diretorio);
  });

  after(async () => {
    api.servidor.close();
    await diretorio.fechar();
    await ldap.fechar();
  });

  it('exige token válido', async () => {
    assert.equal((await fetch(`${api.base}/usuarios`)).status, 401);
    assert.equal((await get('/usuarios', 'abc.def.ghi')).status, 401);
    const semAssinatura = jwt.sign({ papeis: ['admin'] }, null, {
      algorithm: 'none', issuer: 'login-ldap-jwt', audience: 'apis-internas'
    });
    assert.equal((await get('/usuarios', semAssinatura)).status, 401);
    assert.equal((await get('/usuarios', token(['admin'], { audience: 'outra-api' }))).status, 401);
  });

  it('lista usuários com paginação', async () => {
    const res = await get('/usuarios?pagina=2&limite=5');
    assert.equal(res.status, 200);
    const corpo = await res.json();
    assert.equal(corpo.total, USUARIOS_EXEMPLO.length);
    assert.equal(corpo.totalPaginas, Math.ceil(USUARIOS_EXEMPLO.length / 5));
    assert.equal(corpo.pagina, 2);
    assert.equal(corpo.itens.length, 5);
    assert.equal(corpo.truncado, false);

    // Ordenação alfabética (pt-BR) estável entre páginas
    const todos = (await (await get('/usuarios?limite=100')).json()).itens.map((u) => u.nome);
    assert.deepEqual(corpo.itens.map((u) => u.nome), todos.slice(5, 10));
    assert.deepEqual(todos, [...todos].sort((a, b) => a.localeCompare(b, 'pt-BR')));
  });

  it('busca por nome (parcial, sem diferenciar maiúsculas) e por departamento', async () => {
    const porNome = await (await get('/usuarios?nome=ANA')).json();
    assert.deepEqual(porNome.itens.map((u) => u.uid), ['ana.souza', 'mariana.teixeira', 'tatiana.moreira']);

    const acentuado = await (await get(`/usuarios?nome=${encodeURIComponent('Fábio')}`)).json();
    assert.deepEqual(acentuado.itens.map((u) => u.uid), ['fabio.martins']);

    const ti = await (await get('/usuarios?departamento=TI')).json();
    assert.equal(ti.total, 6);
    assert.ok(ti.itens.every((u) => u.departamento === 'TI'));

    const combinado = await (await get('/usuarios?departamento=Comercial&nome=mari')).json();
    assert.deepEqual(combinado.itens.map((u) => u.nome), ['Mariana Teixeira']);
  });

  it('filtros com caracteres especiais não viram curinga (injeção)', async () => {
    const res = await get(`/usuarios?nome=${encodeURIComponent('*')}`);
    assert.equal((await res.json()).total, 0);
    const res2 = await get(`/usuarios?departamento=${encodeURIComponent('*)(uid=*')}`);
    assert.equal((await res2.json()).total, 0);
  });

  it('valida parâmetros de paginação', async () => {
    assert.equal((await get('/usuarios?limite=0')).status, 400);
    assert.equal((await get('/usuarios?limite=101')).status, 400);
    assert.equal((await get('/usuarios?pagina=abc')).status, 400);
  });

  it('detalha um usuário com seus grupos', async () => {
    const res = await get('/usuarios/isabela.ribeiro');
    assert.equal(res.status, 200);
    const u = await res.json();
    assert.equal(u.nome, 'Isabela Ribeiro');
    assert.equal(u.cargo, 'Gerente de RH');
    assert.deepEqual(u.grupos, ['colaboradores', 'gestores', 'rh']);

    assert.equal((await get('/usuarios/nao.existe')).status, 404);
    assert.equal((await get(`/usuarios/${encodeURIComponent('a*')}`)).status, 400);
  });

  it('lista grupos e membros de um grupo', async () => {
    const grupos = await (await get('/grupos')).json();
    assert.equal(grupos.total, 6);
    const colaboradores = grupos.itens.find((g) => g.cn === 'colaboradores');
    assert.equal(colaboradores.totalMembros, USUARIOS_EXEMPLO.length);

    const rh = await (await get('/grupos/rh/membros')).json();
    assert.equal(rh.descricao, 'Recursos Humanos');
    assert.deepEqual(rh.membros.map((m) => m.uid), ['carla.mendes', 'isabela.ribeiro', 'olivia.cardoso']);

    assert.equal((await get('/grupos/inexistente/membros')).status, 404);
  });

  it('reaproveita uma única conexão LDAP entre requisições', async () => {
    const antes = ldap.conexoes();
    await Promise.all([get('/usuarios'), get('/grupos'), get('/usuarios/ana.souza'), get('/grupos/rh/membros')]);
    assert.equal(ldap.conexoes(), antes, 'nenhuma conexão nova deveria ser aberta');
  });

  it('sinaliza resultado truncado quando passa do limite configurado', async () => {
    const limitado = criarServicoDiretorio({ ...config.ldap, limiteResultados: 5 });
    try {
      const { usuarios, truncado } = await limitado.buscarUsuarios({});
      assert.equal(usuarios.length, 5);
      assert.equal(truncado, true);
    } finally {
      await limitado.fechar();
    }
  });

  it('exportação exige papel autorizado', async () => {
    assert.equal((await get('/usuarios/exportar')).status, 403);
  });

  it('exporta a busca para .xlsx com cabeçalho estilizado, autofiltro e linha congelada', async () => {
    const res = await get('/usuarios/exportar?departamento=TI', tokenAdmin);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    assert.match(res.headers.get('content-disposition'), /attachment; filename="usuarios-\d{4}-\d{2}-\d{2}\.xlsx"/);

    const livro = new ExcelJS.Workbook();
    await livro.xlsx.load(Buffer.from(await res.arrayBuffer()));
    const aba = livro.getWorksheet('Usuarios');
    assert.ok(aba, 'aba Usuarios existe');

    assert.deepEqual(aba.getRow(1).values.slice(1), ['Usuário', 'Nome', 'E-mail', 'Cargo', 'Departamento', 'Telefone']);
    const titulo = aba.getCell('A1');
    assert.equal(titulo.font.bold, true);
    assert.equal(titulo.fill.fgColor.argb, 'FF1F4E78');

    assert.equal(aba.rowCount, 7); // cabeçalho + 6 pessoas de TI
    assert.equal(aba.getCell('B2').value, 'Ana Souza');
    assert.equal(aba.getCell('C2').value, 'ana.souza@empresa.local');
    for (let r = 2; r <= 7; r++) assert.equal(aba.getCell(`E${r}`).value, 'TI');

    assert.equal(aba.views[0].state, 'frozen');
    assert.equal(aba.views[0].ySplit, 1);
    assert.equal(aba.autoFilter, 'A1:F7');
    // largura automática: e-mail mais longo + 2
    const maiorEmail = Math.max(...USUARIOS_EXEMPLO.filter((u) => u.departamento === 'TI').map((u) => `${u.uid}@empresa.local`.length));
    assert.equal(aba.getColumn(3).width, maiorEmail + 2);

    const filtros = livro.getWorksheet('Filtros');
    assert.equal(filtros.getCell('B3').value, 'TI');
    assert.equal(filtros.getCell('B4').value, 6);
  });

  it('LDAP indisponível devolve 503 e rota inexistente devolve 404', async () => {
    const cfgOff = { ...config.ldap, url: 'ldap://127.0.0.1:1', timeoutMs: 1000 };
    const off = await subirApi(config, criarServicoDiretorio(cfgOff));
    try {
      const res = await fetch(`${off.base}/usuarios`, { headers: { authorization: `Bearer ${tokenUsuario}` } });
      assert.equal(res.status, 503);
      assert.deepEqual(await res.json(), { erro: 'Serviço de diretório indisponível' });
      const r404 = await fetch(`${off.base}/nada`);
      assert.equal(r404.status, 404);
    } finally {
      off.servidor.close();
    }
  });
});
