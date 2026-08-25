/**
 * projects.js — Página de listagem de projetos
 */
import { dataService } from '../data/data-service.js';
import { healthLabel, sanitize, sanitizeTitle } from '../utils/helpers.js';

export function renderProjects() {
  const header = document.getElementById('page-header');
  const content = document.getElementById('page-content');
  
  header.innerHTML = `
    <div>
      <h2>Projetos</h2>
      <div class="subtitle">Gestão e acompanhamento de todos os espaços</div>
    </div>
  `;

  const projects = dataService.getProjects();

  content.innerHTML = `
    <div class="project-grid">
      ${projects.map(p => {
        const stats = dataService.getProjectStats(p.id);
        return `
          <div class="project-card" onclick="location.hash='#/board?projectKey=${sanitize(p.key)}'">
            <div style="display: flex; justify-content: space-between; align-items: flex-start;">
              <span class="project-key">${sanitize(p.key)}</span>
              <span class="badge badge-health-${stats.health}">${healthLabel(stats.health)}</span>
            </div>
            <h3 class="project-name">${sanitize(p.name)}</h3>
            <p class="project-desc">${sanitize(p.description || '')}</p>
            
            <div style="margin-bottom: 20px;">
              <div style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 6px;">
                <span style="color: var(--text-secondary);">Progresso</span>
                <span style="font-weight: 700;">${stats.progress}%</span>
              </div>
              <div class="progress-bar">
                <div class="fill" style="width: ${stats.progress}%;"></div>
              </div>
            </div>

            <div class="project-stats">
              <div class="stat-item">
                <div class="stat-value">${stats.total}</div>
                <div class="stat-label">Cards</div>
              </div>
              <div class="stat-item">
                <div class="stat-value" style="color: var(--success);">${stats.done}</div>
                <div class="stat-label">Concluídos</div>
              </div>
              <div class="stat-item">
                <div class="stat-value" style="color: var(--danger);">${stats.overdue}</div>
                <div class="stat-label">Atrasados</div>
              </div>
            </div>

            <div style="margin-top: 20px; display: flex; justify-content: space-between; align-items: center;">
              <div class="avatar-stack">
                ${stats.team.slice(0, 4).map(uid => {
                  const u = dataService.getUserById(uid);
                  return u ? `<img src="${sanitizeTitle(u.avatarUrl || '')}" class="avatar avatar-sm" title="${sanitizeTitle(u.displayName)}" onerror="this.style.display='none'">` : '';
                }).join('')}
                ${stats.team.length > 4 ? `<div class="avatar avatar-sm" style="display: flex; align-items: center; justify-content: center; font-size: 10px; background: var(--bg-secondary); color: var(--text-muted);">+${stats.team.length - 4}</div>` : ''}
              </div>
              <span style="font-size: 11px; color: var(--text-muted);">SP: ${stats.storyPointsDone}/${stats.storyPoints}</span>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}
