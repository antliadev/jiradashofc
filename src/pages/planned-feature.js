/**
 * planned-feature.js — Tela informativa para submenus planejados.
 */
import { sanitize } from '../utils/helpers.js';

const FEATURE_COPY = {
  '/contracts/crawford': {
    title: 'Contratos Consumo Horas - Crawford',
    subtitle: 'Submenu criado conforme RF-001',
    description: 'A funcionalidade Horas Crawford ainda nao existe como pagina propria neste codigo. O acesso foi reservado no novo menu para receber a implementacao sem alterar os demais fluxos.',
  },
  '/contracts/docwise': {
    title: 'Contratos Consumo Horas - Docwise',
    subtitle: 'Submenu criado conforme RF-001',
    description: 'A funcionalidade Horas Docwise ainda nao existe como pagina propria neste codigo. O acesso foi reservado no novo menu para receber a implementacao sem alterar os demais fluxos.',
  },
  '/projects/health': {
    title: 'Saude Detalhamento Cards Projetos',
    subtitle: 'Funcionalidade especificada no RF-004.3',
    description: 'Esta tela sera implementada no assunto Relatorios de Projetos e Clientes. O submenu ja esta disponivel no caminho correto em Projetos.',
  },
  '/projects/detailed-report': {
    title: 'Relatorio Gerencial Detalhado - Clientes',
    subtitle: 'Funcionalidade especificada no RF-004.2',
    description: 'Esta tela sera implementada na etapa de relatorios detalhados. O acesso ja esta organizado dentro do menu Projetos.',
  },
  '/analysts/comparative': {
    title: 'Analistas - Comparativo',
    subtitle: 'Funcionalidade especificada no RF-005.2',
    description: 'Esta tela sera implementada na etapa de indicadores de analistas. O submenu ja esta disponivel dentro de Analistas.',
  },
  '/analysts/evolution': {
    title: 'Analistas - Evolucao',
    subtitle: 'Funcionalidade especificada no RF-005.3',
    description: 'Esta tela sera implementada na etapa de indicadores de analistas. O submenu ja esta disponivel dentro de Analistas.',
  },
};

export function renderPlannedFeature(params = {}) {
  const path = params.path || (window.location.hash.replace(/^#\/?/, '/') || '/').split('?')[0];
  const feature = FEATURE_COPY[path] || {
    title: 'Funcionalidade em preparacao',
    subtitle: 'Submenu criado para requisito futuro',
    description: 'O acesso foi reservado para a proxima etapa de implementacao.',
  };

  const header = document.getElementById('page-header');
  const content = document.getElementById('page-content');

  header.innerHTML = `
    <div>
      <h2>${sanitize(feature.title)}</h2>
      <div class="subtitle">${sanitize(feature.subtitle)}</div>
    </div>
  `;

  content.innerHTML = `
    <div class="empty-state planned-feature">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 20h9"/>
        <path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4Z"/>
      </svg>
      <h3>Submenu pronto para implementacao</h3>
      <p>${sanitize(feature.description)}</p>
    </div>
  `;
}
