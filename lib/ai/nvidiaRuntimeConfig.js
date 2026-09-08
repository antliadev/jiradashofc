export const NVIDIA_CHAT_ENDPOINT = 'https://integrate.api.nvidia.com/v1/chat/completions';
export const DEFAULT_NVIDIA_MODEL = 'nvidia/nemotron-3-super-120b-a12b';

function normalizeSecret(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function getNvidiaRuntimeConfig(env = process.env) {
  const apiKey = normalizeSecret(env.NVIDIA_API_KEY);
  const model = normalizeSecret(env.NVIDIA_MODEL) || DEFAULT_NVIDIA_MODEL;
  return {
    provider: 'nvidia',
    configured: Boolean(apiKey),
    model,
    endpoint: NVIDIA_CHAT_ENDPOINT,
    requiredEnv: 'NVIDIA_API_KEY',
    optionalEnv: 'NVIDIA_MODEL',
    missing: apiKey ? [] : ['NVIDIA_API_KEY'],
  };
}

export function assertNvidiaRuntimeConfig(env = process.env) {
  const config = getNvidiaRuntimeConfig(env);
  if (!config.configured) {
    const error = new Error('IA NVIDIA nao configurada. Preencha NVIDIA_API_KEY nas variaveis de ambiente da producao.');
    error.status = 503;
    error.code = 'NVIDIA_API_KEY_MISSING';
    error.config = config;
    throw error;
  }
  return config;
}
