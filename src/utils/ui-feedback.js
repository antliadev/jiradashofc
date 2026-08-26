const FEEDBACK_ROOT_ID = 'ui-feedback-root';

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[character]));
}

export function businessHelp(title, description) {
  return `
    <button type="button" class="business-help" aria-label="${escapeHtml(title)}">
      <span aria-hidden="true">?</span>
      <span class="business-help-popover" role="tooltip"><strong>${escapeHtml(title)}</strong>${escapeHtml(description)}</span>
    </button>
  `;
}

function getFeedbackRoot() {
  let root = document.getElementById(FEEDBACK_ROOT_ID);
  if (!root) {
    root = document.createElement('div');
    root.id = FEEDBACK_ROOT_ID;
    root.className = 'ui-feedback-root';
    document.body.appendChild(root);
  }
  return root;
}

export function renderPageLoading(message = 'Carregando tela') {
  return `
    <div class="page-loading" role="status" aria-live="polite">
      <span class="spinner" aria-hidden="true"></span>
      <strong>${message}</strong>
      <span>Aguarde um instante</span>
    </div>
  `;
}

export function setButtonBusy(button, busy, label = 'Processando...') {
  if (!button) return;
  if (busy) {
    button.dataset.defaultLabel = button.innerHTML;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.innerHTML = `<span class="spinner spinner-inline" aria-hidden="true"></span>${label}`;
  } else {
    button.disabled = false;
    button.removeAttribute('aria-busy');
    if (button.dataset.defaultLabel) button.innerHTML = button.dataset.defaultLabel;
  }
}

export function showToast(message, type = 'info') {
  const root = getFeedbackRoot();
  const toast = document.createElement('div');
  toast.className = `ui-toast ui-toast-${type}`;
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
  toast.innerHTML = '<span></span><button type="button" aria-label="Fechar notificação">&times;</button>';
  toast.querySelector('span').textContent = String(message || '');
  const close = () => toast.remove();
  toast.querySelector('button').addEventListener('click', close);
  root.appendChild(toast);
  window.setTimeout(close, 4500);
  return close;
}

export function confirmAction({ title = 'Confirmar ação', message, confirmLabel = 'Confirmar', danger = false } = {}) {
  return new Promise(resolve => {
    const root = getFeedbackRoot();
    const overlay = document.createElement('div');
    overlay.className = 'ui-modal-backdrop';
    overlay.innerHTML = `
      <section class="ui-modal" role="dialog" aria-modal="true" aria-labelledby="ui-modal-title">
        <div class="ui-modal-icon ${danger ? 'danger' : ''}" aria-hidden="true">${danger ? '!' : '?'}</div>
        <div class="ui-modal-body">
          <h2 id="ui-modal-title"></h2>
          <p></p>
        </div>
        <div class="ui-modal-actions">
          <button type="button" class="btn btn-secondary" data-confirm-cancel>Cancelar</button>
          <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-confirm-ok></button>
        </div>
      </section>
    `;
    overlay.querySelector('#ui-modal-title').textContent = String(title);
    overlay.querySelector('.ui-modal-body p').textContent = String(message || 'Deseja continuar com esta ação?');
    overlay.querySelector('[data-confirm-ok]').textContent = String(confirmLabel);

    const finish = value => {
      overlay.remove();
      resolve(value);
    };
    overlay.addEventListener('click', event => {
      if (event.target === overlay) finish(false);
    });
    overlay.querySelector('[data-confirm-cancel]').addEventListener('click', () => finish(false));
    overlay.querySelector('[data-confirm-ok]').addEventListener('click', () => finish(true));
    root.appendChild(overlay);
    overlay.querySelector('[data-confirm-ok]').focus();
  });
}
