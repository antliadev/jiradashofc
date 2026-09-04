import { sanitize, getJiraIssueUrl } from '../utils/helpers.js';
import { showToast } from '../utils/ui-feedback.js';
import { REVIEW_STATES } from '../data/sprint-review.js';
import { renderSprintSlides, exportSprintSlides, sprintSlidePages, executiveBlocks, executiveLabels, deliveryDates, SPRINT_TEMPLATE_VERSION } from '../utils/sprint-review-render.js';
import '../styles/sprint-review.css';

const esc = value => sanitize(String(value ?? ''));
const resultNames = { done: 'Concluido', partial: 'Parcial', removed: 'Removido / postergado', blocked: 'Bloqueado', continuity: 'Nao concluido' };
const options = (rows, selected, value = 'id', label = 'name') => rows.map(row => `<option value="${esc(row[value])}" ${String(row[value]) === String(selected) ? 'selected' : ''}>${esc(row[label])}</option>`).join('');
const date = (value, timezone = 'America/Sao_Paulo') => value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: timezone }).format(new Date(value)) : 'Nao informado';

export async function renderSprintReview() {
  const root = document.getElementById('page-content'), header = document.getElementById('page-header');
  header.innerHTML = '<h1>Sprint Review</h1><p class="subtitle">Planejamento, resultado e evidencias do fechamento da sprint</p>';
  const controller = new AbortController();
  const state = { projects: [], boards: [], sprints: [], types: [], fields: [], projectKey: '', boardId: '', sprintId: '', profile: null, review: null, sourceId: '', busy: false, error: '', tab: 'plan', search: '', filter: '', pageSize: 25, page: 1, choices: { groups: {}, optionalKeys: [], confirmGrouping: false }, edits: {}, goal: null, acceptedWarnings: [], snapshots: [], snapshot: null, jiraBaseUrl: '', fetchedAt: '' };
  let alive = true;
  state.executiveEdits = {}; state.confirmTextEdits = false; state.artManifest = null;
  window.addEventListener('hashchange', () => { alive = false; controller.abort(); }, { once: true });
  async function api(path, data, method = 'GET') {
    const query = new URLSearchParams({ projectKey: state.projectKey, boardId: state.boardId, sprintId: state.sprintId });
    const response = await fetch(`/api/jira/sprint-review${path}${method === 'GET' ? `?${query}` : ''}`, { method, credentials: 'include', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, ...(method === 'GET' ? {} : { body: JSON.stringify({ projectKey: state.projectKey, boardId: state.boardId, sprintId: state.sprintId, ...data }) }) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Nao foi possivel concluir esta operacao.');
    return payload;
  }
  async function run(work) {
    if (state.busy) return;
    state.busy = true; state.error = ''; draw();
    try { await work(); } catch (error) { if (alive) state.error = error.message; }
    finally { state.busy = false; if (alive) draw(); }
  }
  function clearReview() {
    state.executiveEdits = {}; state.confirmTextEdits = false; state.artManifest = null;
    state.goal = null;
    state.renders = [];
    state.review = null; state.sourceId = ''; state.snapshot = null; state.snapshots = []; state.edits = {}; state.acceptedWarnings = []; state.choices = { groups: {}, optionalKeys: [], confirmGrouping: false }; state.page = 1;
  }
  function profileForm() {
    if (!state.boardId || !state.types.length) return '';
    const p = state.profile || {}, statusMap = new Map(state.types.flatMap(type => type.statuses || []).map(status => [status.id, status]));
    for (const id of [...Object.keys(p.statusMap || {}), ...(state.review?.unmappedStatusIds || [])]) if (!statusMap.has(id)) statusMap.set(id, { id, name: 'Status historico' });
    const statuses = [...statusMap.values()];
    const fields = [{ id: '', name: 'Nao aplicavel' }, ...state.fields];
    return `<details class="sr-panel" ${p.source === 'system_suggested' ? 'open' : ''}><summary>Regras do projeto e board ${p.source === 'system_suggested' ? '(sugeridas pelo sistema)' : '(perfil salvo)'}</summary>
      <p>${p.source === 'system_suggested' ? 'A analise inicial usa metadados reais do Jira para destravar a validacao. Revise e salve para transformar em padrao do projeto/board.' : 'Os status abaixo exigem mapeamento explicito. As regras sao versionadas e preservadas em cada review.'}</p>
      ${!state.canConfigure ? '<p>Solicite a um usuario Full a configuracao deste perfil.</p>' : ''}
      <form id="sr-profile"><fieldset ${!state.canConfigure || state.busy ? 'disabled' : ''}>
      <div class="sr-grid">
      <label>Timezone<input name="timezone" value="${esc(p.timezone || 'America/Sao_Paulo')}" required></label>
      <label>Identidade visual<select name="logo">${options([{ id: 'antlia', name: 'Antlia' }, { id: 'crawford', name: 'Crawford' }, { id: 'docwise', name: 'Docwise' }], p.logo || 'antlia')}</select></label>
      <label>Campo Sprint<select name="sprintField" required>${options(fields, p.sprintField || state.fields.find(f => f.schema?.custom?.endsWith(':gh-sprint'))?.id)}</select></label>
      <label>Checklist (texto [x] / [ ])<select name="checklistField">${options(fields, p.checklistField)}</select></label>
      <label>Data de inicio planejada<select name="startField">${options(fields, p.startField)}</select></label>
      <label>Agrupamento<select name="grouping">${options([{ id: 'hybrid', name: 'Hibrido: parent com revisao manual' }, { id: 'card', name: 'Por card' }, { id: 'parent', name: 'Epic / Parent' }, { id: 'field', name: 'Por campo' }, { id: 'manual', name: 'Manual' }], p.grouping || 'hybrid')}</select></label>
      <label>Campo de agrupamento<select name="groupField">${options([...fields, { id: 'labels', name: 'Labels' }], p.groupField)}</select></label>
      </div><label class="sr-check"><input type="checkbox" name="checklistRequired" ${p.checklistRequired ? 'checked' : ''}>Checklist obrigatorio</label>
      <h3>Tipos elegiveis</h3><div class="sr-toolbar">${state.types.map(type => `<label class="sr-check"><input type="checkbox" name="type" value="${esc(type.id)}" ${p.eligibleTypes?.includes(type.id) ? 'checked' : ''}>${esc(type.name)}</label>`).join('')}</div>
      <label class="sr-check"><input type="checkbox" name="allowParentChildAsDistinct" ${p.allowParentChildAsDistinct ? 'checked' : ''}>Pai e filhos representam entregas executivas distintas (somente modo Card ou Manual)</label>
      <h3>Mapeamento dos status</h3><div class="sr-grid">${statuses.map(status => `<label>${esc(status.name)} (#${esc(status.id)})<select name="status:${esc(status.id)}"><option value="">Selecione</option>${options(Object.entries(REVIEW_STATES).map(([id, name]) => ({ id, name })), p.statusMap?.[status.id])}</select></label>`).join('')}</div>
      <h3>Automacoes (um valor por linha)</h3><div class="sr-grid">${[['accountIds', 'Account IDs bloqueados'], ['allowAccountIds', 'Account IDs humanos permitidos'], ['names', 'Nomes de automacoes'], ['patterns', 'Trechos de mensagens automaticas']].map(([id, name]) => `<label>${name}<textarea name="automation:${id}" rows="2">${esc((p.automation?.[id] || []).join('\n'))}</textarea></label>`).join('')}</div>
      <label>Faixas de atingimento (alta, parcial, abaixo)<input name="thresholds" value="${esc((p.thresholds || [90, 70, 50]).join(', '))}" required></label>
      <label>Faixas de confianca (alta, media)<input name="confidenceThresholds" value="${esc((p.confidenceThresholds || [80, 60]).join(', '))}" required></label>
      <h3>Prioridades criticas</h3><p>Pendencias obrigatorias nestas prioridades impedem a classificacao como meta atingida, sem alterar o percentual.</p><div class="sr-toolbar">${(state.priorities || []).map(priority => `<label class="sr-check"><input type="checkbox" name="criticalPriority" value="${esc(priority.id)}" ${p.criticalPriorityIds?.includes(priority.id) ? 'checked' : ''}>${esc(priority.name)}</label>`).join('')}</div>
      <label>Categorias de causa para a IA (uma por linha)<textarea name="causeTaxonomy" rows="3">${esc((p.causeTaxonomy || ['approval', 'external_dependency', 'quality', 'business_definition', 'technical_dependency']).join('\n'))}</textarea></label>
      <button class="btn btn-primary" type="submit">Salvar regras</button></fieldset></form></details>`;
  }
  function link(key) {
    const url = getJiraIssueUrl({ key }, state.jiraBaseUrl);
    return url === '#' ? esc(key) : `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(key)}</a>`;
  }
  function evidence(ids) {
    return state.review.evidence.filter(e => ids.includes(e.id)).map(e => `<div class="sr-evidence">${e.issueKey ? link(e.issueKey) : 'Entrega executiva'} <span class="muted">${esc(e.type)} · ${esc(date(e.timestamp, state.review.profile.timezone))}</span>${e.provenance === 'current_only' ? '<strong class="sr-warning">Atual; não comprova fechamento</strong>' : ''}<p>${esc(e.text)}</p>${e.author ? `<small>${esc(e.author)}</small>` : ''}</div>`).join('');
  }
  function tableContent() {
    const review = state.review;
    let rows = state.tab === 'plan' ? review.deliveries : review.items;
    const query = state.search.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    rows = rows.filter(row => (!state.filter || (row.result || row.state) === state.filter) && `${row.title} ${row.key || row.keys.join(' ')}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes(query));
    rows = [...rows].sort((a, b) => (a.key || a.keys[0]).localeCompare(b.key || b.keys[0], 'pt-BR', { numeric: true }));
    const pages = Math.max(1, Math.ceil(rows.length / state.pageSize));
    state.page = Math.min(state.page, pages);
    const visible = rows.slice((state.page - 1) * state.pageSize, state.page * state.pageSize);
    return `<p class="muted">${rows.length} registros encontrados. Filtros alteram apenas esta lista, nao as metricas da sprint.</p><div class="table-container"><table class="data-table"><thead><tr>${(state.tab === 'plan' ? ['Entrega / cards', 'Escopo', 'Resultado', 'Evidencias'] : ['Card', 'Status no corte', 'Planejamento', 'Agrupamento / obrigatoriedade', 'Evidencias']).map(label => `<th>${label}</th>`).join('')}</tr></thead><tbody>${visible.map(row => state.tab === 'plan' ? `<tr><td>${esc(row.title)}<br>${row.keys.map(link).join(', ')}</td><td>${row.planned ? 'Baseline' : 'Adicional'}<p>Original: ${esc(deliveryDates(review, row))}<br>No corte: ${esc(deliveryDates(review, row, true))}</p></td><td>${esc(resultNames[row.result])} (${row.progress}%)</td><td><button class="btn btn-secondary" data-evidence="${esc(row.id)}">Ver evidencias</button></td></tr>` : `<tr><td>${link(row.key)}<p>${esc(row.title)}</p></td><td>${esc(REVIEW_STATES[row.state] || 'Nao mapeado')}${row.inconsistent ? '<p>Com ressalva: revisar</p>' : ''}${row.carryOver ? `<p>Continuidade: ${esc(row.laterSprints.map(s => s.name).join(', '))}</p>` : ''}</td><td>${row.planned ? 'Planejado' : 'Adicional'}${row.removed ? ' / Removido' : ''}<p>Data original: ${esc(row.baseline.duedate || 'N/A')}<br>Data no corte: ${esc(row.closing.duedate || 'N/A')}</p>${row.deltas.length ? `<details><summary>${row.deltas.length} alteracoes</summary>${row.deltas.map(d => `<p>${esc(d.field)}: ${esc(d.from)} → ${esc(d.to)}</p>`).join('')}</details>` : ''}</td><td><label>Entrega<input data-group="${esc(row.key)}" value="${esc(state.choices.groups[row.key] || row.group)}" maxlength="100" ${state.snapshot ? 'disabled' : ''}></label><label class="sr-check"><input type="checkbox" data-optional="${esc(row.key)}" ${state.choices.optionalKeys.includes(row.key) ? 'checked' : ''} ${state.snapshot ? 'disabled' : ''}>Nao bloqueante</label></td><td><button class="btn btn-secondary" data-evidence="${esc(row.key)}">Ver evidencias</button></td></tr>`).join('') || '<tr><td colspan="5">Nenhum card corresponde aos filtros.</td></tr>'}</tbody></table></div><div class="sr-toolbar"><button class="btn btn-secondary" id="sr-prev" ${state.page <= 1 ? 'disabled' : ''}>Anterior</button><span>Pagina ${state.page} de ${pages}</span><button class="btn btn-secondary" id="sr-next" ${state.page >= pages ? 'disabled' : ''}>Proxima</button></div>`;
  }
  function reviewContent() {
    const r = state.review;
    if (!r) return '<section class="sr-panel"><h2>Selecione o contexto da review</h2><p>A consulta considera somente o projeto escolhido. O historico dos cards e verificado para recuperar inclusive os itens removidos da sprint.</p><p>Nenhuma alteracao sera feita nos cards do Jira.</p></section>';
    return `<section class="sr-panel"><h2>${esc(r.sprint.name)}</h2><p>Inicio: ${esc(date(r.sprint.startDate, r.profile.timezone))} · ${r.mode === 'current' ? 'Reprocessada em' : 'Fechamento'}: ${esc(date(r.sprint.completeDate, r.profile.timezone))} · ${esc(r.profile.timezone)}</p>${r.mode === 'current' ? `<p class="sr-warning"><strong>VISAO COM DADOS ATUAIS.</strong> Fechamento original: ${esc(date(r.historicalCompleteDate, r.profile.timezone))}. Nao substitui a review historica.</p>` : ''}${r.sprint.goal ? `<p><strong>Goal:</strong> ${esc(r.sprint.goal)}</p>` : ''}<p>Consulta: ${esc(date(state.fetchedAt))}. ${state.snapshot ? `Versao salva #${state.snapshot.revision}, somente leitura.` : 'Rascunho em revisao.'}</p></section>
      <div class="kpi-grid">${[['Planejadas', r.metrics.planned], ['Concluidas', r.metrics.completed], ['Atingimento', `${r.metrics.achievement}%`], ['Carry-over (cards)', r.metrics.carryOver], ['Adicionais', r.metrics.additional], ['Removidos (cards)', r.metrics.removed], ['Replanejados (cards)', r.metrics.replanned], ['Bloqueios (cards)', r.metrics.blocked], ['Confianca', `${r.confidence}%`]].map(([label, value]) => `<div class="kpi-card"><div class="kpi-value">${value}</div><div class="kpi-label">${label}</div></div>`).join('')}</div>
      ${goalForm()}
      <button class="btn btn-secondary" id="sr-mode">${r.mode === 'current' ? 'Retornar ao fechamento original' : 'Consultar visao complementar com dados atuais'}</button>
      <section class="sr-panel"><h2>Validacao antes da arte</h2><p>O atingimento e calculado pelo baseline. A confianca mede a cobertura das evidencias e nao altera o resultado.</p>${r.preflight.map(p => `<div class="sr-preflight sr-${p.severity}">${p.severity === 'warning' && !state.snapshot ? `<label class="sr-check"><input type="checkbox" data-warning="${esc(p.id)}" ${state.acceptedWarnings.includes(p.id) ? 'checked' : ''}>Confirmar aviso:</label>` : `<strong>${esc({ error: 'Erro bloqueante', warning: 'Aviso', info: 'Informacao' }[p.severity])}:</strong>`} ${p.issueKey ? link(p.issueKey) : ''} ${esc(p.message)}</div>`).join('')}
      <details><summary>Composicao da confianca</summary>${r.components.map(c => `<p>${esc(c.name)}: ${c.score == null ? 'Nao aplicavel' : Math.round(c.score) + '%'} (peso ${c.weight})</p>`).join('')}</details></section>
      <section class="sr-panel"><div class="sr-tabs" role="tablist" aria-label="Detalhes da Sprint Review">${[['plan', 'Planejado x Resultado'], ['cards', 'Analise dos Cards'], ['evidence', 'Evidencias e Comentarios'], ['art', 'Configuracao da Arte']].map(([tab, name]) => `<button class="btn ${state.tab === tab ? 'btn-primary' : 'btn-secondary'}" role="tab" aria-selected="${state.tab === tab}" data-tab="${tab}">${name}</button>`).join('')}</div>
      ${['plan', 'cards'].includes(state.tab) ? `<div class="sr-toolbar"><label>Buscar<input id="sr-search" value="${esc(state.search)}" placeholder="Codigo ou titulo"></label><label>Resultado<select id="sr-filter"><option value="">Todos</option>${options(Object.entries(state.tab === 'plan' ? resultNames : REVIEW_STATES).map(([id, name]) => ({ id, name })), state.filter)}</select></label><label>Exibir<select id="sr-size">${options([10, 25, 50, 100].map(n => ({ id: n, name: n })), state.pageSize)}</select></label><button id="sr-clear" class="btn btn-secondary">Limpar filtros</button></div><div id="sr-table">${tableContent()}</div>${!state.snapshot ? '<button class="btn btn-primary" id="sr-group">Aplicar e confirmar agrupamento</button>' : ''}` : state.tab === 'evidence' ? `${evidence(r.evidence.map(e => e.id))}<details><summary>Registros excluidos (${r.excludedComments.length})</summary>${r.excludedComments.map(e => `<p>${link(e.issueKey)} · Comentario ${esc(e.commentId)} · ${esc(e.reason)}</p>`).join('')}</details>` : `<p>Os textos podem ser revisados; metricas e status nao sao editaveis. Cada alteracao sera identificada na versao salva.</p>${r.statements.map(s => `<label class="sr-statement">${link(s.issueKey)}<textarea data-statement="${esc(s.id)}" maxlength="350" rows="3" ${state.snapshot ? 'disabled' : ''}>${esc(state.edits[s.id] ?? s.text)}</textarea><button class="btn btn-secondary" data-evidence="${esc(s.issueKey)}">Ver evidencias</button></label>`).join('')}<button class="btn btn-secondary" id="sr-reset-text" ${state.snapshot ? 'disabled' : ''}>Restaurar textos sugeridos</button>`}
      </section><div class="sr-toolbar"><button class="btn btn-secondary" id="sr-preview">Gerar previa</button><button class="btn btn-secondary" id="sr-copy">Copiar resumo</button><button class="btn btn-secondary" id="sr-ai" ${state.snapshot ? 'disabled' : ''}>Gerar textos NVIDIA</button><button class="btn btn-secondary" id="sr-new-version" ${!state.snapshot ? 'disabled' : ''}>Criar nova versao</button><button class="btn btn-primary" id="sr-save" ${state.snapshot ? 'disabled' : ''}>Salvar Review</button><button class="btn btn-primary" id="sr-export">Exportar PNG</button></div><p class="muted">A exportacao final exige agrupamento confirmado, validacao sem erros e avisos aceitos. Muitas entregas geram varias imagens 16:9, sem cortar textos.</p><div id="sr-preview-area"></div>`;
  }
  function goalForm() {
    if (!state.review.sprint.goal) return '';
    const goal = state.snapshot?.payload.goal || state.goal || state.review.goalSuggestion;
    return `<details class="sr-panel"><summary>Avaliacao opcional do Goal</summary><p>Avaliacao humana separada do percentual de entregas.</p><fieldset ${state.snapshot ? 'disabled' : ''}><label>Resultado<select id="sr-goal"><option value="">Nao incluir na arte</option>${options([{ id: 'achieved', name: 'Atingido' }, { id: 'partial', name: 'Parcialmente atingido' }, { id: 'not_achieved', name: 'Nao atingido' }, { id: 'insufficient', name: 'Evidencia insuficiente' }], goal?.result)}</select></label><label class="sr-check"><input id="sr-goal-confirm" type="checkbox" ${goal?.confirmed ? 'checked' : ''}>Confirmo a avaliacao do Goal</label><details><summary>Selecionar evidencias da avaliacao</summary>${state.review.evidence.map(e => `<label class="sr-check"><input data-goal-evidence="${esc(e.id)}" type="checkbox" ${goal?.evidenceIds?.includes(e.id) ? 'checked' : ''}>${esc(e.issueKey)}: ${esc(e.text)}</label>`).join('')}</details></fieldset></details>`;
  }
  function draw() {
    if (!alive) return;
    const focusId = document.activeElement?.id;
    root.innerHTML = `<div class="sprint-review" aria-busy="${state.busy}"><section class="sr-panel"><fieldset ${state.busy ? 'disabled' : ''}><div class="sr-toolbar"><label>Projeto<select id="sr-project"><option value="">Selecione</option>${options(state.projects, state.projectKey, 'key')}</select></label><label>Board<select id="sr-board" ${!state.projectKey ? 'disabled' : ''}><option value="">Selecione</option>${options(state.boards, state.boardId)}</select></label><label>Sprint<select id="sr-sprint" ${!state.boardId ? 'disabled' : ''}><option value="">Selecione uma sprint encerrada</option>${state.sprints.map(s => `<option value="${s.id}" ${s.state !== 'closed' ? 'disabled' : ''} ${String(s.id) === state.sprintId ? 'selected' : ''}>${esc(s.name)} (${s.state === 'closed' ? 'encerrada' : 'ativa'})</option>`).join('')}</select></label><button class="btn btn-primary" id="sr-analyze" ${!state.sprintId || !state.profile?.version ? 'disabled' : ''}>${state.review ? 'Atualizar esta sprint' : 'Analisar Sprint'}</button></div></fieldset>${state.profile?.source === 'system_suggested' ? '<p class="sr-warning">Sem perfil salvo: a primeira analise usara regras sugeridas pelo sistema e sinalizara isso no Preflight.</p>' : ''}${state.busy ? '<p role="status">Consultando e validando os dados. Isso pode levar alguns minutos em projetos com historico extenso.</p>' : ''}${state.error ? `<p role="alert" class="sr-error">${esc(state.error)}</p>` : ''}</section>
      ${profileForm()}${state.snapshots.length ? `<section class="sr-panel"><label>Versoes salvas<select id="sr-saved"><option value="">Abrir uma versao</option>${state.snapshots.map(s => `<option value="${s.id}">#${s.revision} · ${esc(date(s.created_at))}</option>`).join('')}</select></label></section>` : ''}<fieldset ${state.busy ? 'disabled' : ''}>${reviewContent()}</fieldset><dialog id="sr-dialog"><button class="btn btn-secondary" id="sr-close-dialog">Fechar</button><div id="sr-dialog-body"></div></dialog></div>`;
    bind();
    root.querySelector('#sr-dialog').setAttribute('aria-label', 'Evidências rastreáveis');
    const tabs = [...root.querySelectorAll('[data-tab]')];
    tabs.forEach((tab, index) => {
      tab.id = `sr-tab-${tab.dataset.tab}`;
      tab.tabIndex = tab.dataset.tab === state.tab ? 0 : -1;
      tab.setAttribute('aria-controls', 'sr-tab-panel');
      tab.addEventListener('keydown', event => {
        const target = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : -1;
        if (target >= 0) { event.preventDefault(); tabs[target].click(); root.querySelector(`#sr-tab-${tabs[target].dataset.tab}`).focus(); }
      });
    });
    const tabsRow = root.querySelector('.sr-tabs');
    if (tabsRow) {
      const panel = document.createElement('div'); panel.id = 'sr-tab-panel'; panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', `sr-tab-${state.tab}`);
      while (tabsRow.nextSibling) panel.append(tabsRow.nextSibling);
      tabsRow.after(panel);
    }
    if (state.review) installExecutiveEditor();
    if (state.review?.metrics.carryOverUnknown) {
      const note = document.createElement('p'); note.className = 'sr-warning';
      note.textContent = `${state.review.metrics.carryOverUnknown} destinos não confirmados. Carry-over contabiliza somente destinos comprovados no fechamento.`;
      root.querySelector('.kpi-grid').after(note);
    }
    if (focusId) document.getElementById(focusId)?.focus();
  }
  function markTextEdited() {
    state.confirmTextEdits = false;
    const checkbox = root.querySelector('#sr-confirm-text'); if (checkbox) checkbox.checked = false;
    const preview = root.querySelector('#sr-preview-area');
    if (preview?.childElementCount) preview.innerHTML = '<p role="status">Prévia desatualizada. Gere novamente para conferir as alterações.</p>';
  }
  function textOrigin(block, edited = false) {
    if (edited || block.editedByHuman || block.kind === 'human_edit') return 'Edição humana · não verificada por IA';
    const interpretation = ['interpretation', 'synthesis'].includes(block.kind);
    const origin = interpretation ? 'Interpretação / síntese' : block.kind === 'insufficient_evidence' ? 'Evidência insuficiente' : 'Fato determinístico';
    return `${origin}${block.suggestion?.requiresHumanReview || block.requiresHumanReview || ['suggested', 'pending_review'].includes(block.status) ? ' · revisão humana pendente' : ''}`;
  }
  function installExecutiveEditor() {
    const section = document.createElement('section'); section.className = 'sr-panel sr-executive-editor';
    const blocks = executiveBlocks(currentReview());
    section.innerHTML = `<h2>Revisão executiva</h2><p>Revise os textos e suas evidências. Datas, métricas e resultados preservam os fatos do fechamento.</p><div class="sr-editor-grid">${Object.entries(blocks).map(([key, block]) => `<div><label for="sr-exec-${key}">${executiveLabels[key]}</label><textarea id="sr-exec-${key}" data-executive="${key}" maxlength="600" rows="3" ${state.snapshot ? 'disabled' : ''} aria-describedby="sr-count-${key}">${esc(block.text)}</textarea><small id="sr-count-${key}">${block.text.length}/600 caracteres</small><button type="button" class="btn btn-secondary" data-executive-evidence="${key}">Ver evidências: ${executiveLabels[key].toLowerCase()}</button></div>`).join('')}</div><label class="sr-check"><input id="sr-confirm-text" type="checkbox" ${state.confirmTextEdits ? 'checked' : ''} ${state.snapshot ? 'disabled' : ''}>Revisei os textos editados e suas evidências</label><p class="muted">Textos extensos podem exigir uma lâmina de contexto adicional. Nenhum texto será cortado.</p>`;
    root.querySelector('#sr-preview').parentElement.before(section);
    section.querySelectorAll('[data-executive]').forEach(input => input.addEventListener('input', () => {
      state.executiveEdits[input.dataset.executive] = input.value;
      section.querySelector(`#sr-count-${input.dataset.executive}`).textContent = `${input.value.length}/600 caracteres`;
      markTextEdited();
      section.querySelector(`#sr-origin-${input.dataset.executive}`).textContent = textOrigin(blocks[input.dataset.executive], input.value !== executiveBlocks(state.review)[input.dataset.executive].text);
    }));
    section.querySelectorAll('[data-executive]').forEach(input => {
      const origin = document.createElement('p'); origin.className = 'sr-text-origin'; origin.id = `sr-origin-${input.dataset.executive}`;
      origin.textContent = textOrigin(blocks[input.dataset.executive]); input.before(origin);
      input.setAttribute('aria-describedby', `${input.getAttribute('aria-describedby')} ${origin.id}`);
    });
    root.querySelectorAll('[data-statement]').forEach(input => {
      const statement = state.review.statements.find(s => s.id === input.dataset.statement);
      const origin = document.createElement('small'); origin.className = 'sr-text-origin';
      origin.textContent = textOrigin(statement, input.value !== statement.text); input.before(origin);
      input.addEventListener('input', () => { origin.textContent = textOrigin(statement, input.value !== statement.text); });
      const button = input.parentElement.querySelector('[data-evidence]');
      if (button) {
        button.dataset.evidence = statement.id;
        button.onclick = () => {
          root.querySelector('#sr-dialog-body').innerHTML = `<h2>Evidências da afirmação</h2><p>${esc(textOrigin(statement, input.value !== statement.text))}</p>${evidence(statement.evidenceIds || []) || '<p>Nenhuma evidência vinculada.</p>'}`;
          root.querySelector('#sr-dialog').showModal();
        };
      }
    });
    section.querySelectorAll('[data-executive-evidence]').forEach(button => button.addEventListener('click', () => {
      const block = executiveBlocks(currentReview())[button.dataset.executiveEvidence];
      root.querySelector('#sr-dialog-body').innerHTML = `<h2>${executiveLabels[button.dataset.executiveEvidence]}</h2>${block.overflow ? '<p class="sr-warning">O resumo possui conteúdo adicional. A lista abaixo preserva os detalhes completos.</p>' : ''}${block.details?.length ? `<h3>Detalhes completos</h3>${block.details.map(detail => `<section class="sr-evidence"><p>${esc(detail.text)}</p>${evidence(detail.evidenceIds || []) || '<small>Sem evidência vinculada a este detalhe.</small>'}</section>`).join('')}` : evidence(block.evidenceIds || []) || '<p>Nenhuma evidência textual vinculada. Confira os fatos e as métricas da review.</p>'}`;
      root.querySelector('#sr-dialog').showModal();
    }));
    on('sr-confirm-text', 'change', event => { state.confirmTextEdits = event.target.checked; });
    if (state.snapshot && !state.artManifest?.complete) {
      const warning = document.createElement('p'); warning.className = 'sr-warning'; warning.setAttribute('role', 'status');
      warning.textContent = 'Arte incompleta ou legado sem manifesto. Use Exportar PNG para solicitar retomada explícita da mesma versão, quando compatível.';
      section.append(warning);
    }
  }
  function on(id, event, handler) { root.querySelector(`#${id}`)?.addEventListener(event, handler); }
  function bind() {
    on('sr-project', 'change', event => run(async () => {
      state.projectKey = event.target.value; state.boardId = ''; state.sprintId = ''; state.boards = []; state.sprints = []; state.profile = null; state.types = []; clearReview();
      if (state.projectKey) state.boards = (await api('/boards')).boards;
    }));
    on('sr-board', 'change', event => run(async () => {
      state.boardId = event.target.value; state.sprintId = ''; state.profile = null; state.types = []; state.sprints = []; clearReview();
      if (state.boardId) Object.assign(state, await api('/context'));
    }));
    on('sr-sprint', 'change', event => run(async () => { state.sprintId = event.target.value; clearReview(); if (state.sprintId) state.snapshots = (await api('/snapshots')).snapshots; }));
    on('sr-profile', 'submit', event => {
      event.preventDefault();
      const data = new FormData(event.target), profile = { timezone: data.get('timezone'), sprintField: data.get('sprintField'), checklistField: data.get('checklistField'), startField: data.get('startField'), groupField: data.get('groupField'), grouping: data.get('grouping'), checklistRequired: data.has('checklistRequired'), eligibleTypes: data.getAll('type'), thresholds: String(data.get('thresholds')).split(',').map(Number), statusMap: {}, automation: {} };
      for (const [key, value] of data) {
        if (key === 'logo') profile.logo = value;
        if (key === 'causeTaxonomy') profile.causeTaxonomy = value.split('\n').map(v => v.trim()).filter(Boolean);
        if (key === 'confidenceThresholds') profile.confidenceThresholds = value.split(',').map(Number);
        if (key.startsWith('status:') && value) profile.statusMap[key.slice(7)] = value;
        if (key.startsWith('automation:')) profile.automation[key.slice(11)] = value.split('\n').map(v => v.trim()).filter(Boolean);
      }
      profile.criticalPriorityIds = data.getAll('criticalPriority');
      profile.allowParentChildAsDistinct = data.has('allowParentChildAsDistinct');
      run(async () => { state.profile = (await api('/profile', { profile }, 'POST')).profile; clearReview(); showToast('Regras salvas. Analise a sprint para aplicar esta versao.', 'success'); });
    });
    on('sr-analyze', 'click', () => run(async () => {
      if (state.review && !window.confirm('Consultar novamente o Jira e substituir o rascunho? Versoes salvas serao preservadas.')) return;
      await loadAnalysis(state.review?.mode || 'historical');
    }));
    on('sr-mode', 'click', () => run(async () => {
      if (!window.confirm('Consultar esta visao e substituir o rascunho? Todas as versoes salvas serao preservadas.')) return;
      await loadAnalysis(state.review.mode === 'current' ? 'historical' : 'current');
    }));
    root.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => { state.tab = button.dataset.tab; state.search = ''; state.filter = ''; state.page = 1; draw(); }));
    on('sr-search', 'input', event => { state.search = event.target.value; state.page = 1; updateTable(); });
    on('sr-filter', 'change', event => { state.filter = event.target.value; state.page = 1; updateTable(); });
    on('sr-size', 'change', event => { state.pageSize = Number(event.target.value); state.page = 1; updateTable(); });
    on('sr-clear', 'click', () => { state.search = ''; state.filter = ''; state.page = 1; draw(); });
    bindTable();
    root.querySelectorAll('[data-statement]').forEach(input => input.addEventListener('input', () => { state.edits[input.dataset.statement] = input.value; markTextEdited(); }));
    root.querySelectorAll('[data-warning]').forEach(input => input.addEventListener('change', () => { state.acceptedWarnings = state.acceptedWarnings.filter(id => id !== input.dataset.warning); if (input.checked) state.acceptedWarnings.push(input.dataset.warning); }));
    const updateGoal = () => {
      const result = root.querySelector('#sr-goal')?.value;
      state.goal = result ? { result, confirmed: root.querySelector('#sr-goal-confirm').checked, evidenceIds: [...root.querySelectorAll('[data-goal-evidence]:checked')].map(e => e.dataset.goalEvidence) } : null;
    };
    on('sr-goal', 'change', updateGoal); on('sr-goal-confirm', 'change', updateGoal);
    root.querySelectorAll('[data-goal-evidence]').forEach(input => input.addEventListener('change', updateGoal));
    on('sr-group', 'click', () => run(async () => { state.choices.confirmGrouping = true; state.review = (await api('/recalculate', { sourceId: state.sourceId, choices: state.choices }, 'POST')).review; state.acceptedWarnings = []; }));
    on('sr-reset-text', 'click', () => { state.edits = {}; state.executiveEdits = {}; markTextEdited(); draw(); });
    on('sr-ai', 'click', () => run(async () => {
      if ((Object.keys(state.edits).length || Object.keys(state.executiveEdits).length) && !window.confirm('Substituir os textos revisados por novas sugestoes da NVIDIA?')) return;
      Object.assign(state, await api('/synthesize', { sourceId: state.sourceId, choices: state.choices }, 'POST'));
      state.edits = {}; state.executiveEdits = {}; state.confirmTextEdits = false; state.acceptedWarnings = [];
    }));
    on('sr-new-version', 'click', () => {
      state.goal = state.snapshot.payload.goal;
      state.edits = Object.fromEntries(state.review.statements.filter(s => s.editedByHuman).map(s => [s.id, s.text]));
      state.executiveEdits = Object.fromEntries(Object.entries(state.review.executive || {}).filter(([, b]) => b.editedByHuman).map(([key, b]) => [key, b.text]));
      state.confirmTextEdits = false; state.artManifest = null;
      state.snapshot = null; state.renders = []; state.acceptedWarnings = []; draw();
    });
    on('sr-preview', 'click', () => {
      const area = root.querySelector('#sr-preview-area');
      if (state.snapshot && !state.artManifest?.complete) { area.innerHTML = `<p role="status">${state.snapshot.payload.renderManifest?.templateVersion === SPRINT_TEMPLATE_VERSION ? 'Arte incompleta, não final. Solicite a retomada explícita por Exportar PNG.' : 'Arte original indisponível/sem manifesto; criar nova versão.'}</p>`; return; }
      area.innerHTML = state.snapshot ? state.renders.map(r => `<img src="data:image/png;base64,${esc(r.png)}" alt="Arte salva, página ${r.page}" style="width:100%;height:auto">`).join('') + `<details><summary>Conteúdo textual do snapshot</summary><p>${esc(state.review.summary)}</p>${Object.entries(executiveBlocks(state.review)).map(([key, b]) => `<h3>${executiveLabels[key]}</h3><p>${esc(b.text)}</p>`).join('')}${state.review.deliveries.map(d => `<p>${esc(d.title)}: ${esc(resultNames[d.result])}</p>`).join('')}</details>` : renderSprintSlides({ review: currentReview() });
    });
    on('sr-copy', 'click', async () => { try { await navigator.clipboard.writeText(currentReview().summary); showToast('Resumo copiado.', 'success'); } catch { showToast('Nao foi possivel copiar o resumo.', 'error'); } });
    on('sr-save', 'click', () => run(save));
    on('sr-export', 'click', () => run(async () => {
      if (!state.snapshot) await save();
      if (state.artManifest?.complete && state.renders?.length) {
        for (const render of state.renders) {
          const anchor = document.createElement('a');
          anchor.href = `data:image/png;base64,${render.png}`;
          anchor.download = `Sprint_Review_${state.projectKey}_${state.sprintId}_${render.page}.png`;
          anchor.click();
        }
        return;
      }
      const manifest = state.snapshot.payload.renderManifest;
      if (!manifest || manifest.templateVersion !== SPRINT_TEMPLATE_VERSION || manifest.pageCount !== sprintSlidePages(state.snapshot.payload.review).length) throw new Error('Esta versão usa outro template ou não possui manifesto. Crie uma nova versão para gerar a arte atual.');
      if (!window.confirm('Retomar a geração e persistência de todas as páginas desta versão? O download começa somente após salvar o conjunto completo.')) return;
      await exportSprintSlides(state.snapshot.payload.review, state.snapshot.id, { persist: async (blob, page) => {
        const query = new URLSearchParams({ projectKey: state.projectKey, boardId: state.boardId, sprintId: state.sprintId });
        const response = await fetch(`/api/jira/sprint-review/snapshots/${state.snapshot.id}/art/${page}?${query}`, { method: 'POST', credentials: 'include', signal: controller.signal, headers: { 'Content-Type': 'image/png' }, body: blob });
        if (!response.ok) throw new Error('Nao foi possivel guardar a arte. Tente exportar novamente.');
        if (page === manifest.pageCount) {
          await loadArt();
          if (!state.artManifest.complete) throw new Error('O servidor ainda não confirmou o conjunto completo. Nenhum download foi iniciado.');
        }
      } });
      showToast('Imagens guardadas e exportadas.', 'success');
    }));
    on('sr-saved', 'change', event => { if (event.target.value) run(async () => {
      const { snapshot } = await api(`/snapshots/${event.target.value}`);
      state.snapshot = snapshot; state.review = snapshot.payload.review; state.sourceId = snapshot.payload.sourceId; state.jiraBaseUrl = snapshot.payload.jiraBaseUrl; state.fetchedAt = snapshot.payload.fetchedAt; state.choices = structuredClone(state.review.choices); state.edits = {}; state.acceptedWarnings = snapshot.payload.acceptedWarnings;
      state.executiveEdits = {}; state.confirmTextEdits = false;
      await loadArt();
    }); });
    on('sr-close-dialog', 'click', () => root.querySelector('#sr-dialog').close());
  }
  async function loadArt() {
    state.renders = []; state.artManifest = null;
    const { renders = [], manifest } = await api(`/snapshots/${state.snapshot.id}/art`);
    const count = state.snapshot.payload.renderManifest?.pageCount;
    const ordered = [...renders].sort((a, b) => a.page - b.page);
    const complete = Boolean(manifest?.complete && count && manifest.snapshotId === state.snapshot.id && typeof state.snapshot.content_hash === 'string' && manifest.snapshotHash === state.snapshot.content_hash && manifest.pageCount === count && manifest.pages?.length === count && ordered.length === count && ordered.every((r, i) => r.page === i + 1 && manifest.pages[i].page === r.page && manifest.pages[i].hash === r.hash));
    state.artManifest = { ...manifest, complete }; state.renders = complete ? ordered : [];
  }
  function currentReview() {
    const review = { ...state.review, goalAssessment: state.snapshot?.payload.goal || (state.goal?.confirmed ? state.goal : null), statements: state.review.statements.map(s => ({ ...s, text: state.edits[s.id] ?? s.text })) };
    review.executive = Object.fromEntries(Object.entries(executiveBlocks(review)).map(([key, block]) => [key, { ...block, text: state.executiveEdits[key] ?? block.text, ...(state.executiveEdits[key] !== undefined && state.executiveEdits[key] !== block.text ? { editedByHuman: true } : {}) }]));
    return review;
  }
  async function loadAnalysis(mode) {
    const result = await api('/analyze', { mode }, 'POST'); clearReview(); Object.assign(state, result); state.snapshots = (await api('/snapshots')).snapshots;
    if (result.aiAvailable) Object.assign(state, await api('/synthesize', { sourceId: state.sourceId, choices: state.choices }, 'POST'));
  }
  async function save() {
    const input = { sourceId: state.sourceId, choices: state.choices, acceptedWarnings: state.acceptedWarnings, edits: state.edits, executiveEdits: state.executiveEdits, confirmTextEdits: state.confirmTextEdits, goal: state.goal, renderManifest: { pageCount: sprintSlidePages(currentReview()).length, templateVersion: SPRINT_TEMPLATE_VERSION } };
    const signature = JSON.stringify(input);
    if (state.saveRequest?.signature !== signature) state.saveRequest = { signature, id: crypto.randomUUID() };
    const result = await api('/snapshots', { ...input, requestId: state.saveRequest.id }, 'POST');
    state.snapshot = result.snapshot; state.review = result.snapshot.payload.review; state.edits = {}; state.snapshots = (await api('/snapshots')).snapshots;
    state.executiveEdits = {}; state.confirmTextEdits = false; state.renders = []; state.artManifest = null;
    showToast('Review salva como nova versao.', 'success');
  }
  function updateTable() { root.querySelector('#sr-table').innerHTML = tableContent(); bindTable(); }
  function bindTable() {
    on('sr-prev', 'click', () => { state.page--; updateTable(); }); on('sr-next', 'click', () => { state.page++; updateTable(); });
    root.querySelectorAll('[data-group]').forEach(input => input.onchange = () => { state.choices.groups[input.dataset.group] = input.value.trim(); state.choices.confirmGrouping = false; });
    root.querySelectorAll('[data-optional]').forEach(input => input.onchange = () => { state.choices.optionalKeys = state.choices.optionalKeys.filter(key => key !== input.dataset.optional); if (input.checked) state.choices.optionalKeys.push(input.dataset.optional); state.choices.confirmGrouping = false; });
    root.querySelectorAll('[data-evidence]').forEach(button => button.onclick = () => {
      const row = state.review.deliveries.find(d => d.id === button.dataset.evidence) || state.review.items.find(i => i.key === button.dataset.evidence);
      root.querySelector('#sr-dialog-body').innerHTML = `<h2>Evidencias rastreaveis</h2>${evidence(row?.evidenceIds || [])}`;
      root.querySelector('#sr-dialog').showModal();
    });
  }
  await run(async () => { state.projects = (await api('/projects')).projects; });
}
