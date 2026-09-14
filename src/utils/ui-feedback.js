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
    <button type="button" class="business-help" aria-label="${escapeHtml(title)}" data-help-title="${escapeHtml(title)}" data-help-description="${escapeHtml(description)}">
      <span aria-hidden="true">?</span>
    </button>
  `;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function initBusinessHelpTooltips() {
  let tooltip = null;
  let activeButton = null;

  const ensureTooltip = () => {
    if (tooltip) return tooltip;
    tooltip = document.createElement('div');
    tooltip.className = 'business-help-popover';
    tooltip.setAttribute('role', 'tooltip');
    tooltip.setAttribute('aria-hidden', 'true');
    tooltip.innerHTML = '<strong></strong><span></span>';
    document.body.appendChild(tooltip);
    return tooltip;
  };

  const hide = () => {
    if (!tooltip) return;
    tooltip.classList.remove('is-visible');
    tooltip.setAttribute('aria-hidden', 'true');
    if (activeButton) activeButton.removeAttribute('aria-describedby');
    activeButton = null;
  };

  const position = () => {
    if (!tooltip || !activeButton) return;
    const margin = 12;
    const buttonRect = activeButton.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const preferredTop = buttonRect.bottom + 10;
    const top = preferredTop + tooltipRect.height + margin <= window.innerHeight
      ? preferredTop
      : Math.max(margin, buttonRect.top - tooltipRect.height - 10);
    const left = clamp(
      buttonRect.left + buttonRect.width / 2 - tooltipRect.width / 2,
      margin,
      window.innerWidth - tooltipRect.width - margin
    );
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  };

  const show = button => {
    const title = button.dataset.helpTitle || button.getAttribute('aria-label') || 'Informação';
    const description = button.dataset.helpDescription || '';
    activeButton = button;
    const node = ensureTooltip();
    node.id = 'business-help-floating-tooltip';
    node.querySelector('strong').textContent = title;
    node.querySelector('span').textContent = description;
    button.setAttribute('aria-describedby', node.id);
    node.setAttribute('aria-hidden', 'false');
    node.classList.add('is-visible');
    position();
  };

  document.addEventListener('pointerover', event => {
    const button = event.target.closest?.('.business-help');
    if (button) show(button);
  });
  document.addEventListener('focusin', event => {
    const button = event.target.closest?.('.business-help');
    if (button) show(button);
  });
  document.addEventListener('pointerout', event => {
    if (event.target.closest?.('.business-help')) hide();
  });
  document.addEventListener('focusout', event => {
    if (event.target.closest?.('.business-help')) hide();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') hide();
  });
  window.addEventListener('scroll', position, true);
  window.addEventListener('resize', position);
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
    const previouslyFocused = document.activeElement;
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
      document.removeEventListener('keydown', handleKeydown);
      overlay.remove();
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
      resolve(value);
    };
    const handleKeydown = event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        finish(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [...overlay.querySelectorAll('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    overlay.addEventListener('click', event => {
      if (event.target === overlay) finish(false);
    });
    overlay.querySelector('[data-confirm-cancel]').addEventListener('click', () => finish(false));
    overlay.querySelector('[data-confirm-ok]').addEventListener('click', () => finish(true));
    document.addEventListener('keydown', handleKeydown);
    root.appendChild(overlay);
    overlay.querySelector('[data-confirm-ok]').focus();
  });
}
