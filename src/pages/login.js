/**
 * login.js — Página de Login
 */
import { sanitize } from '../utils/helpers.js';
export function renderLogin() {
  const content = document.getElementById('page-content');
  document.getElementById('page-header')?.replaceChildren();
  window.updateLayout?.(false);
  const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
  const recoveryRequested = params.get('recovery') === '1';
  const recoveryState = readRecoveryState();
  const authError = readAuthError();
  const recoveryMode = recoveryRequested || Boolean(recoveryState.accessToken || recoveryState.error);
  const recoveryError = recoveryState.error ? formatRecoveryError(recoveryState) : '';
  
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
          <div class="login-form">
            <button type="button" class="btn btn-primary btn-login btn-google" id="google-login-btn">
              Entrar com Google
            </button>
            <div class="login-divider"><span>ou use senha provisoria</span></div>
          </div>
          <form id="login-form" class="login-form">
            <div class="form-group">
              <label for="login-email">Email</label>
              <input 
                type="email" 
                id="login-email" 
                name="email" 
                placeholder="seu.nome@antlia.com.br"
                required
                autocomplete="email"
              >
            </div>
            
            <div class="form-group">
              <label for="login-password">Senha</label>
              <input 
                type="password" 
                id="login-password" 
                name="password" 
                placeholder="••••••••"
                required
                autocomplete="current-password"
              >
            </div>
            
            <div id="login-error" class="login-error" style="${authError ? '' : 'display: none;'}">${sanitize(authError)}</div>
            
            <button type="submit" class="btn btn-primary btn-login" id="login-btn">
              Entrar
            </button>
          </form>
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
  const errorDiv = document.getElementById('login-error');
  clearAuthError();

  if (recoveryMode) {
    const backButton = document.getElementById('back-to-login-btn');

    backButton?.addEventListener('click', () => {
      clearRecoveryState();
      window.location.hash = '#/login';
    });
    return;
  }

  const btn = document.getElementById('login-btn');
  const googleBtn = document.getElementById('google-login-btn');
  const form = document.getElementById('login-form');
  googleBtn?.addEventListener('click', startGoogleLogin);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    
    errorDiv.style.display = 'none';
    btn.disabled = true;
    btn.textContent = 'Entrando...';
    
    try {
      const response = await fetch('/api/auth', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email, password })
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Erro ao fazer login');
      }
      
      if (window.setSessionUser) {
        window.setSessionUser(data.user || null);
      }
      if (window.markAuthenticated) {
        window.markAuthenticated(data.user || null);
      }
      
      if (window.updateLayout) {
        window.updateLayout(true);
      }
      
      // O destino inicial deve respeitar exatamente os acessos configurados
      // para o usuario, em vez de assumir que todos possuem acesso a Home.
      const { firstAllowedRoute } = await import('../utils/access-control.js');
      window.location.hash = `#${firstAllowedRoute(data.user || null)}`;
      
    } catch (err) {
      errorDiv.textContent = err.message;
      errorDiv.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Entrar';
    }
  });
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
      padding: 20px;
      background:
        radial-gradient(circle at 20% 15%, var(--accent-glow), transparent 34%),
        linear-gradient(135deg, var(--bg-primary) 0%, var(--bg-secondary) 100%);
    }
    
    .login-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 40px;
      width: 100%;
      max-width: 400px;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
    }
    
    .login-header {
      text-align: center;
      margin-bottom: 32px;
    }
    
    .login-logo {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 74px;
      height: 64px;
      border-radius: 16px;
      background: rgba(255,255,255,.04);
      border: 1px solid var(--border);
      color: white;
      overflow: hidden;
      margin-bottom: 16px;
    }

    .login-logo img {
      width: 58px;
      height: 42px;
      object-fit: contain;
    }

    .login-product-mark {
      width: fit-content;
      margin: -4px auto 10px auto;
      padding: 4px 9px;
      border-radius: 999px;
      background: var(--accent-glow);
      color: var(--accent-hover);
      font-size: 11px;
      font-weight: 900;
      letter-spacing: .14em;
    }
    
    .login-header h1 {
      font-size: 24px;
      font-weight: 600;
      color: var(--text-primary);
      margin: 0 0 8px 0;
    }
    
    .login-subtitle {
      color: var(--text-muted);
      font-size: 14px;
      margin: 0;
    }
    
    .login-form {
      display: flex;
      flex-direction: column;
      gap: 20px;
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
      padding: 12px 16px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--bg-input);
      color: var(--text-primary);
      font-size: 14px;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    
    .form-group input:focus {
      outline: none;
      border-color: #6366f1;
      box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.15);
    }
    
    .form-group input::placeholder {
      color: var(--text-muted);
    }
    
    .login-error {
      padding: 12px;
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid rgba(239, 68, 68, 0.3);
      border-radius: 8px;
      color: #ef4444;
      font-size: 13px;
      text-align: center;
    }
    
    .btn-login {
      padding: 14px;
      font-size: 15px;
      font-weight: 600;
      margin-top: 8px;
    }

    .btn-google {
      background: #ffffff;
      color: #1f2937;
      border-color: #d1d5db;
      margin-top: 0;
      width: 100%;
    }

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
      margin-top: 24px;
      text-align: center;
    }
    
    .login-footer p {
      font-size: 12px;
      color: var(--text-muted);
      margin: 0;
    }
  `;
  
  document.head.appendChild(style);
}
