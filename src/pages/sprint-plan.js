import '../styles/sprint-plan.css';
import { sanitize } from '../utils/helpers.js';
import { showToast } from '../utils/ui-feedback.js';
import { exportSprintPlanSlides, renderSprintPlanSlides } from '../utils/sprint-plan-render.js';

const esc = value => sanitize(String(value ?? ''));
const opt = (rows, selected, value = 'id', label = 'name') => rows.map(row => `<option value="${esc(row[value])}" ${String(row[value]) === String(selected) ? 'selected' : ''}>${esc(row[label])}</option>`).join('');
const originLabels = { carry_over: 'Continuidade', replanned_before_close: 'Replanejado', new_planned: 'Novo item' };
const itemOrigin = item => item.origin || item.primaryOrigin || item.originPrimary || 'new';
const itemTitle = item => item.title || item.summary || item.key || 'Item sem titulo';
const itemLabel = item => `${item.issueKey || item.key || '—'} — ${itemTitle(item)}`;
const planItems = plan => plan?.items || [];
const CONTEXT_STORAGE_KEY = 'rja.sprintPlan.context';

export async function renderSprintPlan() {
  const root = document.getElementById('page-content');
  const header = document.getElementById('page-header');
  if (!root || !header) return;
  header.innerHTML = '<h1>Sprint Plan</h1><p class="subtitle">Planejamento da sprint atual, continuidades e novo escopo</p>';
  const controller = new AbortController();
  const state = { projects: [], boards: [], sprints: [], types: [], fields: [], profile: null, canConfigure: false, projectKey: '', boardId: '', sprintId: '', plan: null, sourceId: '', snapshots: [], acceptedWarnings: [], busy: false, error: '', tab: 'continuities', analysisJob: null, aiStatus: { configured: false } };
  let alive = true;
  window.addEventListener('hashchange', () => { alive = false; controller.abort(); }, { once: true });

  async function api(path, data, method = 'GET', options = {}) {
    const query = new URLSearchParams({ projectKey: state.projectKey, boardId: state.boardId, sprintId: state.sprintId });
    const response = await fetch(`/api/jira/sprint-plan${path}${method === 'GET' ? `?${query}` : ''}`, { method, credentials: 'include', signal: options.signal === false ? undefined : controller.signal, headers: { 'Content-Type': 'application/json' }, ...(method === 'GET' ? {} : { body: JSON.stringify({ projectKey: state.projectKey, boardId: state.boardId, sprintId: state.sprintId, ...data }) }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = [payload.error, ...(payload.preflight?.errors || []).map(e => e.message), ...(payload.warnings || []).map(w => w.message)].filter(Boolean).join(' ');
      throw new Error(detail || `Falha HTTP ${response.status}.`);
    }
    return payload;
  }
  async function run(work) {
    if (state.busy) return;
    state.busy = true; state.error = ''; draw();
    try { await work(); } catch (error) { if (alive) state.error = error.message; }
    finally { state.busy = false; if (alive) draw(); }
  }
  function metric(name, fallback = 0) { return state.plan?.metrics?.[name] ?? fallback; }
  function kpis() {
    return [
      ['Compromisso inicial', metric('planned', planItems(state.plan).length)],
      ['Escopo atual', metric('currentScope', planItems(state.plan).length)],
      ['Escopo adicional', metric('additionalScope')],
      ['Continuidades', metric('continuities', planItems(state.plan).filter(i => itemOrigin(i) !== 'new_planned').length)],
      ['Novos itens', metric('newPlanned', planItems(state.plan).filter(i => itemOrigin(i) === 'new_planned').length)],
      ['Deltas', state.plan?.activationDeltas?.length || 0],
      ['Pendencias nao absorvidas', state.plan?.previousPending?.length || 0],
      ['Prontidao', `${state.plan?.readiness?.score ?? 0}%`],
    ];
  }
  function itemTable(items) {
    if (!items.length) return '<p class="sp-empty">Nenhum item nesta classificacao.</p>';
    return `<div class="table-container"><table><thead><tr><th>Card e atividade</th><th>Origem</th><th>Responsavel</th><th>Data executiva</th></tr></thead><tbody>${items.map(item => `<tr><td><strong>${esc(itemLabel(item))}</strong>${item.carryOverCount > 1 ? `<small>${esc(item.carryOverCount)} sprints consecutivas</small>` : ''}${item.addedAfterBaseline ? '<small>Novo escopo apos o inicio</small>' : ''}</td><td><span class="sp-pill">${esc(originLabels[itemOrigin(item)] || itemOrigin(item))}</span></td><td>${esc(item.assigneeName || item.assigneeId || 'Nao atribuido')}</td><td>${esc(item.displayDate || 'Nao informada')}</td></tr>`).join('')}</tbody></table></div>`;
  }
  function tabContent() {
    const items = planItems(state.plan);
    if (state.tab === 'continuities') return itemTable(items.filter(item => ['carry_over', 'replanned_before_close'].includes(itemOrigin(item))));
    if (state.tab === 'items') return itemTable(items);
    if (state.tab === 'deltas') return itemTable(state.plan.activationDeltas || []);
    if (state.tab === 'pending') return itemTable(state.plan.previousPending || []);
    if (state.tab === 'evidence') return `<div class="sp-evidence">${(state.plan.evidence || []).map(e => { const item = planItems(state.plan).find(value => value.issueKey === e.issueKey) || state.plan.previousPending?.find(value => value.issueKey === e.issueKey); return `<article><strong>${esc(item ? itemLabel(item) : e.issueKey || e.id || 'Evidencia')}</strong><small>${esc(e.source || 'jira')} · ${esc(e.window || '')}</small><p>${esc(e.text || e.summary || e.type)}</p></article>`; }).join('') || '<p>Nenhuma evidencia textual disponivel. Os fatos estruturados permanecem auditaveis.</p>'}</div>`;
    if (state.tab === 'ai') return `<div class="sp-evidence">${(state.plan.ai?.priorities || []).map(entry => `<article><strong>${esc(entry.displayName || entry.issueKey)}</strong><small>${esc(entry.category)}</small><p>${esc(entry.text)}</p><small>${esc(entry.evidenceIds?.length || 0)} evidencia(s) validada(s)</small></article>`).join('') || '<p>A NVIDIA ainda nao gerou prioridades validadas para este planejamento.</p>'}</div>`;
    return preview();
  }
  function profileForm() {
    if (!state.boardId || !state.types.length) return '';
    const profile = state.profile || {}, statuses = state.types.flatMap(type => type.statuses || []);
    const fields = [{ id: '', name: 'Selecione' }, ...state.fields];
    return `<details class="sp-panel" ${profile.source === 'system_suggested' ? 'open' : ''}><summary>Regras do projeto e board ${profile.source === 'system_suggested' ? '(sugeridas pelo sistema)' : '(perfil salvo)'}</summary><p>${profile.source === 'system_suggested' ? 'A analise inicial usa metadados reais do Jira para identificar sprint, status e tipos. Revise e salve para transformar em padrao do projeto/board.' : 'Defina explicitamente status elegiveis e o campo de data. O Sprint Plan nao infere essas regras quando houver perfil salvo.'}</p><form id="sp-profile"><fieldset ${!state.canConfigure || state.busy ? 'disabled' : ''}><div class="sp-profile-grid"><label>Timezone<input name="timezone" value="${esc(profile.timezone || 'America/Sao_Paulo')}" required></label><label>Campo Sprint<select name="sprintField" required>${opt(fields, profile.sprintField)}</select></label><label>Data executiva<select name="executiveDateField" required>${opt(fields, profile.executiveDateField)}</select></label><label>Agrupamento<select name="grouping">${opt([{id:'hybrid',name:'Hibrido'},{id:'card',name:'Card'},{id:'parent',name:'Parent / Epic'},{id:'field',name:'Campo'},{id:'manual',name:'Manual'}], profile.grouping || 'hybrid')}</select></label></div><h3>Tipos elegiveis</h3><div class="sp-checks">${state.types.map(type => `<label><input type="checkbox" name="type" value="${esc(type.id)}" ${profile.eligibleTypes?.includes(String(type.id)) ? 'checked' : ''}>${esc(type.name)}</label>`).join('')}</div><h3>Mapeamento canonico de status</h3><div class="sp-profile-grid">${statuses.map(status => `<label>${esc(status.name)}<select name="status:${esc(status.id)}"><option value="">Selecione</option>${opt([{id:'pending',name:'Pendente'},{id:'progress',name:'Em andamento'},{id:'testing',name:'Testes'},{id:'approval',name:'Aprovacao'},{id:'blocked',name:'Bloqueado'},{id:'done',name:'Concluido'},{id:'cancelled',name:'Cancelado / N/A'}], profile.statusMap?.[status.id])}</select></label>`).join('')}</div><label class="sp-check"><input type="checkbox" name="requireAssignee" ${profile.requireAssignee ? 'checked' : ''}>Responsavel obrigatorio</label><label class="sp-check"><input type="checkbox" name="requireDate" ${profile.requireDate !== false ? 'checked' : ''}>Data executiva obrigatoria</label><button class="btn btn-primary" type="submit">Salvar regras</button></fieldset></form>${!state.canConfigure ? '<p>Somente o perfil Full pode alterar as regras.</p>' : ''}</details>`;
  }
  function preview() {
    return renderSprintPlanSlides(state.plan);
  }
  function draw() {
    const analysisRunning = state.busy || state.analysisJob?.status === 'running';
    const jobStatus = analysisRunning ? `<div class="sp-analysis-status" role="status" aria-live="polite"><span class="sp-spinner" aria-hidden="true"></span><div><strong>Análise do Sprint Plan em andamento</strong><p>${esc(state.analysisJob?.message || 'Preparando a consulta e carregando o contexto da sprint...')}</p><span class="sp-progress" aria-hidden="true"><i></i></span><small>Você pode permanecer nesta tela. O resultado aparecerá automaticamente.</small></div></div>` : state.analysisJob ? `<div class="${state.analysisJob.status === 'failed' ? 'sp-error' : 'sp-analysis-complete'}" role="status"><strong>${state.analysisJob.status === 'completed' ? 'Análise concluída' : 'Falha na análise'}</strong><p>${esc(state.analysisJob.message || '')}</p></div>` : '';
    root.innerHTML = `<div class="sprint-plan" aria-busy="${state.busy || state.analysisJob?.status === 'running'}"><section class="sp-panel"><fieldset ${state.busy ? 'disabled' : ''}><div class="sp-toolbar"><label>Projeto<select id="sp-project"><option value="">Selecione</option>${opt(state.projects, state.projectKey, 'key')}</select></label><label>Board<select id="sp-board" ${!state.projectKey ? 'disabled' : ''}><option value="">Selecione</option>${opt(state.boards, state.boardId)}</select></label><label>Sprint atual<select id="sp-sprint" ${!state.boardId ? 'disabled' : ''}><option value="">Selecione a sprint ativa</option>${opt(state.sprints, state.sprintId)}</select></label><button class="btn btn-primary" id="sp-analyze" ${!state.sprintId || !state.profile?.version || state.analysisJob?.status === 'running' ? 'disabled' : ''}>${state.analysisJob?.status === 'running' ? 'Analisando...' : state.plan ? 'Atualizar visao' : 'Gerar Sprint Plan'}</button></div></fieldset>${jobStatus}${state.profile?.source === 'system_suggested' ? '<p class="sp-warning">Sem perfil salvo: a primeira analise usara metadados reais do Jira e sinalizara isso no Preflight.</p>' : ''}${state.busy ? '<p role="status">Carregando contexto...</p>' : ''}${state.error ? `<p role="alert" class="sp-error"><strong>Não foi possível concluir:</strong> ${esc(state.error)}</p>` : ''}</section>${profileForm()}${state.plan ? `<section class="sp-kpis">${kpis().map(([label, value]) => `<article><strong>${esc(value)}</strong><span>${esc(label)}</span></article>`).join('')}</section><section class="sp-panel"><div class="sp-tabs" role="tablist">${[['continuities','Continuidades'],['deltas','Baseline x Atual'],['items','Itens da Sprint'],['pending','Pendencias Anteriores'],['evidence','Evidencias e Contexto'],['ai','Analise NVIDIA'],['preview','Previa da Arte']].map(([id,label]) => `<button class="btn ${state.tab === id ? 'btn-primary' : 'btn-secondary'}" data-tab="${id}" role="tab" aria-selected="${state.tab === id}">${label}</button>`).join('')}</div>${state.plan.preflight?.errors?.length ? `<div class="sp-error" role="alert"><strong>Preflight bloqueado</strong><ul>${state.plan.preflight.errors.map(e => `<li>${esc(e.message || e)}</li>`).join('')}</ul></div>` : ''}${state.plan.preflight?.warnings?.length ? `<div class="sp-warning"><strong>Avisos que exigem confirmacao</strong>${state.plan.preflight.warnings.map(w => { const key = `${w.code}:${w.issueKey || ''}`; return `<label class="sp-check"><input type="checkbox" data-warning="${esc(key)}" ${state.acceptedWarnings.includes(key) ? 'checked' : ''}>${esc(w.message)} ${w.issueKey ? esc(itemLabel(planItems(state.plan).find(item => item.issueKey === w.issueKey) || state.plan.previousPending?.find(item => item.issueKey === w.issueKey) || { issueKey: w.issueKey, title: 'Atividade nao carregada' })) : ''}</label>`; }).join('')}</div>` : ''}<div class="sp-content">${tabContent()}</div><div class="sp-actions"><button class="btn btn-secondary" id="sp-ai" ${!state.aiStatus.configured ? 'disabled' : ''}>Gerar analise NVIDIA</button><button class="btn btn-secondary" id="sp-preview">Revisar arte</button><button class="btn btn-secondary" id="sp-export" ${state.plan.preflight?.errors?.length ? 'disabled' : ''}>Exportar PNG</button><button class="btn btn-primary" id="sp-save" ${state.plan.preflight?.errors?.length ? 'disabled' : ''}>Aprovar e salvar snapshot</button></div>${!state.aiStatus.configured ? `<p class="sp-warning">IA NVIDIA nao configurada no servidor. Configure ${esc(state.aiStatus.requiredEnv || 'NVIDIA_API_KEY')} sem expor a chave no navegador.</p>` : `<p class="muted">Modelo NVIDIA: ${esc(state.aiStatus.model)}</p>`}</section>` : ''}</div>`;
    bind();
  }
  function bind() {
    root.querySelector('#sp-project')?.addEventListener('change', event => run(async () => { state.projectKey = event.target.value; state.boardId = ''; state.sprintId = ''; state.plan = null; state.profile = null; state.types = []; state.fields = []; state.boards = state.projectKey ? (await api('/boards')).boards : []; state.sprints = []; saveContext(); }));
    root.querySelector('#sp-board')?.addEventListener('change', event => run(async () => { state.boardId = event.target.value; state.sprintId = ''; state.plan = null; const context = state.boardId ? await api('/context') : { sprints: [] }; Object.assign(state, context); state.sprints = context.sprints || []; saveContext(); }));
    root.querySelector('#sp-sprint')?.addEventListener('change', event => { state.sprintId = event.target.value; state.plan = null; saveContext(); draw(); });
    root.querySelector('#sp-analyze')?.addEventListener('click', () => run(startAnalysisJob));
    root.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => { state.tab = button.dataset.tab; draw(); }));
    root.querySelector('#sp-preview')?.addEventListener('click', () => { state.tab = 'preview'; draw(); });
    root.querySelector('#sp-profile')?.addEventListener('submit', event => { event.preventDefault(); const data = new FormData(event.target), profile = { timezone: data.get('timezone'), sprintField: data.get('sprintField'), executiveDateField: data.get('executiveDateField'), grouping: data.get('grouping'), eligibleTypes: data.getAll('type'), requireAssignee: data.has('requireAssignee'), requireDate: data.has('requireDate'), statusMap: {}, automation: {} }; for (const [key,value] of data) if (key.startsWith('status:') && value) profile.statusMap[key.slice(7)] = value; run(async () => { state.profile = (await api('/profile', { profile }, 'POST')).profile; showToast('Regras do Sprint Plan salvas.', 'success'); }); });
    root.querySelectorAll('[data-warning]').forEach(input => input.addEventListener('change', () => { const values = new Set(state.acceptedWarnings); input.checked ? values.add(input.dataset.warning) : values.delete(input.dataset.warning); state.acceptedWarnings = [...values]; }));
    root.querySelector('#sp-save')?.addEventListener('click', () => run(async () => { const requestId = crypto.randomUUID(); await api('/snapshots', { sourceId: state.sourceId, acceptedWarnings: state.acceptedWarnings, requestId }, 'POST'); showToast('Plan Snapshot aprovado e preservado.', 'success'); }));
    root.querySelector('#sp-ai')?.addEventListener('click', () => run(async () => { Object.assign(state, await api('/synthesize', { sourceId: state.sourceId }, 'POST')); state.tab = 'ai'; showToast('Analise NVIDIA validada contra as evidencias do Jira.', 'success'); }));
    root.querySelector('#sp-export')?.addEventListener('click', exportPng);
  }
  async function exportPng() {
    if (!root.querySelector('[data-plan-slide]')) { state.tab = 'preview'; draw(); return; }
    await exportSprintPlanSlides(state.plan);
  }
  function saveContext() { localStorage.setItem(CONTEXT_STORAGE_KEY, JSON.stringify({ projectKey: state.projectKey, boardId: state.boardId, sprintId: state.sprintId })); }
  async function startAnalysisJob() {
    state.analysisJob = { status: 'running', message: 'Coletando cards, descrições, comentários e histórico do Jira.' }; draw();
    try {
      const result = await api('/analyze', {}, 'POST', { signal: false });
      Object.assign(state, result); state.tab = 'continuities';
      if (result.aiStatus?.configured) {
        state.analysisJob = { status: 'running', message: 'Contexto coletado. A NVIDIA está validando prioridades e riscos.' }; draw();
        Object.assign(state, await api('/synthesize', { sourceId: state.sourceId }, 'POST', { signal: false }));
      }
      state.analysisJob = { status: 'completed', message: 'Dados do Jira e análise NVIDIA concluídos.' };
      showToast('Análise do Sprint Plan concluída.', 'success');
    } catch (error) {
      state.analysisJob = { status: 'failed', message: error.message };
      throw error;
    }
  }
  async function restoreContext() {
    const saved = JSON.parse(localStorage.getItem(CONTEXT_STORAGE_KEY) || 'null');
    if (!saved?.projectKey) return;
    if (!state.projects.some(project => project.key === saved.projectKey)) return;
    state.projectKey = saved.projectKey;
    state.boards = (await api('/boards')).boards || [];
    if (!saved.boardId || !state.boards.some(board => String(board.id) === String(saved.boardId))) return;
    state.boardId = String(saved.boardId);
    const context = await api('/context'); Object.assign(state, context); state.sprints = context.sprints || [];
    if (saved.sprintId && state.sprints.some(sprint => String(sprint.id) === String(saved.sprintId))) {
      state.sprintId = String(saved.sprintId);
      state.snapshots = (await api('/snapshots')).snapshots || [];
    }
  }
  await run(async () => { const [projects, ai] = await Promise.all([api('/projects'), api('/ai-status')]); state.projects = projects.projects || []; state.aiStatus = ai.aiStatus || state.aiStatus; await restoreContext(); });
}
