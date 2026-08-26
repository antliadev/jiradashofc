/**
 * data.js - Tela simplificada para visualização de status e sincronização Jira.
 *
 * Exibe a data da última sincronização, se foi bem-sucedida, informação da
 * rotina automática (todos os dias, a cada 30 minutos) e botão para sincronização manual.
 */
import { dataService } from '../data/data-service.js';
import { renderSidebar } from '../components/sidebar.js';
import { sanitize } from '../utils/helpers.js';
import { confirmAction, setButtonBusy, showToast } from '../utils/ui-feedback.js';

let syncStatus = null;
let pollingInterval = null;

const ACTIVE_SYNC_STATUSES = new Set(['queued', 'running']);
const POLLING_INTERVAL_MS = 3000;
const SYNC_TIMEOUT_MS = 20 * 60 * 1000;

function stopPolling({ clearJob = false } = {}) {
  if (pollingInterval) clearInterval(pollingInterval);
  pollingInterval = null;
  if (clearJob) sessionStorage.removeItem('activeSyncJobId');
}

function getJobAgeMs(status) {
  const stamp = status?.startedAt || status?.createdAt || status?.updatedAt;
  const started = stamp ? new Date(stamp).getTime() : 0;
  return started ? Date.now() - started : 0;
}

function hasSyncTimedOut(status) {
  return ACTIVE_SYNC_STATUSES.has(status?.status) && getJobAgeMs(status) > SYNC_TIMEOUT_MS;
}

function markSyncTimeout(status) {
  return {
    ...status,
    status: 'error',
    error: 'Tempo limite da sincronização atingido. Tente novamente.',
    logs: []
  };
}

export function renderData() {
  const header = document.getElementById('page-header');
  header.innerHTML = `
    <div>
      <h2>Importação de Dados</h2>
      <div class="subtitle">Status da sincronização automática e manual com o Jira</div>
    </div>
  `;

  loadInitialStatus();
}

async function loadInitialStatus() {
  const content = document.getElementById('page-content');
  content.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;

  const savedJobId = sessionStorage.getItem('activeSyncJobId');
  syncStatus = await dataService.getSyncStatus(savedJobId).catch(() => null);
  await dataService.ensureLoaded({ force: true }).then(() => renderSidebar()).catch(() => null);

  if (hasSyncTimedOut(syncStatus)) {
    syncStatus = markSyncTimeout(syncStatus);
    sessionStorage.removeItem('activeSyncJobId');
  } else if (syncStatus?.id && ACTIVE_SYNC_STATUSES.has(syncStatus.status)) {
    sessionStorage.setItem('activeSyncJobId', syncStatus.id);
    startPolling(syncStatus.id);
  }

  renderDataContent();
}

function startPolling(jobId) {
  stopPolling();

  pollingInterval = setInterval(async () => {
    try {
      syncStatus = await dataService.getSyncStatus(jobId);

      if (hasSyncTimedOut(syncStatus)) {
        syncStatus = markSyncTimeout(syncStatus);
        stopPolling({ clearJob: true });
      } else if (!syncStatus || !ACTIVE_SYNC_STATUSES.has(syncStatus.status)) {
        stopPolling({ clearJob: syncStatus?.status === 'success' || syncStatus?.status === 'error' });

        if (syncStatus?.status === 'success') {
          await dataService.ensureLoaded({ force: true });
          renderSidebar();
        }
      }

      if (window.location.hash.startsWith('#/data')) {
        renderDataContent();
      }
    } catch (error) {
      syncStatus = {
        status: 'error',
        error: error.message
      };
      renderDataContent();
      stopPolling({ clearJob: true });
    }
  }, POLLING_INTERVAL_MS);
}

function renderDataContent() {
  const content = document.getElementById('page-content');
  const metadata = dataService.getSyncMetadata();
  const isProcessing = ACTIVE_SYNC_STATUSES.has(syncStatus?.status);

  // Determinar status efetivo e última sincronização
  const effectiveStatus = isProcessing
    ? syncStatus.status
    : (syncStatus?.status || metadata.lastSyncStatus || 'idle');

  const rawLastSync = syncStatus?.finishedAt || metadata.lastSyncedAt || syncStatus?.startedAt || syncStatus?.createdAt;
  const lastSyncDate = rawLastSync ? new Date(rawLastSync) : null;
  const formattedLastSync = (lastSyncDate && !isNaN(lastSyncDate.getTime()))
    ? lastSyncDate.toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      })
    : 'Nenhuma sincronização realizada';

  const isSuccess = effectiveStatus === 'success';
  const isError = effectiveStatus === 'error';
  const errorMessage = syncStatus?.error || metadata.error || null;

  content.innerHTML = `
    <div class="sync-container">
      <!-- Banner informativo de agendamento automático -->
      <div class="auto-sync-banner">
        <div class="banner-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12 6 12 12 16 14"/>
          </svg>
        </div>
        <div class="banner-content">
          <strong>Sincronização Automática Ativa</strong>
          <p>Os dados são atualizados automaticamente <strong>a cada 30 minutos</strong>, <strong>todos os dias</strong>. O disparo pode variar alguns minutos conforme o agendador.</p>
        </div>
      </div>

      <!-- Card principal de status da sincronização -->
      <div class="sync-status-card ${isProcessing ? 'status-running' : isSuccess ? 'status-success' : isError ? 'status-error' : 'status-idle'}">
        <div class="status-indicator">
          ${isProcessing ? `
            <div class="status-icon-badge running">
              <span class="spinner" style="width: 28px; height: 28px; border-width: 3px;"></span>
            </div>
          ` : isSuccess ? `
            <div class="status-icon-badge success">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                <polyline points="22 4 12 14.01 9 11.01"/>
              </svg>
            </div>
          ` : isError ? `
            <div class="status-icon-badge error">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
            </div>
          ` : `
            <div class="status-icon-badge idle">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="8" x2="12.01" y2="8"/>
              </svg>
            </div>
          `}

          <div class="status-text-group">
            <span class="status-pill ${isProcessing ? 'pill-running' : isSuccess ? 'pill-success' : isError ? 'pill-error' : 'pill-idle'}">
              ${isProcessing ? 'Sincronizando no backend' : isSuccess ? 'Bem-sucedida' : isError ? 'Falha na sincronização' : 'Aguardando sincronização'}
            </span>
            <h3 class="status-title">
              ${isProcessing
                ? 'Sincronização em andamento...'
                : isSuccess
                  ? 'Sincronizado com sucesso'
                  : isError
                    ? 'Erro na sincronização'
                    : 'Nenhuma sincronização recente'}
            </h3>
          </div>
        </div>

        <div class="sync-info-row">
          <div class="info-block">
            <span class="info-label">Última sincronização</span>
            <strong class="info-value">${sanitize(formattedLastSync)}</strong>
          </div>
          <div class="info-block">
            <span class="info-label">Status</span>
            <strong class="info-value ${isSuccess ? 'text-success' : isError ? 'text-danger' : isProcessing ? 'text-accent' : ''}">
              ${isProcessing ? 'Processando' : isSuccess ? 'Concluída com sucesso' : isError ? 'Falhou' : 'Pendente'}
            </strong>
          </div>
        </div>

        ${isError && errorMessage ? `
          <div class="sync-error-box">
            <strong>Detalhe do erro:</strong>
            <p>${sanitize(errorMessage)}</p>
          </div>
        ` : ''}

        <!-- Botão para sincronização manual -->
        <div class="sync-action-container">
          <button class="btn btn-primary btn-sync" id="btn-start-sync" ${isProcessing ? 'disabled' : ''}>
            ${isProcessing
              ? '<span class="spinner" style="width: 16px; height: 16px; border-width: 2px; margin-right: 8px;"></span> Sincronizando dados...'
              : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px;"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg> Iniciar sincronização manual'}
          </button>
        </div>
      </div>
    </div>
  `;

  addDataStyles();
  setupEventListeners();
}

function setupEventListeners() {
  document.getElementById('btn-start-sync')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-start-sync');
    if (!btn || btn.disabled || ACTIVE_SYNC_STATUSES.has(syncStatus?.status)) return;

    const confirmed = await confirmAction({
      title: 'Iniciar sincronização?',
      message: 'Os dados atuais serão atualizados com as informações disponíveis no Jira.',
      confirmLabel: 'Sincronizar'
    });
    if (!confirmed) return;

    setButtonBusy(btn, true, 'Iniciando...');

    try {
      const result = await dataService.startJiraSyncFromEnv();
      syncStatus = result.job || {
        id: result.jobId,
        status: 'queued',
        logs: []
      };

      if (result.jobId) {
        sessionStorage.setItem('activeSyncJobId', result.jobId);
        startPolling(result.jobId);
      }

      renderDataContent();
      showToast('Sincronização iniciada.', 'success');
    } catch (error) {
      syncStatus = {
        status: 'error',
        error: error.message
      };
      stopPolling({ clearJob: true });
      renderDataContent();
      showToast(error.message || 'Não foi possível iniciar a sincronização.', 'error');
    }
  });
}

function addDataStyles() {
  if (document.getElementById('data-sync-styles')) return;

  const style = document.createElement('style');
  style.id = 'data-sync-styles';
  style.textContent = `
    .sync-container {
      max-width: 640px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 24px;
    }

    .auto-sync-banner {
      display: flex;
      gap: 16px;
      align-items: center;
      padding: 16px 20px;
      background: color-mix(in srgb, var(--accent) 8%, var(--surface));
      border: 1px solid color-mix(in srgb, var(--accent) 25%, var(--border));
      border-radius: 12px;
    }

    .banner-icon {
      flex-shrink: 0;
      width: 42px;
      height: 42px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: color-mix(in srgb, var(--accent) 15%, transparent);
      border-radius: 10px;
      color: var(--accent);
    }

    .banner-content strong {
      display: block;
      font-size: 14px;
      color: var(--text-primary);
      margin-bottom: 3px;
    }

    .banner-content p {
      margin: 0;
      font-size: 13px;
      color: var(--text-secondary);
      line-height: 1.45;
    }

    .sync-status-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 28px;
      display: flex;
      flex-direction: column;
      gap: 24px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
      position: relative;
      overflow: hidden;
    }

    .sync-status-card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 4px;
      background: var(--border);
    }

    .sync-status-card.status-success::before {
      background: #10b981;
    }

    .sync-status-card.status-error::before {
      background: #ef4444;
    }

    .sync-status-card.status-running::before {
      background: var(--accent);
    }

    .status-indicator {
      display: flex;
      align-items: center;
      gap: 18px;
    }

    @media (max-width: 480px) {
      .status-indicator { align-items: flex-start; flex-wrap: wrap; gap: 12px; }
      .status-text-group { min-width: 0; flex: 1 1 180px; }
      .status-title { overflow-wrap: anywhere; font-size: 16px; }
    }

    .status-icon-badge {
      width: 56px;
      height: 56px;
      border-radius: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .status-icon-badge.success {
      background: rgba(16, 185, 129, 0.12);
      color: #10b981;
    }

    .status-icon-badge.error {
      background: rgba(239, 68, 68, 0.12);
      color: #ef4444;
    }

    .status-icon-badge.running {
      background: color-mix(in srgb, var(--accent) 12%, transparent);
      color: var(--accent);
    }

    .status-icon-badge.idle {
      background: color-mix(in srgb, var(--text-muted) 12%, transparent);
      color: var(--text-muted);
    }

    .status-text-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .status-pill {
      display: inline-flex;
      align-items: center;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      padding: 3px 10px;
      border-radius: 20px;
      width: fit-content;
    }

    .status-pill.pill-success {
      background: rgba(16, 185, 129, 0.15);
      color: #10b981;
    }

    .status-pill.pill-error {
      background: rgba(239, 68, 68, 0.15);
      color: #ef4444;
    }

    .status-pill.pill-running {
      background: color-mix(in srgb, var(--accent) 15%, transparent);
      color: var(--accent);
    }

    .status-pill.pill-idle {
      background: color-mix(in srgb, var(--text-muted) 15%, transparent);
      color: var(--text-muted);
    }

    .status-title {
      margin: 0;
      font-size: 18px;
      font-weight: 600;
      color: var(--text-primary);
    }

    .sync-info-row {
      display: grid;
      grid-template-columns: 1.4fr 1fr;
      gap: 16px;
      padding: 16px;
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 10px;
    }

    .info-block {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .info-label {
      font-size: 12px;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.4px;
    }

    .info-value {
      font-size: 15px;
      font-weight: 600;
      color: var(--text-primary);
    }

    .text-success { color: #10b981 !important; }
    .text-danger { color: #ef4444 !important; }
    .text-accent { color: var(--accent) !important; }

    .sync-error-box {
      background: rgba(239, 68, 68, 0.08);
      border: 1px solid rgba(239, 68, 68, 0.25);
      border-radius: 8px;
      padding: 14px;
      font-size: 13px;
      color: #ef4444;
    }

    .sync-error-box strong {
      display: block;
      margin-bottom: 4px;
    }

    .sync-error-box p {
      margin: 0;
      word-break: break-word;
    }

    .sync-action-container {
      margin-top: 4px;
    }

    .btn-sync {
      width: 100%;
      min-height: 46px;
      font-size: 14px;
      font-weight: 600;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    @media (max-width: 480px) {
      .sync-info-row {
        grid-template-columns: 1fr;
      }
    }
  `;

  document.head.appendChild(style);
}
