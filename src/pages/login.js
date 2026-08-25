/**
 * login.js — Página de Login
 */
export function renderLogin() {
  const content = document.getElementById('page-content');
  
  content.innerHTML = `
    <div class="login-container">
      <div class="login-card">
        <div class="login-header">
          <div class="login-logo">
            <img src="/antlia-logo.png" alt="">
          </div>
          <div class="login-product-mark">RJA</div>
          <h1>Radar Jira Antlia</h1>
          <p class="login-subtitle">Faça login para acessar o painel</p>
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
          
          <div id="login-error" class="login-error" style="display: none;"></div>
          
          <button type="submit" class="btn btn-primary btn-login" id="login-btn">
            Entrar
          </button>
        </form>
        
        <div class="login-footer">
          <p>Acesso restrito a usuários autorizados</p>
        </div>
      </div>
    </div>
  `;
  
  // Adicionar estilos específicos do login
  addLoginStyles();
  
  // Configurar o formulário
  const form = document.getElementById('login-form');
  const errorDiv = document.getElementById('login-error');
  const btn = document.getElementById('login-btn');
  
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    
    // Resetar erro
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
      
      // Atualizar layout para mostrar sidebar
      if (window.updateLayout) {
        window.updateLayout(true);
      }
      
      // Redirecionar para dashboard
      window.location.hash = '#/';
      
    } catch (err) {
      errorDiv.textContent = err.message;
      errorDiv.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Entrar';
    }
  });
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
    
    .btn-login:disabled {
      opacity: 0.7;
      cursor: not-allowed;
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
