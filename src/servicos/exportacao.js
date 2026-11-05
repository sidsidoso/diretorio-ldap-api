// Exportação para .xlsx em streaming: as linhas vão direto para o destino (ex.: a resposta HTTP),
// sem montar a planilha inteira em memória.
import ExcelJS from 'exceljs';

export const COLUNAS = [
  { header: 'Usuário', key: 'uid' },
  { header: 'Nome', key: 'nome' },
  { header: 'E-mail', key: 'email' },
  { header: 'Cargo', key: 'cargo' },
  { header: 'Departamento', key: 'departamento' },
  { header: 'Telefone', key: 'telefone' }
];

const LARGURA_MIN = 8;
const LARGURA_MAX = 60;

/** Larguras "automáticas": maior texto da coluna (cabeçalho incluso) + folga. */
export function calcularLarguras(linhas) {
  return COLUNAS.map(({ header, key }) => {
    const maior = linhas.reduce((max, l) => Math.max(max, String(l[key] ?? '').length), header.length);
    return Math.min(LARGURA_MAX, Math.max(LARGURA_MIN, maior + 2));
  });
}

/**
 * Escreve a planilha no stream informado.
 * As larguras precisam ser definidas antes do primeiro commit (o <cols> vai no início do XML),
 * por isso são calculadas a partir dos dados já obtidos do LDAP.
 */
export async function escreverPlanilhaUsuarios(destino, usuarios, { filtros = {}, geradoEm = new Date() } = {}) {
  const livro = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: destino,
    useStyles: true,
    useSharedStrings: false // strings inline: menos memória no streaming
  });
  livro.creator = 'diretorio-ldap-api';
  livro.created = geradoEm;

  const aba = livro.addWorksheet('Usuarios', {
    views: [{ state: 'frozen', ySplit: 1 }], // congela a linha de cabeçalho
    properties: { defaultRowHeight: 18 }
  });
  const larguras = calcularLarguras(usuarios);
  aba.columns = COLUNAS.map((c, i) => ({ ...c, width: larguras[i] }));

  const cabecalho = aba.getRow(1);
  cabecalho.height = 22;
  cabecalho.eachCell((celula) => {
    celula.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    celula.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
    celula.alignment = { vertical: 'middle', horizontal: 'center' };
    celula.border = { bottom: { style: 'thin', color: { argb: 'FF0B2540' } } };
  });
  cabecalho.commit();

  for (const u of usuarios) aba.addRow(u).commit();

  aba.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, usuarios.length + 1), column: COLUNAS.length } };
  aba.commit();

  // Aba de metadados: quando e com quais filtros a exportação foi gerada
  const info = livro.addWorksheet('Filtros');
  info.columns = [{ key: 'campo', width: 16 }, { key: 'valor', width: 40 }];
  const linhasInfo = [
    ['Gerado em', geradoEm.toISOString()],
    ['Nome', filtros.nome ?? '(todos)'],
    ['Departamento', filtros.departamento ?? '(todos)'],
    ['Total', usuarios.length]
  ];
  for (const [campo, valor] of linhasInfo) {
    const linha = info.addRow({ campo, valor });
    linha.getCell(1).font = { bold: true };
    linha.commit();
  }
  info.commit();

  await livro.commit();
}
