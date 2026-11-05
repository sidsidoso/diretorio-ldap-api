// Configuração lida de variáveis de ambiente (padrões pensados para desenvolvimento)
const inteiro = (valor, padrao) => {
  const n = Number.parseInt(valor ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : padrao;
};

const lista = (texto, padrao) => (texto ? texto.split(',').map((s) => s.trim()).filter(Boolean) : padrao);

export function carregarConfig(env = process.env) {
  return {
    porta: inteiro(env.PORTA, 3001),
    ldap: {
      url: env.LDAP_URL ?? 'ldap://127.0.0.1:1389',
      baseUsuarios: env.LDAP_BASE_USUARIOS ?? 'ou=usuarios,dc=empresa,dc=local',
      baseGrupos: env.LDAP_BASE_GRUPOS ?? 'ou=grupos,dc=empresa,dc=local',
      bindDn: env.LDAP_BIND_DN ?? 'cn=svc-diretorio,ou=servicos,dc=empresa,dc=local',
      bindSenha: env.LDAP_BIND_SENHA ?? '',
      timeoutMs: inteiro(env.LDAP_TIMEOUT_MS, 5000),
      // Teto de resultados por busca (protege a API e o servidor LDAP)
      limiteResultados: inteiro(env.LDAP_LIMITE_RESULTADOS, 1000)
    },
    jwt: {
      segredo: env.JWT_SEGREDO ?? '',
      emissor: env.JWT_EMISSOR ?? 'login-ldap-jwt',
      audiencia: env.JWT_AUDIENCIA ?? 'apis-internas'
    },
    papeisExportacao: lista(env.PAPEIS_EXPORTACAO, ['admin', 'rh'])
  };
}

export function validarConfig(config) {
  if (config.jwt.segredo.length < 32) throw new Error('JWT_SEGREDO precisa ter pelo menos 32 caracteres');
  if (!config.ldap.bindSenha) throw new Error('LDAP_BIND_SENHA não definida');
  return config;
}
