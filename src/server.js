import { criarApp } from './app.js';
import { carregarConfig, validarConfig } from './config.js';
import { criarServicoDiretorio } from './servicos/diretorio.js';

// Carrega o .env, se existir (Node >= 20.12); variáveis já definidas no ambiente prevalecem
try {
  process.loadEnvFile();
} catch {
  // sem .env: segue apenas com as variáveis de ambiente
}

let config;
try {
  config = validarConfig(carregarConfig());
} catch (err) {
  console.error(`Configuração inválida: ${err.message}`);
  process.exit(1);
}

const diretorio = criarServicoDiretorio(config.ldap);
const servidor = criarApp(config, { diretorio }).listen(config.porta, () => {
  console.log(`API do diretório ouvindo em http://localhost:${config.porta} (LDAP: ${config.ldap.url})`);
});

// Encerramento gracioso: para de aceitar conexões e faz unbind da conexão LDAP persistente
for (const sinal of ['SIGINT', 'SIGTERM']) {
  process.once(sinal, () => {
    servidor.close(async () => {
      await diretorio.fechar();
      process.exit(0);
    });
  });
}
