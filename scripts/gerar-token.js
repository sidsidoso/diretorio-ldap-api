// Gera um JWT de DEMONSTRAÇÃO, assinado com o JWT_SEGREDO do .env.
// Em uso real, o token vem do serviço de login (ex.: projeto login-ldap-jwt).
// Uso: npm run token -- [usuario] [papel1,papel2]
import jwt from 'jsonwebtoken';
import { carregarConfig } from '../src/config.js';

try {
  process.loadEnvFile();
} catch {
  // sem .env
}

const [usuario = 'ana.souza', papeis = 'admin,usuario'] = process.argv.slice(2);
const config = carregarConfig();
if (config.jwt.segredo.length < 32) {
  console.error('JWT_SEGREDO precisa ter pelo menos 32 caracteres (copie o .env.example para .env)');
  process.exit(1);
}

const token = jwt.sign({ papeis: papeis.split(',').filter(Boolean) }, config.jwt.segredo, {
  algorithm: 'HS256',
  subject: usuario,
  expiresIn: '15m',
  issuer: config.jwt.emissor,
  audience: config.jwt.audiencia
});
console.log(token);
