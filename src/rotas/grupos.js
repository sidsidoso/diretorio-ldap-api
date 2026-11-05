import { Router } from 'express';
import { ErroHttp } from '../middlewares/erros.js';

const CN_VALIDO = /^[\p{L}\p{N} ._-]{1,64}$/u;

export function rotasGrupos({ diretorio }) {
  const router = Router();

  router.get('/', async (req, res) => {
    const grupos = await diretorio.listarGrupos();
    res.json({ total: grupos.length, itens: grupos });
  });

  router.get('/:cn/membros', async (req, res) => {
    const { cn } = req.params;
    if (!CN_VALIDO.test(cn)) throw new ErroHttp(400, 'Nome de grupo inválido');
    const resultado = await diretorio.membrosDoGrupo(cn);
    if (!resultado) throw new ErroHttp(404, 'Grupo não encontrado');
    res.json({ ...resultado.grupo, total: resultado.membros.length, membros: resultado.membros });
  });

  return router;
}
