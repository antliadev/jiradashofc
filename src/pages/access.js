/**
 * access.js - Gestao de usuarios e permissoes.
 */
import {
  ACCESS_MODULES,
  ACCESS_PROFILES,
  accessLevelSymbol,
  normalizeAccessProfile,
  profileByCode,
} from '../../shared/access-rbac.js';
import { sanitize } from '../utils/helpers.js';
import { confirmAction, renderPageLoading, setButtonBusy, showToast } from '../utils/ui-feedback.js';

let users = [];
let profiles = ACCESS_PROFILES.map(profile => ({ ...profile, permissions: [], allowedModules: [], blockedModules: [], userCount: 0 }));
let selectedId = '';
let selectedProfileCode = 'dev_qa';
let activeTab = 'users';
let creatingProfile = false;

function sessionHeaders() {
  return {
    'Content-Type': 'application/json',
    'x-session-id': localStorage.getItem('sessionId') || '',
  };
}

function roleLabel(role) {
  return profileByCode(role).name;
}

function statusLabel(status) {
  return status === 'inactive' ? 'Inativo' : 'Ativo';
}

async function requestUsers() {
  const [usersResponse, profilesResponse] = await Promise.all([
    fetch('/api/access/users', { headers: sessionHeaders(), credentials: 'include' }),
    fetch('/api/access/profiles', { headers: sessionHeaders(), credentials: 'include' }),
  ]);
  const usersData = await usersResponse.json().catch(() => ({}));
  const profilesData = await profilesResponse.json().catch(() => ({}));
  if (!usersResponse.ok) throw new Error(usersData.error || 'Nao foi possivel carregar usuarios.');
  if (!profilesResponse.ok) throw new Error(profilesData.error || 'Nao foi possivel carregar perfis.');
  users = usersData.users || [];
  profiles = profilesData.profiles?.length ? profilesData.profiles : profiles;
  selectedId = selectedId || users[0]?.id || '';
  selectedProfileCode = selectedProfileCode || profiles[0]?.code || 'dev_qa';
}

function currentUser() {
  return users.find(user => user.id === selectedId) || null;
}

function renderHeader() {
  document.getElementById('page-header').innerHTML = `
    <div>
      <h2>Gestao de Acessos</h2>
      <div class="subtitle">Usuarios vinculados a perfis centralizados de permissao</div>
    </div>
  `;
}

function displayName(user) {
  if (!user) return '';
  if (user.pendingFirstLogin) return user.name && user.name !== user.login ? user.name : 'Aguardando primeiro login';
  return user.name || user.login;
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
              <strong>${sanitize(displayName(user))}</strong>
              <small>${sanitize(user.login)}</small>
            </span>
            <em class="${user.status === 'inactive' ? 'inactive' : ''}">${sanitize(roleLabel(user.role))} · ${sanitize(statusLabel(user.status))}${user.pendingFirstLogin ? ' · Aguardando login Google' : ''}</em>
          </button>
        `).join('') || '<p class="muted">Nenhum usuario cadastrado.</p>'}
      </div>
    </section>
  `;
}

function renderForm(user) {
  const isNew = !user;
  const role = normalizeAccessProfile(user?.role || selectedProfileCode || 'dev_qa');
  const inheritedPermissions = ACCESS_MODULES.map(item => ({
    ...item,
    level: item.levels?.[role] || 'deny',
  }));
  return `
    <section class="access-editor">
      <div class="access-editor-head">
        <h3>${isNew ? 'Novo usuario' : 'Editar usuario'}</h3>
        ${!isNew ? '<button class="btn btn-secondary" id="revoke-access-user">Excluir acesso</button>' : ''}
      </div>
      <form id="access-form" class="access-form">
        <input type="hidden" id="access-id" value="${sanitize(user?.id || '')}">
        <label>E-mail Google autorizado<input id="access-login" type="email" required value="${sanitize(user?.login || '')}" placeholder="nome@antlia.com.br" autocomplete="email"></label>
        <label>Perfil de acesso
          <select id="access-role">
            ${profiles.map(profile => `<option value="${sanitize(profile.code)}" ${role === profile.code ? 'selected' : ''}>${sanitize(profile.name)}</option>`).join('')}
          </select>
        </label>
        <label>Status
          <select id="access-status">
            <option value="active" ${user?.status !== 'inactive' ? 'selected' : ''}>Ativo</option>
            <option value="inactive" ${user?.status === 'inactive' ? 'selected' : ''}>Inativo</option>
          </select>
        </label>

        ${!isNew ? `
          <div class="access-user-summary">
            <strong>${sanitize(displayName(user))}</strong>
            <span>${sanitize(user.login)}</span>
            <em>Perfil: ${sanitize(roleLabel(role))}</em>
            <em>Status: ${sanitize(statusLabel(user.status))}</em>
          </div>
        ` : ''}

        <div class="access-permissions inherited" id="access-permissions">
          <div class="access-permissions-head">
            <strong>Permissões herdadas do perfil</strong>
            <span>Consulta apenas. Para alterar, edite o perfil em Perfis.</span>
          </div>
          <div class="access-permission-table">
            ${inheritedPermissions.map(item => `
              <div class="access-permission-row ${sanitize(item.level)}">
                <span>${sanitize(item.module)}</span>
                <span>${sanitize(item.submodule)}</span>
                <strong>${sanitize(accessLevelSymbol(item.level))}</strong>
              </div>
            `).join('')}
          </div>
        </div>

        <div class="access-actions">
          <button class="btn btn-primary" type="submit">Salvar acesso</button>
          <button class="btn btn-secondary" type="button" id="cancel-access-edit">Cancelar</button>
        </div>
      </form>
      <div class="report-alert info">
        Cadastre apenas o e-mail, o perfil e o status. O nome sera preenchido automaticamente no primeiro login Google. As permissoes sao herdadas do perfil e validadas tambem nas APIs.
      </div>
    </section>
  `;
}

function renderProfiles() {
  const selectedProfile = creatingProfile ? null : (profiles.find(profile => profile.code === selectedProfileCode) || profiles[0]);
  const permissions = selectedProfile?.permissions?.length
    ? selectedProfile.permissions
    : ACCESS_MODULES.map(item => ({
      ...item,
      level: creatingProfile ? 'deny' : (item.levels?.[selectedProfile?.code || 'dev_qa'] || 'deny'),
    }));
  const selectedPermissionCodes = new Set(permissions.filter(item => item.level === 'allow' || item.level === 'partial').map(item => item.code));
  return `
    <section class="access-list">
      <div class="access-list-head">
        <h3>Perfis</h3>
      </div>
      <div class="access-user-list">
        ${profiles.map(profile => `
          <button class="access-user-card ${profile.code === selectedProfileCode ? 'active' : ''}" data-profile-code="${sanitize(profile.code)}">
            <span>
              <strong>${sanitize(profile.name)}</strong>
              <small>${sanitize(profile.description || '')}</small>
            </span>
            <em>${profile.userCount || 0} usuario(s) vinculado(s)</em>
          </button>
        `).join('')}
      </div>
    </section>
    <section class="access-editor">
      <div class="access-editor-head">
        <h3>${creatingProfile ? 'Novo perfil' : sanitize(selectedProfile?.name || 'Perfil')}</h3>
        ${creatingProfile ? '' : `<span class="badge badge-info">${selectedProfile?.userCount || 0} usuario(s)</span>`}
      </div>
      <form id="access-profile-form" class="access-form">
        <label>Nome do perfil<input id="access-profile-name" required value="${sanitize(selectedProfile?.name || '')}" placeholder="Ex.: Financeiro"></label>
        <label>Descrição<input id="access-profile-description" value="${sanitize(selectedProfile?.description || '')}" placeholder="Resumo do objetivo do perfil"></label>
        <input type="hidden" id="access-profile-code" value="${sanitize(selectedProfile?.code || '')}">
      </form>
      <div class="access-profile-stats">
        <article><strong>${permissions.filter(item => item.level === 'allow').length}</strong><span>permitidos</span></article>
        <article><strong>${permissions.filter(item => item.level === 'partial').length}</strong><span>parciais</span></article>
        <article><strong>${permissions.filter(item => item.level === 'deny').length}</strong><span>bloqueados</span></article>
      </div>
      <div class="access-permissions">
        <div class="access-permissions-head">
          <strong>Matriz de permissões</strong>
          <span>S = acesso · P = parcial · — = sem acesso</span>
        </div>
        <div class="access-permission-table">
          ${ACCESS_MODULES.map(item => {
            const current = permissions.find(permission => permission.code === item.code);
            const level = current?.level || 'deny';
            return `
            <div class="access-permission-row ${sanitize(level)}">
              <label class="access-permission-check">
                <input type="checkbox" value="${sanitize(item.code)}" ${selectedPermissionCodes.has(item.code) ? 'checked' : ''}>
                <span>${sanitize(item.module)}</span>
              </label>
              <span>${sanitize(item.submodule)}</span>
              <strong>${sanitize(accessLevelSymbol(level))}</strong>
            </div>
          `; }).join('')}
        </div>
      </div>
      <div class="access-actions">
        <button class="btn btn-primary" type="button" id="save-access-profile">Salvar perfil</button>
      </div>
      <div class="report-alert info">
        Alterar uma permissão do perfil atualiza automaticamente todos os usuários vinculados a ele, sem edição individual por pessoa.
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
        <div class="kpi-card"><div class="kpi-value">${profiles.length}</div><div class="kpi-label">Perfis</div></div>
        <div class="kpi-card"><div class="kpi-value">${users.filter(user => user.pendingFirstLogin).length}</div><div class="kpi-label">Aguardando login</div></div>
      </div>
      <div class="access-tabs">
        <button class="btn ${activeTab === 'users' ? 'btn-primary' : 'btn-secondary'}" data-access-tab="users">Usuários</button>
        <button class="btn ${activeTab === 'profiles' ? 'btn-primary' : 'btn-secondary'}" data-access-tab="profiles">Perfis</button>
      </div>
      <div class="access-layout">
        ${activeTab === 'profiles' ? renderProfiles() : `${renderUserList()}${renderForm(currentUser())}`}
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
    login: document.getElementById('access-login')?.value || '',
    role,
    status: document.getElementById('access-status')?.value || 'active',
  };
}

async function saveUser(event) {
  event.preventDefault();
  const id = document.getElementById('access-id')?.value || '';
  const confirmed = await confirmAction({
    title: id ? 'Salvar alterações?' : 'Criar usuário?',
    message: id ? 'O perfil e o status deste acesso serão atualizados.' : 'Este e-mail poderá acessar o sistema com Google conforme o perfil escolhido.',
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
    title: 'Excluir acesso?',
    message: `O acesso de ${user?.name || 'este usuário'} será removido. Se houver uma sessao ativa, ela sera encerrada na proxima validacao do app.`,
    confirmLabel: 'Excluir acesso',
    danger: true
  });
  if (!confirmed) return;

  const revokeButton = document.getElementById('revoke-access-user');
  setButtonBusy(revokeButton, true, 'Excluindo...');
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
    showToast('Acesso excluido.', 'success');
  } catch (error) {
    setButtonBusy(revokeButton, false);
    showToast(error.message, 'error');
  }
}

async function saveProfile() {
  const code = document.getElementById('access-profile-code')?.value || '';
  const payload = {
    name: document.getElementById('access-profile-name')?.value || '',
    description: document.getElementById('access-profile-description')?.value || '',
    permissions: [...document.querySelectorAll('.access-permission-check input:checked')].map(input => input.value),
  };
  const confirmed = await confirmAction({
    title: code ? 'Salvar perfil?' : 'Criar perfil?',
    message: 'Todos os usuários vinculados a este perfil passarão a usar esta configuração de permissões.',
    confirmLabel: 'Salvar'
  });
  if (!confirmed) return;

  const button = document.getElementById('save-access-profile');
  setButtonBusy(button, true, 'Salvando...');
  try {
    const response = await fetch(code ? `/api/access/profiles/${encodeURIComponent(code)}` : '/api/access/profiles', {
      method: code ? 'PUT' : 'POST',
      headers: sessionHeaders(),
      credentials: 'include',
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Nao foi possivel salvar o perfil.');
    creatingProfile = false;
    selectedProfileCode = data.profile?.code || selectedProfileCode;
    await requestUsers();
    renderAccessPage();
    showToast(code ? 'Perfil atualizado.' : 'Perfil criado.', 'success');
  } catch (error) {
    setButtonBusy(button, false);
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
  document.querySelectorAll('[data-profile-code]').forEach(button => {
    button.addEventListener('click', () => {
      creatingProfile = false;
      selectedProfileCode = button.dataset.profileCode;
      renderAccessPage();
    });
  });
  document.querySelectorAll('[data-access-tab]').forEach(button => {
    button.addEventListener('click', () => {
      activeTab = button.dataset.accessTab || 'users';
      creatingProfile = false;
      renderAccessPage();
    });
  });
  document.getElementById('new-access-profile')?.addEventListener('click', () => {
    creatingProfile = true;
    renderAccessPage();
  });
  document.getElementById('save-access-profile')?.addEventListener('click', saveProfile);
  document.getElementById('cancel-access-profile')?.addEventListener('click', () => {
    creatingProfile = false;
    renderAccessPage();
  });
  document.getElementById('new-access-user')?.addEventListener('click', () => {
    selectedId = '';
    activeTab = 'users';
    const editor = document.querySelector('.access-editor');
    if (editor) editor.outerHTML = renderForm(null);
    bindAccessEvents();
  });
  document.getElementById('cancel-access-edit')?.addEventListener('click', renderAccessPage);
  document.getElementById('access-form')?.addEventListener('submit', saveUser);
  document.getElementById('revoke-access-user')?.addEventListener('click', revokeSelectedUser);
  document.getElementById('access-role')?.addEventListener('change', event => {
    selectedProfileCode = event.target.value;
    const id = document.getElementById('access-id')?.value || '';
    if (!id) {
      const editor = document.querySelector('.access-editor');
      if (editor) editor.outerHTML = renderForm(null);
      bindAccessEvents();
      return;
    }
    const user = currentUser();
    if (user) {
      const editor = document.querySelector('.access-editor');
      if (editor) editor.outerHTML = renderForm({ ...user, role: event.target.value });
      bindAccessEvents();
    }
  });
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
