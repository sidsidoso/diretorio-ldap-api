import jwt from 'jsonwebtoken';
import { ErroHttp } from './erros.js';

/**
 * Exige "Authorization: Bearer <jwt>" válido (HS256 fixado, iss/aud conferidos) e popula req.usuario.
 * Compatível com os tokens emitidos pelo projeto login-ldap-jwt.
 */
export function exigirToken({ segredo, emissor, audiencia }) {
  const opcoes = { algorithms: ['HS256'], issuer: emissor, audience: audiencia };
  return (req, res, next) => {
    const [esquema, token] = (req.get('authorization') ?? '').split(' ');
    if (esquema !== 'Bearer' || !token) {
      res.set('WWW-Authenticate', 'Bearer');
      return next(new ErroHttp(401, 'Token ausente'));
    }
    try {
      req.usuario = jwt.verify(token, segredo, opcoes);
      return next();
    } catch (err) {
      res.set('WWW-Authenticate', 'Bearer error="invalid_token"');
      return next(new ErroHttp(401, err.name === 'TokenExpiredError' ? 'Token expirado' : 'Token inválido'));
    }
  };
}

/** Autoriza se o usuário tiver pelo menos um dos papéis informados. */
export function exigirPapel(...papeis) {
  return (req, res, next) => {
    const doUsuario = req.usuario?.papeis ?? [];
    if (papeis.some((p) => doUsuario.includes(p))) return next();
    return next(new ErroHttp(403, 'Acesso negado para o seu perfil'));
  };
}
