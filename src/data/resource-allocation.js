const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#a855f7', '#14b8a6', '#f97316', '#84cc16', '#ec4899'];

function toDate(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    const dateOnly = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateOnly) return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function projectColor(projectId) {
  const text = String(projectId || '');
  let hash = 0;
  for (let index = 0; index < text.length; index++) hash = text.charCodeAt(index) + ((hash << 5) - hash);
  return COLORS[Math.abs(hash) % COLORS.length];
}

export function validateAllocationProject(project) {
  const errors = [];
  if (!String(project.name || '').trim()) errors.push('Nome do projeto é obrigatório.');
  if (!project.startDate) errors.push('Data de início do projeto é obrigatória.');
  if (!project.endDate) errors.push('Data prevista de término do projeto é obrigatória.');
  if (!project.status) errors.push('Status do projeto é obrigatório.');
  if (project.startDate && project.endDate && toDate(project.endDate) < toDate(project.startDate)) errors.push('Data final do projeto não pode ser anterior à inicial.');
  return errors;
}

export function validateAllocation(allocation) {
  const errors = [];
  if (!allocation.userId) errors.push('Profissional é obrigatório.');
  if (!allocation.projectId) errors.push('Projeto é obrigatório.');
  if (!allocation.startDate) errors.push('Data inicial da alocação é obrigatória.');
  if (!allocation.endDate) errors.push('Data final da alocação é obrigatória.');
  const percent = Number(allocation.percent);
  if (!Number.isFinite(percent) || percent <= 0) errors.push('Percentual de alocação deve ser maior que zero.');
  if (allocation.startDate && allocation.endDate && toDate(allocation.endDate) < toDate(allocation.startDate)) errors.push('Data final da alocação não pode ser anterior à inicial.');
  return errors;
}

export function overlaps(a, b) {
  const aStart = toDate(a.startDate), aEnd = toDate(a.endDate), bStart = toDate(b.startDate), bEnd = toDate(b.endDate);
  if (!aStart || !aEnd || !bStart || !bEnd) return false;
  return aStart <= bEnd && bStart <= aEnd;
}

export function allocationLoadByDay(allocations, userId, startDate, endDate, excludeId = '') {
  const start = toDate(startDate), end = toDate(endDate);
  if (!start || !end) return [];
  const days = [];
  for (let cursor = new Date(start); cursor <= end; cursor = addDays(cursor, 1)) {
    const active = allocations.filter(item => item.id !== excludeId && item.userId === userId && overlaps(item, { startDate: cursor, endDate: cursor }));
    days.push({ date: new Date(cursor), total: active.reduce((sum, item) => sum + Number(item.percent || 0), 0), allocations: active });
  }
  return days;
}

export function simulateAllocation(allocations, allocation) {
  const current = allocationLoadByDay(allocations, allocation.userId, allocation.startDate, allocation.endDate, allocation.id);
  const resulting = current.map(day => ({ ...day, total: day.total + Number(allocation.percent || 0) }));
  const peak = resulting.reduce((max, day) => Math.max(max, day.total), 0);
  return { peak, conflict: peak > 100, days: resulting };
}

export function summarizeResources(users, projects, allocations, todayValue = new Date(), alertDays = 30) {
  const today = toDate(todayValue);
  const alertUntil = addDays(today, alertDays);
  const byUser = users.map(user => {
    const userAllocations = allocations.filter(item => item.userId === user.id).sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
    const current = userAllocations.filter(item => overlaps(item, { startDate: today, endDate: today }));
    const future = userAllocations.filter(item => toDate(item.startDate) > today);
    const currentLoad = current.reduce((sum, item) => sum + Number(item.percent || 0), 0);
    const activeAndFuture = userAllocations.filter(item => toDate(item.endDate) >= today);
    const coveredUntil = activeAndFuture.reduce((max, item) => {
      const end = toDate(item.endDate);
      return end && (!max || end > max) ? end : max;
    }, null);
    const nextAvailability = coveredUntil ? addDays(coveredUntil, 1) : today;
    const nextProject = future[0] || null;
    const gaps = [];
    for (let index = 0; index < activeAndFuture.length - 1; index++) {
      const end = toDate(activeAndFuture[index].endDate);
      const nextStart = toDate(activeAndFuture[index + 1].startDate);
      if (end && nextStart && addDays(end, 1) < nextStart) gaps.push({ startDate: addDays(end, 1), endDate: addDays(nextStart, -1) });
    }
    return {
      user,
      allocations: userAllocations,
      current,
      future,
      currentLoad,
      status: currentLoad > 100 ? 'overallocated' : currentLoad === 100 ? 'full' : currentLoad > 0 ? 'partial' : 'available',
      coveredUntil,
      nextAvailability,
      nextProject,
      gaps,
      noFuture: current.length > 0 && future.length === 0,
      availableSoon: coveredUntil && coveredUntil >= today && coveredUntil <= alertUntil && future.length === 0,
      projectNames: current.map(item => projects.find(project => project.id === item.projectId)?.name || item.projectId),
    };
  });
  return {
    rows: byUser,
    totals: {
      professionals: byUser.length,
      full: byUser.filter(row => row.status === 'full').length,
      partial: byUser.filter(row => row.status === 'partial').length,
      available: byUser.filter(row => row.status === 'available').length,
      overallocated: byUser.filter(row => row.status === 'overallocated').length,
      noFuture: byUser.filter(row => row.noFuture).length,
      availableSoon: byUser.filter(row => row.availableSoon).length,
    },
  };
}

export function timelineRange(allocations, fallbackDate = new Date()) {
  const dates = allocations.flatMap(item => [toDate(item.startDate), toDate(item.endDate)]).filter(Boolean);
  if (!dates.length) {
    const start = toDate(fallbackDate);
    return { start, end: addDays(start, 120) };
  }
  return { start: new Date(Math.min(...dates.map(date => date.getTime()))), end: new Date(Math.max(...dates.map(date => date.getTime()))) };
}
