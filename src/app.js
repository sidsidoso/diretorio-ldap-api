import express from 'express';
import { exigirToken } from './middlewares/autenticacao.js';
import { naoEncontrado, tratadorErros } from './middlewares/erros.js';
import { rotasGrupos } from './rotas/grupos.js';
import { rotasUsuarios } from './rotas/usuarios.js';
import { criarServicoDiretorio } from './servicos/diretorio.js';

/**
 * Monta a aplicação. O serviço de diretório pode ser injetado (útil nos testes).
 */
export function criarApp(config, { diretorio = criarServicoDiretorio(config.ldap) } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  app.get('/saude', (req, res) => res.json({ status: 'ok' }));

  const autenticado = exigirToken(config.jwt);
  app.use('/usuarios', autenticado, rotasUsuarios({ diretorio, papeisExportacao: config.papeisExportacao }));
  app.use('/grupos', autenticado, rotasGrupos({ diretorio }));

  app.use(naoEncontrado);
  app.use(tratadorErros);
  return app;
}
