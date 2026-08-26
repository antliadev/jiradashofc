/**
 * access.js - Gestao de usuarios e permissoes.
 */
import { ACCESS_ITEMS } from '../utils/access-control.js';
import { sanitize } from '../utils/helpers.js';
import { confirmAction, renderPageLoading, setButtonBusy, showToast } from '../utils/ui-feedback.js';

let users = [];
let selectedId = '';

function sessionHeaders() {
  return {
    'Content-Type': 'application/json',
    'x-session-id': localStorage.getItem('sessionId') || '',
  };
}

function roleLabel(role) {
  return {
    full: 'Full',
    master: 'Master',
    visualizacao: 'Visualizacao',
    personalizado: 'Personalizado',
    custom: 'Personalizado',
  }[role] || role;
}

function statusLabel(status) {
  return status === 'inactive' ? 'Inativo' : 'Ativo';
}

async function requestUsers() {
  const response = await fetch('/api/access/users', { headers: sessionHeaders(), credentials: 'include' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Nao foi possivel carregar usuarios.');
  users = data.users || [];
  selectedId = selectedId || users[0]?.id || '';
}

function currentUser() {
  return users.find(user => user.id === selectedId) || null;
}

function renderHeader() {
  document.getElementById('page-header').innerHTML = `
    <div>
      <h2>Gestao de Acessos</h2>
      <div class="subtitle">Usuarios, perfis e menus liberados</div>
    </div>
  `;
}

function renderUserList() {
  return `
    <section class="access-list">
      <div class="access-list-head">
        <h3>Usuarios</h3>
        <button class="btn btn-primary" id="new-access-user">Adicionar</button>
      </div>
      <div class="access-user-list">
        ${users.map(user => `
          <button class="access-user-card ${user.id === selectedId ? 'active' : ''}" data-user-id="${sanitize(user.id)}">
            <span>
              <strong>${sanitize(user.name)}</strong>
              <small>${sanitize(user.login)}</small>
            </span>
            <em class="${user.status === 'inactive' ? 'inactive' : ''}">${sanitize(roleLabel(user.role))} · ${sanitize(statusLabel(user.status))}</em>
          </button>
        `).join('') || '<p class="muted">Nenhum usuario cadastrado.</p>'}
      </div>
    </section>
  `;
}

function renderForm(user) {
  const isNew = !user;
  const role = user?.role || 'custom';
  const selectedPermissions = new Set(user?.permissions || []);
  return `
    <section class="access-editor">
      <div class="access-editor-head">
        <h3>${isNew ? 'Novo usuario' : 'Editar usuario'}</h3>
        ${!isNew ? '<button class="btn btn-secondary" id="revoke-access-user">Revogar acesso</button>' : ''}
      </div>
      <form id="access-form" class="access-form">
        <input type="hidden" id="access-id" value="${sanitize(user?.id || '')}">
        <label>Nome completo<input id="access-name" required value="${sanitize(user?.name || '')}"></label>
        <label>Login<input id="access-login" required value="${sanitize(user?.login || '')}"></label>
        <label>Senha provisoria<input id="access-password" type="password" ${isNew ? 'required' : ''} autocomplete="new-password" placeholder="${isNew ? 'Defina a senha inicial' : 'Preencher apenas para alterar'}"></label>
        <label>Perfil
          <select id="access-role">
            <option value="full" ${role === 'full' ? 'selected' : ''}>Acesso Full</option>
            <option value="master" ${role === 'master' ? 'selected' : ''}>Acesso Master</option>
            <option value="visualizacao" ${role === 'visualizacao' ? 'selected' : ''}>Acesso Visualizacao</option>
            <option value="personalizado" ${role === 'personalizado' || role === 'custom' ? 'selected' : ''}>Acesso Personalizado</option>
          </select>
        </label>
        <label>Status
          <select id="access-status">
            <option value="active" ${user?.status !== 'inactive' ? 'selected' : ''}>Ativo</option>
            <option value="inactive" ${user?.status === 'inactive' ? 'selected' : ''}>Inativo</option>
          </select>
        </label>

        <div class="access-permissions" id="access-permissions">
          <div class="access-permissions-head">
            <strong>Menus e submenus autorizados</strong>
            <span>Usado somente no perfil Personalizado</span>
          </div>
          <div class="access-permission-grid">
            ${ACCESS_ITEMS.map(item => `
              <label>
                <input type="checkbox" value="${sanitize(item.id)}" ${selectedPermissions.has(item.id) ? 'checked' : ''}>
                <span>${sanitize(item.label)}</span>
              </label>
            `).join('')}
          </div>
        </div>

        <div class="access-actions">
          <button class="btn btn-primary" type="submit">Salvar usuario</button>
          <button class="btn btn-secondary" type="button" id="cancel-access-edit">Cancelar</button>
        </div>
      </form>
      <div class="report-alert info">
        A senha provisoria definida pelo administrador permite o primeiro acesso imediato. Full acessa tudo e administra usuarios. Master acessa menus funcionais, sem Gestao de Acessos. Visualizacao tem acesso de leitura aos modulos liberados. Personalizado recebe apenas os menus marcados.
      </div>
    </section>
  `;
}

function renderAccessPage() {
  const content = document.getElementById('page-content');
  content.innerHTML = `
    <div class="report-page access-page">
      <div class="access-summary kpi-grid analyst-kpi-grid">
        <div class="kpi-card"><div class="kpi-value">${users.length}</div><div class="kpi-label">Usuarios cadastrados</div></div>
        <div class="kpi-card"><div class="kpi-value">${users.filter(user => user.status !== 'inactive').length}</div><div class="kpi-label">Ativos</div></div>
        <div class="kpi-card"><div class="kpi-value">${users.filter(user => user.role === 'full').length}</div><div class="kpi-label">Perfil Full</div></div>
        <div class="kpi-card"><div class="kpi-value">${users.filter(user => user.role === 'custom').length}</div><div class="kpi-label">Personalizados</div></div>
      </div>
      <div class="access-layout">
        ${renderUserList()}
        ${renderForm(currentUser())}
      </div>
    </div>
  `;
  bindAccessEvents();
}

function showError(message) {
  const content = document.getElementById('page-content');
  content.innerHTML = `
    <div class="empty-state">
      <h3>Gestao de acessos indisponivel</h3>
      <p>${sanitize(message)}</p>
      <button class="btn btn-primary" onclick="location.hash='#/'">Voltar ao Dashboard</button>
    </div>
  `;
}

function formPayload() {
  const role = document.getElementById('access-role')?.value || 'custom';
  return {
    name: document.getElementById('access-name')?.value || '',
    login: document.getElementById('access-login')?.value || '',
    password: document.getElementById('access-password')?.value || '',
    role,
    status: document.getElementById('access-status')?.value || 'active',
    permissions: [...document.querySelectorAll('#access-permissions input:checked')].map(input => input.value),
  };
}

async function saveUser(event) {
  event.preventDefault();
  const id = document.getElementById('access-id')?.value || '';
  const confirmed = await confirmAction({
    title: id ? 'Salvar alterações?' : 'Criar usuário?',
    message: id ? 'As permissões e o status deste usuário serão atualizados.' : 'O usuário poderá acessar o sistema conforme o perfil escolhido.',
    confirmLabel: 'Salvar'
  });
  if (!confirmed) return;

  const submitButton = document.querySelector('#access-form button[type="submit"]');
  setButtonBusy(submitButton, true, 'Salvando...');
  try {
    const response = await fetch(id ? `/api/access/users/${encodeURIComponent(id)}` : '/api/access/users', {
      method: id ? 'PUT' : 'POST',
      headers: sessionHeaders(),
      credentials: 'include',
      body: JSON.stringify(formPayload()),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Nao foi possivel salvar o usuario.');
    selectedId = data.user?.id || selectedId;
    await requestUsers();
    renderAccessPage();
    showToast(id ? 'Usuário atualizado.' : 'Usuário criado.', 'success');
  } catch (error) {
    setButtonBusy(submitButton, false);
    showToast(error.message, 'error');
  }
}

async function revokeSelectedUser() {
  if (!selectedId) return;
  const user = currentUser();
  const confirmed = await confirmAction({
    title: 'Revogar acesso?',
    message: `O acesso de ${user?.name || 'este usuário'} será desativado.`,
    confirmLabel: 'Revogar acesso',
    danger: true
  });
  if (!confirmed) return;

  const revokeButton = document.getElementById('revoke-access-user');
  setButtonBusy(revokeButton, true, 'Revogando...');
  try {
    const response = await fetch(`/api/access/users/${encodeURIComponent(selectedId)}`, {
      method: 'DELETE',
      headers: sessionHeaders(),
      credentials: 'include',
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Nao foi possivel revogar o acesso.');
    await requestUsers();
    renderAccessPage();
    showToast('Acesso revogado.', 'success');
  } catch (error) {
    setButtonBusy(revokeButton, false);
    showToast(error.message, 'error');
  }
}

function bindAccessEvents() {
  document.querySelectorAll('[data-user-id]').forEach(button => {
    button.addEventListener('click', () => {
      selectedId = button.dataset.userId;
      renderAccessPage();
    });
  });
  document.getElementById('new-access-user')?.addEventListener('click', () => {
    selectedId = '';
    const editor = document.querySelector('.access-editor');
    if (editor) editor.outerHTML = renderForm(null);
    bindAccessEvents();
  });
  document.getElementById('cancel-access-edit')?.addEventListener('click', renderAccessPage);
  document.getElementById('access-form')?.addEventListener('submit', saveUser);
  document.getElementById('revoke-access-user')?.addEventListener('click', revokeSelectedUser);
}

export async function renderAccessManagement() {
  renderHeader();
  document.getElementById('page-content').innerHTML = renderPageLoading('Carregando usuários');
  try {
    await requestUsers();
    renderAccessPage();
  } catch (error) {
    showError(error.message);
  }
}
