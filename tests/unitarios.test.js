import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cnDoDn, filtroUsuarios, paraUsuario } from '../src/servicos/diretorio.js';
import { calcularLarguras, COLUNAS } from '../src/servicos/exportacao.js';
import { escaparFiltro } from '../src/servicos/ldap.js';

describe('filtros LDAP', () => {
  it('escapa caracteres especiais (RFC 4515)', () => {
    assert.equal(escaparFiltro('*)(uid=*'), '\\2a\\29\\28uid=\\2a');
    assert.equal(escaparFiltro('a\\b'), 'a\\5cb');
  });

  it('monta o filtro de usuários combinando nome e departamento', () => {
    assert.equal(filtroUsuarios(), '(&(objectClass=inetOrgPerson))');
    assert.equal(
      filtroUsuarios({ nome: 'ana', departamento: 'TI' }),
      '(&(objectClass=inetOrgPerson)(|(cn=*ana*)(uid=*ana*))(departmentNumber=TI))'
    );
  });

  it('nunca deixa a entrada do cliente alterar a estrutura do filtro', () => {
    const filtro = filtroUsuarios({ nome: '*)(objectClass=*' });
    assert.ok(!filtro.includes('(objectClass=*'));
    assert.match(filtro, /\\2a\\29\\28objectClass=\\2a/);
  });
});

describe('mapeamentos', () => {
  it('converte uma entrada LDAP em usuário', () => {
    const u = paraUsuario({ dn: 'uid=x', uid: ['x'], cn: ['X Y'], mail: ['x@e'], title: ['Dev'] });
    assert.deepEqual(u, { uid: 'x', nome: 'X Y', email: 'x@e', cargo: 'Dev', departamento: null, telefone: null });
  });

  it('extrai o CN de um DN', () => {
    assert.equal(cnDoDn('cn=rh,ou=grupos,dc=empresa,dc=local'), 'rh');
    assert.equal(cnDoDn('uid=ana,ou=usuarios'), null);
  });

  it('calcula larguras de coluna pelo maior conteúdo, com limites', () => {
    const larguras = calcularLarguras([{ uid: 'a', nome: 'x'.repeat(200), email: 'curto@e' }]);
    assert.equal(larguras.length, COLUNAS.length);
    assert.equal(larguras[0], 9); // "Usuário" (7) + 2
    assert.equal(larguras[1], 60); // teto
  });
});
