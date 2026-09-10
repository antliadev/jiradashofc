/**
 * login.js — Página de Login
 */
import { sanitize } from '../utils/helpers.js';
import { firstAllowedRoute } from '../utils/access-control.js';
import { currentLoginMethods } from '../utils/login-mode.js';
export function renderLogin() {
  const content = document.getElementById('page-content');
  document.getElementById('page-header')?.replaceChildren();
  window.updateLayout?.(false);
  const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
  const recoveryRequested = params.get('recovery') === '1';
  const recoveryState = readRecoveryState();
  const authError = params.get('authError') || readAuthError();
  const recoveryMode = recoveryRequested || Boolean(recoveryState.accessToken || recoveryState.error);
  const recoveryError = recoveryState.error ? formatRecoveryError(recoveryState) : '';
  const loginMethods = currentLoginMethods();
  
  content.innerHTML = `
    <div class="login-container">
      <div class="login-card">
        <div class="login-header">
          <div class="login-logo">
            <img src="/antlia-logo.png" alt="">
          </div>
          <div class="login-product-mark">RJA</div>
          <h1>Radar Jira Antlia</h1>
          <p class="login-subtitle">${recoveryMode ? 'Entre em contato com o administrador para redefinir sua senha' : 'Faça login para acessar o painel'}</p>
        </div>
        
        ${recoveryMode ? `
          <div class="login-form">
            ${recoveryError ? `<div id="login-error" class="login-error">${recoveryError}</div>` : ''}
            <div class="report-alert info login-recovery-note">
              <strong>Redefinicao bloqueada para usuarios finais.</strong>
              <p>Por politica de seguranca, apenas o administrador pode redefinir senhas pela tela Gestao de Acessos.</p>
              <p>Avise o administrador responsavel para que ele gere uma nova senha provisoria no sistema.</p>
            </div>
            <button type="button" class="btn btn-secondary btn-login-alt" id="back-to-login-btn">
              Voltar ao login
            </button>
          </div>
        ` : `
          ${loginMethods.password ? `
            <form id="login-form" class="login-form">
              <div class="report-alert info login-environment-note"><strong>Ambiente de homologacao</strong><p>Use seu e-mail e senha cadastrados no Supabase.</p></div>
              <div class="form-group"><label for="login-email">E-mail</label><input type="email" id="login-email" name="email" autocomplete="email" required></div>
              <div class="form-group"><label for="login-password">Senha</label><input type="password" id="login-password" name="password" autocomplete="current-password" required></div>
              <div id="login-error" class="login-error" style="${authError ? '' : 'display: none;'}">${sanitize(authError)}</div>
              <button type="submit" class="btn btn-primary btn-login" id="login-btn">Entrar</button>
            </form>
          ` : `
            <div class="login-form">
              <button type="button" class="btn btn-primary btn-login btn-google" id="google-login-btn">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.92h5.38a4.6 4.6 0 0 1-2 3.02v2.55h3.24c1.9-1.75 2.98-4.33 2.98-7.42Z"/><path fill="#34A853" d="M12 22c2.7 0 4.97-.9 6.62-2.35l-3.24-2.55c-.9.6-2.05.96-3.38.96-2.6 0-4.81-1.76-5.6-4.13H3.06v2.63A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.4 13.93A6.02 6.02 0 0 1 6.08 12c0-.67.11-1.32.32-1.93V7.44H3.06A10 10 0 0 0 2 12c0 1.64.39 3.2 1.06 4.56l3.34-2.63Z"/><path fill="#EA4335" d="M12 5.94c1.47 0 2.79.5 3.83 1.5l2.87-2.87A9.64 9.64 0 0 0 12 2a10 10 0 0 0-8.94 5.44l3.34 2.63C7.19 7.7 9.4 5.94 12 5.94Z"/></svg>
                <span>Entrar com Google</span>
              </button>
              <div id="login-error" class="login-error" style="${authError ? '' : 'display: none;'}">${sanitize(authError)}</div>
            </div>
          `}
        `}
        
        <div class="login-footer">
          <p>${recoveryMode ? 'A redefinicao de senha e tratada pelo administrador do sistema' : 'Acesso restrito a usuários autorizados'}</p>
        </div>
      </div>
    </div>
  `;
  
  // Adicionar estilos específicos do login
  addLoginStyles();
  
  // Configurar o formulário
  clearAuthError();

  if (recoveryMode) {
    const backButton = document.getElementById('back-to-login-btn');

    backButton?.addEventListener('click', () => {
      clearRecoveryState();
      window.location.hash = '#/login';
    });
    return;
  }

  if (loginMethods.password) {
    document.getElementById('login-form')?.addEventListener('submit', submitPasswordLogin);
  } else {
    document.getElementById('google-login-btn')?.addEventListener('click', startGoogleLogin);
  }
}

async function submitPasswordLogin(event) {
  event.preventDefault();
  const button = document.getElementById('login-btn');
  const errorDiv = document.getElementById('login-error');
  errorDiv.style.display = 'none';
  button.disabled = true;
  button.textContent = 'Entrando...';
  try {
    const response = await fetch('/api/auth', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: document.getElementById('login-email').value.trim(), password: document.getElementById('login-password').value }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Nao foi possivel entrar.');
    if (data.sessionId && data.sessionId !== 'supabase-cookie') localStorage.setItem('sessionId', data.sessionId);
    window.markAuthenticated?.(data.user || null);
    window.location.hash = `#${firstAllowedRoute(data.user || null)}`;
  } catch (error) {
    errorDiv.textContent = error.message || 'Nao foi possivel entrar.';
    errorDiv.style.display = 'block';
    button.disabled = false;
    button.textContent = 'Entrar';
  }
}

async function startGoogleLogin() {
  const button = document.getElementById('google-login-btn');
  const errorDiv = document.getElementById('login-error');
  errorDiv.style.display = 'none';
  button.disabled = true;
  button.textContent = 'Abrindo Google...';
  try {
    const configResponse = await fetch('/api/auth/config', { credentials: 'include' });
    const config = await configResponse.json();
    if (!configResponse.ok || !config.googleEnabled) {
      throw new Error('Login Google ainda nao esta configurado no Supabase.');
    }
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        queryParams: {
          hd: config.allowedDomain,
        },
      },
    });
    if (error) throw error;
  } catch (error) {
    errorDiv.textContent = error.message || 'Nao foi possivel iniciar o login Google.';
    errorDiv.style.display = 'block';
    button.disabled = false;
    button.textContent = 'Entrar com Google';
  }
}

function readRecoveryState() {
  try {
    return JSON.parse(sessionStorage.getItem('rja.auth.recovery') || '{}');
  } catch {
    return {};
  }
}

function clearRecoveryState() {
  sessionStorage.removeItem('rja.auth.recovery');
}

function readAuthError() {
  return sessionStorage.getItem('rja.auth.error') || '';
}

function clearAuthError() {
  sessionStorage.removeItem('rja.auth.error');
}

function formatRecoveryError(recoveryState) {
  const description = decodeURIComponent((recoveryState.errorDescription || '').replace(/\+/g, ' ')).trim();
  if (recoveryState.errorCode === 'otp_expired') {
    return 'O link de recuperacao expirou. Avise o administrador para emitir um novo reset pela Gestao de Acessos.';
  }
  return description || 'Nao foi possivel validar o link de recuperacao. Avise o administrador do sistema.';
}

function addLoginStyles() {
  // Verificar se já foi adicionado
  if (document.getElementById('login-styles')) return;
  
  const style = document.createElement('style');
  style.id = 'login-styles';
  style.textContent = `
    .login-container {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
      isolation: isolate;
      overflow: hidden;
      padding: 24px;
      background:
        radial-gradient(circle at 18% 14%, rgba(109, 124, 246, .15), transparent 30rem),
        radial-gradient(circle at 82% 82%, rgba(90, 167, 255, .08), transparent 28rem),
        var(--bg-primary);
    }

    .login-container::before {
      content: '';
      position: absolute;
      z-index: -1;
      inset: 0;
      opacity: .16;
      background-image: linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px);
      background-size: 42px 42px;
      mask-image: radial-gradient(circle at center, black, transparent 72%);
    }
    
    .login-card {
      background: color-mix(in srgb, var(--bg-card) 92%, transparent);
      border: 1px solid var(--border-light);
      border-radius: 20px;
      padding: clamp(30px, 4vw, 42px);
      width: 100%;
      max-width: 420px;
      box-shadow: 0 32px 90px rgba(0, 0, 0, .34), inset 0 1px rgba(255,255,255,.035);
      backdrop-filter: blur(22px) saturate(130%);
    }
    
    .login-header {
      text-align: center;
      margin-bottom: 30px;
    }
    
    .login-logo {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 70px;
      height: 62px;
      border-radius: 18px;
      background: linear-gradient(145deg, var(--surface-raised), var(--bg-card));
      border: 1px solid var(--border-light);
      color: white;
      overflow: hidden;
      margin-bottom: 18px;
      box-shadow: var(--shadow-soft), inset 0 1px rgba(255,255,255,.05);
    }

    .login-logo img {
      width: 58px;
      height: 42px;
      object-fit: contain;
    }

    .login-product-mark {
      width: fit-content;
      margin: -5px auto 11px;
      padding: 4px 10px;
      border-radius: 999px;
      background: var(--accent-glow);
      color: var(--accent-hover);
      font-size: 9px;
      font-weight: 900;
      letter-spacing: .14em;
    }
    
    .login-header h1 {
      font-size: 26px;
      font-weight: 740;
      letter-spacing: -.04em;
      color: var(--text-primary);
      margin: 0 0 8px 0;
    }
    
    .login-subtitle {
      color: var(--text-muted);
      font-size: 13px;
      line-height: 1.5;
      margin: 0;
    }
    
    .login-form {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    
    .form-group {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    
    .form-group label {
      font-size: 13px;
      font-weight: 500;
      color: var(--text-secondary);
    }
    
    .form-group input {
      min-height: 44px;
      padding: 10px 13px;
      border: 1px solid var(--border);
      border-radius: 10px;
      background: var(--bg-input);
      color: var(--text-primary);
      font-size: 14px;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    
    .form-group input:focus {
      outline: none;
      border-color: var(--accent);
      box-shadow: var(--ring);
    }
    
    .form-group input::placeholder {
      color: var(--text-muted);
    }
    
    .login-error {
      padding: 12px;
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid rgba(239, 68, 68, 0.3);
      border-radius: 10px;
      color: var(--danger);
      font-size: 13px;
      text-align: center;
    }
    
    .btn-login {
      min-height: 46px;
      padding: 12px 15px;
      font-size: 14px;
      font-weight: 680;
      margin-top: 8px;
    }

    .btn-google {
      background: #ffffff;
      color: #1f2937;
      border-color: #d1d5db;
      margin-top: 0;
      width: 100%;
      gap: 10px;
      box-shadow: 0 8px 24px rgba(0,0,0,.16);
    }

    .btn-google svg { width: 19px; height: 19px; flex: 0 0 auto; }

    .btn-google:hover {
      background: #f3f4f6;
      color: #111827;
    }

    .login-divider {
      display: flex;
      align-items: center;
      gap: 10px;
      color: var(--text-muted);
      font-size: 12px;
      margin: 2px 0;
    }

    .login-divider::before,
    .login-divider::after {
      content: "";
      height: 1px;
      flex: 1;
      background: var(--border);
    }
    
    .btn-login:disabled {
      opacity: 0.7;
      cursor: not-allowed;
    }

    .btn-login-alt {
      padding: 14px;
      font-size: 15px;
      font-weight: 600;
      margin-top: 4px;
    }

    .login-recovery-note {
      margin: 0 0 12px 0;
    }

    .login-recovery-note p {
      margin: 8px 0 0 0;
    }
    
    .login-footer {
      margin-top: 26px;
      padding-top: 18px;
      border-top: 1px solid color-mix(in srgb, var(--border) 74%, transparent);
      text-align: center;
    }
    
    .login-footer p {
      font-size: 12px;
      color: var(--text-muted);
      margin: 0;
    }

    @media (max-width: 480px) {
      .login-container { align-items: stretch; padding: 12px; }
      .login-card { align-self: center; border-radius: 16px; }
    }
  `;
  
  document.head.appendChild(style);
}
