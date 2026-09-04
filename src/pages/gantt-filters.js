/**
 * Regras puras dos filtros dependentes do Gantt.
 * Mantidas fora da renderização para que a elegibilidade seja testável sem DOM.
 */
export function getEligibleGanttAssignees(items, users, projectId = '') {
  const eligibleIds = new Set(
    items
      .filter(item => !projectId || item.card.projectId === projectId)
      .map(item => item.card.assigneeId)
      .filter(id => id && id !== 'unassigned'),
  );

  return users.filter(user => eligibleIds.has(user.id));
}

export function normalizeGanttAssignee(assigneeId, eligibleAssignees) {
  if (!assigneeId) return '';
  return eligibleAssignees.some(user => user.id === assigneeId) ? assigneeId : '';
}

export function filterGanttItems(items, { projectId = '', assigneeId = '' } = {}) {
  return items.filter(item => (
    (!projectId || item.card.projectId === projectId)
    && (!assigneeId || item.card.assigneeId === assigneeId)
  ));
}
