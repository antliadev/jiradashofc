const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export function filterHealthRows(rows, filters = {}) {
  const query = normalize(filters.search).trim();
  const filtered = rows.filter(({ card, impact, assigneeName }) => {
    return (!query || [card.key, card.title, card.status, assigneeName].some(value => normalize(value).includes(query)))
      && (!filters.status || card.status === filters.status)
      && (!filters.assignee || (card.assigneeId || 'unassigned') === filters.assignee)
      && (!filters.risk
        || (filters.risk === 'critical' && impact.risk >= 85)
        || (filters.risk === 'high' && impact.risk >= 60 && impact.risk < 85)
        || (filters.risk === 'attention' && impact.risk < 60));
  });
  const direction = filters.direction === 'asc' ? 1 : -1;
  const field = filters.sort || 'risk';
  return filtered.sort((a, b) => {
    const av = field === 'risk' ? a.impact.risk : a.card[field] || '';
    const bv = field === 'risk' ? b.impact.risk : b.card[field] || '';
    const comparison = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv), 'pt-BR', { numeric: true });
    return comparison * direction || String(a.card.key).localeCompare(String(b.card.key), 'pt-BR', { numeric: true });
  });
}

export async function syncHealthProject(service, projectKey, { delay = ms => new Promise(resolve => setTimeout(resolve, ms)), attempts = 60 } = {}) {
  if (!/^[A-Z][A-Z0-9_]*$/i.test(projectKey || '')) throw new Error('Selecione um projeto valido para atualizar.');
  // A running job may belong to another screen. Wait, then request our scope again.
  for (let request = 0; request < 2; request += 1) {
    const started = await service.startScopedJiraSync({ projectKeys: [projectKey] });
    const jobId = started.jobId || started.job?.id || started.id;
    if (!jobId) throw new Error('O servidor nao confirmou a sincronizacao. Tente novamente.');
    let completed = false;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const status = await service.getSyncStatus(jobId);
      if (['error', 'failed'].includes(status?.status)) throw new Error(status.error || 'A sincronizacao do Jira falhou.');
      if (['success', 'completed'].includes(status?.status)) { completed = true; break; }
      await delay(2000);
    }
    if (!completed) throw new Error('A sincronizacao continua em andamento. Consulte a tela Dados.');
    if (!started.alreadyRunning) return service.ensureLoaded({ force: true });
  }
  throw new Error('Outra sincronizacao esta em andamento. Tente atualizar este projeto novamente.');
}
