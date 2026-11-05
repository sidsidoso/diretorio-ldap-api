// Erros HTTP e tratamento centralizado (sempre responde JSON)
export class ErroHttp extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}

export function naoEncontrado(req, res) {
  res.status(404).json({ erro: 'Rota não encontrada' });
}

export function tratadorErros(err, req, res, next) {
  // Falha no meio de um download (streaming): não há como mudar o status; encerra a conexão
  if (res.headersSent) return next(err);
  if (err instanceof ErroHttp) return res.status(err.status).json({ erro: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ erro: 'JSON inválido' });
  if (err.type === 'entity.too.large') return res.status(413).json({ erro: 'Corpo da requisição muito grande' });

  console.error(`[erro] ${req.method} ${req.path}: ${err.message}`);
  return res.status(500).json({ erro: 'Erro interno' });
}
