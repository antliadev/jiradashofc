/**
 * mock-data.js — Dados mockados realistas
 * Simula múltiplos projetos, analistas e cards coerentes.
 */
import { CardPriority, CardType } from './models.js';

// ─── Usuários / Analistas ─────────────────────────────
export const MOCK_USERS = [
  { id: 'u1', displayName: 'Ana Silva', email: 'ana.silva@empresa.com', avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Ana', active: true },
  { id: 'u2', displayName: 'Bruno Costa', email: 'bruno.costa@empresa.com', avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Bruno', active: true },
  { id: 'u3', displayName: 'Carla Mendes', email: 'carla.mendes@empresa.com', avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Carla', active: true },
  { id: 'u4', displayName: 'Diego Oliveira', email: 'diego.oliveira@empresa.com', avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Diego', active: true },
  { id: 'u5', displayName: 'Elena Rodrigues', email: 'elena.rodrigues@empresa.com', avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Elena', active: true },
  { id: 'u6', displayName: 'Felipe Santos', email: 'felipe.santos@empresa.com', avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Felipe', active: true },
  { id: 'u7', displayName: 'Gabriela Lima', email: 'gabriela.lima@empresa.com', avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Gabriela', active: true },
  { id: 'u8', displayName: 'Hugo Pereira', email: 'hugo.pereira@empresa.com', avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Hugo', active: true },
  { id: 'u9', displayName: 'Isabela Ferreira', email: 'isabela.ferreira@empresa.com', avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Isabela', active: true },
  { id: 'u10', displayName: 'João Almeida', email: 'joao.almeida@empresa.com', avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Joao', active: true },
];

// ─── Projetos ─────────────────────────────────────────
export const MOCK_PROJECTS = [
  { id: 'p1', key: 'PLAT', name: 'Plataforma Web', description: 'Sistema principal da plataforma SaaS', lead: 'u1', statusFlow: ['Backlog', 'To Do', 'In Progress', 'Code Review', 'Testing', 'Done'], createdAt: '2025-01-15T10:00:00Z' },
  { id: 'p2', key: 'MOB', name: 'App Mobile', description: 'Aplicativo iOS e Android', lead: 'u3', statusFlow: ['Backlog', 'To Do', 'Em Desenvolvimento', 'Em Revisão', 'QA', 'Concluído'], createdAt: '2025-02-01T10:00:00Z' },
  { id: 'p3', key: 'API', name: 'API Gateway', description: 'Microsserviços e integrações', lead: 'u5', statusFlow: ['Open', 'In Progress', 'In Review', 'Testing', 'Done', 'Blocked'], createdAt: '2025-03-10T10:00:00Z' },
  { id: 'p4', key: 'DATA', name: 'Data Pipeline', description: 'ETL e processamento de dados', lead: 'u7', statusFlow: ['Backlog', 'A Fazer', 'Em Andamento', 'Em Teste', 'Finalizado', 'Bloqueado'], createdAt: '2025-04-05T10:00:00Z' },
  { id: 'p5', key: 'INFRA', name: 'Infraestrutura Cloud', description: 'DevOps, CI/CD e infraestrutura', lead: 'u2', statusFlow: ['Novo', 'To Do', 'In Progress', 'Done', 'Blocked'], createdAt: '2025-05-20T10:00:00Z' },
];

// ─── Helpers para geração ─────────────────────────────
function d(daysOffset) {
  const dt = new Date();
  dt.setDate(dt.getDate() + daysOffset);
  return dt.toISOString();
}

const P = CardPriority;
const T = CardType;

// ─── Cards ────────────────────────────────────────────
export const MOCK_CARDS = [
  // PLAT (p1) — 14 cards
  { id:'c1', key:'PLAT-1', projectId:'p1', title:'Redesign do dashboard principal', assigneeId:'u1', status:'Done', priority:P.HIGH, type:T.STORY, createdAt:d(-45), dueDate:d(-10), sprint:'Sprint 12', storyPoints:8, labels:['frontend','ux'], timeEstimated:32, timeSpent:28 },
  { id:'c2', key:'PLAT-2', projectId:'p1', title:'Implementar autenticação 2FA', assigneeId:'u2', status:'In Progress', priority:P.HIGHEST, type:T.STORY, createdAt:d(-30), dueDate:d(5), sprint:'Sprint 13', storyPoints:13, labels:['security','backend'], timeEstimated:40, timeSpent:24 },
  { id:'c3', key:'PLAT-3', projectId:'p1', title:'Bug no filtro de relatórios', assigneeId:'u4', status:'Code Review', priority:P.HIGH, type:T.BUG, createdAt:d(-15), dueDate:d(-2), sprint:'Sprint 13', storyPoints:3, labels:['bug','reports'], timeEstimated:8, timeSpent:10 },
  { id:'c4', key:'PLAT-4', projectId:'p1', title:'Página de configurações do usuário', assigneeId:'u6', status:'Testing', priority:P.MEDIUM, type:T.STORY, createdAt:d(-20), dueDate:d(3), sprint:'Sprint 13', storyPoints:5, labels:['frontend'], timeEstimated:16, timeSpent:12 },
  { id:'c5', key:'PLAT-5', projectId:'p1', title:'Otimização de queries do dashboard', assigneeId:'u8', status:'To Do', priority:P.MEDIUM, type:T.TASK, createdAt:d(-10), dueDate:d(15), sprint:'Sprint 14', storyPoints:5, labels:['performance','backend'], timeEstimated:16, timeSpent:0 },
  { id:'c6', key:'PLAT-6', projectId:'p1', title:'Migração para React 19', assigneeId:'u1', status:'Backlog', priority:P.LOW, type:T.TASK, createdAt:d(-5), dueDate:d(30), sprint:null, storyPoints:21, labels:['tech-debt'], timeEstimated:64, timeSpent:0 },
  { id:'c7', key:'PLAT-7', projectId:'p1', title:'Exportação PDF de relatórios', assigneeId:'u4', status:'In Progress', priority:P.HIGH, type:T.STORY, createdAt:d(-12), dueDate:d(-1), sprint:'Sprint 13', storyPoints:8, labels:['feature','reports'], timeEstimated:24, timeSpent:20 },
  { id:'c8', key:'PLAT-8', projectId:'p1', title:'Corrigir layout responsivo mobile', assigneeId:'u6', status:'Done', priority:P.MEDIUM, type:T.BUG, createdAt:d(-25), dueDate:d(-15), sprint:'Sprint 12', storyPoints:3, labels:['bug','responsive'], timeEstimated:8, timeSpent:6 },
  { id:'c9', key:'PLAT-9', projectId:'p1', title:'Sistema de notificações push', assigneeId:'u2', status:'Backlog', priority:P.MEDIUM, type:T.EPIC, createdAt:d(-8), dueDate:d(45), sprint:null, storyPoints:34, labels:['feature'], timeEstimated:120, timeSpent:0 },
  { id:'c10', key:'PLAT-10', projectId:'p1', title:'Integração com Slack', assigneeId:'u8', status:'To Do', priority:P.LOW, type:T.STORY, createdAt:d(-3), dueDate:d(20), sprint:'Sprint 14', storyPoints:8, labels:['integration'], timeEstimated:24, timeSpent:0 },
  { id:'c11', key:'PLAT-11', projectId:'p1', title:'Testes E2E do checkout', assigneeId:'u10', status:'In Progress', priority:P.HIGH, type:T.TASK, createdAt:d(-7), dueDate:d(2), sprint:'Sprint 13', storyPoints:5, labels:['testing'], timeEstimated:16, timeSpent:8 },
  { id:'c12', key:'PLAT-12', projectId:'p1', title:'Melhorar acessibilidade WCAG', assigneeId:'u9', status:'Done', priority:P.MEDIUM, type:T.TASK, createdAt:d(-40), dueDate:d(-20), sprint:'Sprint 11', storyPoints:8, labels:['a11y'], timeEstimated:24, timeSpent:20 },
  { id:'c13', key:'PLAT-13', projectId:'p1', title:'Cache de sessão Redis', assigneeId:'u2', status:'Done', priority:P.HIGH, type:T.TASK, createdAt:d(-35), dueDate:d(-18), sprint:'Sprint 12', storyPoints:5, labels:['performance','backend'], timeEstimated:16, timeSpent:14 },
  { id:'c14', key:'PLAT-14', projectId:'p1', title:'Erro 500 na listagem de pedidos', assigneeId:'u4', status:'Blocked', priority:P.HIGHEST, type:T.BUG, createdAt:d(-2), dueDate:d(1), sprint:'Sprint 13', storyPoints:3, labels:['bug','critical'], timeEstimated:8, timeSpent:4 },

  // MOB (p2) — 12 cards
  { id:'c15', key:'MOB-1', projectId:'p2', title:'Tela de onboarding animada', assigneeId:'u3', status:'Concluído', priority:P.HIGH, type:T.STORY, createdAt:d(-50), dueDate:d(-25), sprint:'Sprint 8', storyPoints:8, labels:['ux','animation'], timeEstimated:24, timeSpent:22 },
  { id:'c16', key:'MOB-2', projectId:'p2', title:'Integração biométrica iOS', assigneeId:'u5', status:'Em Desenvolvimento', priority:P.HIGHEST, type:T.STORY, createdAt:d(-20), dueDate:d(4), sprint:'Sprint 10', storyPoints:13, labels:['ios','security'], timeEstimated:40, timeSpent:30 },
  { id:'c17', key:'MOB-3', projectId:'p2', title:'Push notifications Android', assigneeId:'u7', status:'QA', priority:P.HIGH, type:T.STORY, createdAt:d(-18), dueDate:d(1), sprint:'Sprint 10', storyPoints:8, labels:['android','notifications'], timeEstimated:24, timeSpent:20 },
  { id:'c18', key:'MOB-4', projectId:'p2', title:'Crash ao abrir câmera no Android 14', assigneeId:'u3', status:'Em Revisão', priority:P.HIGHEST, type:T.BUG, createdAt:d(-5), dueDate:d(-1), sprint:'Sprint 10', storyPoints:3, labels:['bug','android','critical'], timeEstimated:8, timeSpent:6 },
  { id:'c19', key:'MOB-5', projectId:'p2', title:'Offline mode com sync', assigneeId:'u5', status:'Backlog', priority:P.MEDIUM, type:T.EPIC, createdAt:d(-10), dueDate:d(40), sprint:null, storyPoints:21, labels:['feature','offline'], timeEstimated:80, timeSpent:0 },
  { id:'c20', key:'MOB-6', projectId:'p2', title:'Dark mode completo', assigneeId:'u9', status:'Em Desenvolvimento', priority:P.MEDIUM, type:T.STORY, createdAt:d(-14), dueDate:d(7), sprint:'Sprint 10', storyPoints:8, labels:['ux','theme'], timeEstimated:24, timeSpent:12 },
  { id:'c21', key:'MOB-7', projectId:'p2', title:'Otimização de imagens lazy load', assigneeId:'u7', status:'To Do', priority:P.LOW, type:T.TASK, createdAt:d(-6), dueDate:d(14), sprint:'Sprint 11', storyPoints:3, labels:['performance'], timeEstimated:8, timeSpent:0 },
  { id:'c22', key:'MOB-8', projectId:'p2', title:'Testes unitários módulo de pagamento', assigneeId:'u10', status:'Em Desenvolvimento', priority:P.HIGH, type:T.TASK, createdAt:d(-11), dueDate:d(-3), sprint:'Sprint 10', storyPoints:5, labels:['testing','payments'], timeEstimated:16, timeSpent:14 },
  { id:'c23', key:'MOB-9', projectId:'p2', title:'Widget de resumo para home screen', assigneeId:'u3', status:'Concluído', priority:P.MEDIUM, type:T.STORY, createdAt:d(-30), dueDate:d(-12), sprint:'Sprint 9', storyPoints:5, labels:['feature','ios'], timeEstimated:16, timeSpent:18 },
  { id:'c24', key:'MOB-10', projectId:'p2', title:'Refatoração da navegação', assigneeId:'u9', status:'Concluído', priority:P.MEDIUM, type:T.TASK, createdAt:d(-35), dueDate:d(-20), sprint:'Sprint 8', storyPoints:8, labels:['tech-debt'], timeEstimated:24, timeSpent:20 },
  { id:'c25', key:'MOB-11', projectId:'p2', title:'Acessibilidade VoiceOver', assigneeId:'u5', status:'To Do', priority:P.MEDIUM, type:T.TASK, createdAt:d(-4), dueDate:d(12), sprint:'Sprint 11', storyPoints:5, labels:['a11y','ios'], timeEstimated:16, timeSpent:0 },
  { id:'c26', key:'MOB-12', projectId:'p2', title:'Erro de sincronização de carrinho', assigneeId:'u7', status:'Bloqueado', priority:P.HIGH, type:T.BUG, createdAt:d(-3), dueDate:d(0), sprint:'Sprint 10', storyPoints:3, labels:['bug','sync'], timeEstimated:8, timeSpent:2 },

  // API (p3) — 12 cards
  { id:'c27', key:'API-1', projectId:'p3', title:'Endpoint de busca avançada', assigneeId:'u5', status:'Done', priority:P.HIGH, type:T.STORY, createdAt:d(-40), dueDate:d(-22), sprint:'Sprint 6', storyPoints:8, labels:['search','rest'], timeEstimated:24, timeSpent:20 },
  { id:'c28', key:'API-2', projectId:'p3', title:'Rate limiting por tenant', assigneeId:'u2', status:'In Progress', priority:P.HIGHEST, type:T.STORY, createdAt:d(-15), dueDate:d(3), sprint:'Sprint 8', storyPoints:13, labels:['security','multi-tenant'], timeEstimated:40, timeSpent:28 },
  { id:'c29', key:'API-3', projectId:'p3', title:'Documentação OpenAPI 3.1', assigneeId:'u8', status:'In Review', priority:P.MEDIUM, type:T.TASK, createdAt:d(-10), dueDate:d(5), sprint:'Sprint 8', storyPoints:5, labels:['docs'], timeEstimated:16, timeSpent:10 },
  { id:'c30', key:'API-4', projectId:'p3', title:'Webhook de eventos', assigneeId:'u6', status:'Testing', priority:P.HIGH, type:T.STORY, createdAt:d(-22), dueDate:d(2), sprint:'Sprint 8', storyPoints:8, labels:['webhooks','events'], timeEstimated:24, timeSpent:18 },
  { id:'c31', key:'API-5', projectId:'p3', title:'Bug no parse de datas UTC', assigneeId:'u10', status:'Done', priority:P.HIGH, type:T.BUG, createdAt:d(-28), dueDate:d(-15), sprint:'Sprint 7', storyPoints:2, labels:['bug','datetime'], timeEstimated:4, timeSpent:3 },
  { id:'c32', key:'API-6', projectId:'p3', title:'GraphQL subscriptions', assigneeId:'u5', status:'Open', priority:P.MEDIUM, type:T.EPIC, createdAt:d(-8), dueDate:d(35), sprint:null, storyPoints:21, labels:['graphql','feature'], timeEstimated:64, timeSpent:0 },
  { id:'c33', key:'API-7', projectId:'p3', title:'Health check endpoints', assigneeId:'u8', status:'Done', priority:P.MEDIUM, type:T.TASK, createdAt:d(-35), dueDate:d(-25), sprint:'Sprint 6', storyPoints:3, labels:['devops','monitoring'], timeEstimated:8, timeSpent:6 },
  { id:'c34', key:'API-8', projectId:'p3', title:'Migração de auth para OAuth2', assigneeId:'u2', status:'Blocked', priority:P.HIGHEST, type:T.STORY, createdAt:d(-6), dueDate:d(8), sprint:'Sprint 8', storyPoints:13, labels:['auth','security'], timeEstimated:40, timeSpent:8 },
  { id:'c35', key:'API-9', projectId:'p3', title:'Cache distribuído com Redis', assigneeId:'u6', status:'In Progress', priority:P.HIGH, type:T.TASK, createdAt:d(-9), dueDate:d(6), sprint:'Sprint 8', storyPoints:8, labels:['performance','cache'], timeEstimated:24, timeSpent:10 },
  { id:'c36', key:'API-10', projectId:'p3', title:'Logs estruturados JSON', assigneeId:'u10', status:'Done', priority:P.MEDIUM, type:T.TASK, createdAt:d(-30), dueDate:d(-18), sprint:'Sprint 7', storyPoints:3, labels:['logging','observability'], timeEstimated:8, timeSpent:8 },
  { id:'c37', key:'API-11', projectId:'p3', title:'Compressão gzip de responses', assigneeId:'u8', status:'In Progress', priority:P.LOW, type:T.TASK, createdAt:d(-4), dueDate:d(10), sprint:'Sprint 9', storyPoints:2, labels:['performance'], timeEstimated:4, timeSpent:1 },
  { id:'c38', key:'API-12', projectId:'p3', title:'Timeout handling nos microsserviços', assigneeId:'u2', status:'Open', priority:P.HIGH, type:T.TASK, createdAt:d(-2), dueDate:d(8), sprint:'Sprint 9', storyPoints:5, labels:['resilience'], timeEstimated:16, timeSpent:0 },

  // DATA (p4) — 10 cards
  { id:'c39', key:'DATA-1', projectId:'p4', title:'Pipeline ETL de vendas', assigneeId:'u7', status:'Finalizado', priority:P.HIGH, type:T.STORY, createdAt:d(-45), dueDate:d(-28), sprint:'Sprint 4', storyPoints:13, labels:['etl','sales'], timeEstimated:40, timeSpent:36 },
  { id:'c40', key:'DATA-2', projectId:'p4', title:'Dashboard de métricas real-time', assigneeId:'u9', status:'Em Andamento', priority:P.HIGHEST, type:T.STORY, createdAt:d(-18), dueDate:d(5), sprint:'Sprint 6', storyPoints:13, labels:['dashboard','realtime'], timeEstimated:40, timeSpent:22 },
  { id:'c41', key:'DATA-3', projectId:'p4', title:'Ingestão de dados Kafka', assigneeId:'u7', status:'Em Teste', priority:P.HIGH, type:T.STORY, createdAt:d(-25), dueDate:d(1), sprint:'Sprint 6', storyPoints:8, labels:['kafka','streaming'], timeEstimated:24, timeSpent:20 },
  { id:'c42', key:'DATA-4', projectId:'p4', title:'Modelo preditivo de churn', assigneeId:'u9', status:'A Fazer', priority:P.MEDIUM, type:T.EPIC, createdAt:d(-12), dueDate:d(30), sprint:null, storyPoints:21, labels:['ml','churn'], timeEstimated:80, timeSpent:0 },
  { id:'c43', key:'DATA-5', projectId:'p4', title:'Bug no cálculo de agregações', assigneeId:'u4', status:'Bloqueado', priority:P.HIGHEST, type:T.BUG, createdAt:d(-3), dueDate:d(-1), sprint:'Sprint 6', storyPoints:3, labels:['bug','critical'], timeEstimated:8, timeSpent:6 },
  { id:'c44', key:'DATA-6', projectId:'p4', title:'Data lake S3 particionamento', assigneeId:'u7', status:'Finalizado', priority:P.HIGH, type:T.TASK, createdAt:d(-38), dueDate:d(-22), sprint:'Sprint 5', storyPoints:8, labels:['s3','partitioning'], timeEstimated:24, timeSpent:22 },
  { id:'c45', key:'DATA-7', projectId:'p4', title:'Qualidade de dados - validações', assigneeId:'u4', status:'Em Andamento', priority:P.HIGH, type:T.STORY, createdAt:d(-8), dueDate:d(4), sprint:'Sprint 6', storyPoints:8, labels:['data-quality'], timeEstimated:24, timeSpent:14 },
  { id:'c46', key:'DATA-8', projectId:'p4', title:'Relatório automatizado semanal', assigneeId:'u9', status:'A Fazer', priority:P.MEDIUM, type:T.TASK, createdAt:d(-5), dueDate:d(18), sprint:'Sprint 7', storyPoints:5, labels:['reporting','automation'], timeEstimated:16, timeSpent:0 },
  { id:'c47', key:'DATA-9', projectId:'p4', title:'Backup automático BigQuery', assigneeId:'u7', status:'Finalizado', priority:P.MEDIUM, type:T.TASK, createdAt:d(-42), dueDate:d(-30), sprint:'Sprint 4', storyPoints:3, labels:['backup','bigquery'], timeEstimated:8, timeSpent:6 },
  { id:'c48', key:'DATA-10', projectId:'p4', title:'Lineage tracking de dados', assigneeId:'u4', status:'Backlog', priority:P.LOW, type:T.STORY, createdAt:d(-2), dueDate:d(25), sprint:null, storyPoints:8, labels:['lineage','governance'], timeEstimated:24, timeSpent:0 },

  // INFRA (p5) — 10 cards
  { id:'c49', key:'INFRA-1', projectId:'p5', title:'Migração para Kubernetes', assigneeId:'u2', status:'Done', priority:P.HIGHEST, type:T.EPIC, createdAt:d(-60), dueDate:d(-15), sprint:'Sprint 3', storyPoints:34, labels:['k8s','migration'], timeEstimated:120, timeSpent:110 },
  { id:'c50', key:'INFRA-2', projectId:'p5', title:'CI/CD com GitHub Actions', assigneeId:'u6', status:'Done', priority:P.HIGH, type:T.STORY, createdAt:d(-50), dueDate:d(-30), sprint:'Sprint 2', storyPoints:13, labels:['ci-cd','github'], timeEstimated:40, timeSpent:35 },
  { id:'c51', key:'INFRA-3', projectId:'p5', title:'Monitoramento Grafana/Prometheus', assigneeId:'u8', status:'In Progress', priority:P.HIGH, type:T.STORY, createdAt:d(-14), dueDate:d(6), sprint:'Sprint 5', storyPoints:8, labels:['monitoring','observability'], timeEstimated:24, timeSpent:14 },
  { id:'c52', key:'INFRA-4', projectId:'p5', title:'Terraform módulos reutilizáveis', assigneeId:'u2', status:'In Progress', priority:P.MEDIUM, type:T.TASK, createdAt:d(-10), dueDate:d(8), sprint:'Sprint 5', storyPoints:8, labels:['terraform','iac'], timeEstimated:24, timeSpent:10 },
  { id:'c53', key:'INFRA-5', projectId:'p5', title:'Alertas PagerDuty on-call', assigneeId:'u6', status:'To Do', priority:P.HIGH, type:T.TASK, createdAt:d(-7), dueDate:d(5), sprint:'Sprint 5', storyPoints:5, labels:['alerting','oncall'], timeEstimated:16, timeSpent:0 },
  { id:'c54', key:'INFRA-6', projectId:'p5', title:'Segurança de secrets Vault', assigneeId:'u8', status:'Blocked', priority:P.HIGHEST, type:T.STORY, createdAt:d(-4), dueDate:d(3), sprint:'Sprint 5', storyPoints:8, labels:['security','vault'], timeEstimated:24, timeSpent:4 },
  { id:'c55', key:'INFRA-7', projectId:'p5', title:'Cost optimization AWS', assigneeId:'u2', status:'Done', priority:P.MEDIUM, type:T.TASK, createdAt:d(-30), dueDate:d(-15), sprint:'Sprint 4', storyPoints:5, labels:['cost','aws'], timeEstimated:16, timeSpent:12 },
  { id:'c56', key:'INFRA-8', projectId:'p5', title:'Auto-scaling policies', assigneeId:'u6', status:'Novo', priority:P.MEDIUM, type:T.TASK, createdAt:d(-3), dueDate:d(15), sprint:'Sprint 6', storyPoints:5, labels:['scaling','k8s'], timeEstimated:16, timeSpent:0 },
  { id:'c57', key:'INFRA-9', projectId:'p5', title:'DR plan e testes de failover', assigneeId:'u8', status:'To Do', priority:P.HIGH, type:T.STORY, createdAt:d(-5), dueDate:d(12), sprint:'Sprint 6', storyPoints:13, labels:['dr','resilience'], timeEstimated:40, timeSpent:0 },
  { id:'c58', key:'INFRA-10', projectId:'p5', title:'Log aggregation ELK Stack', assigneeId:'u2', status:'Done', priority:P.MEDIUM, type:T.TASK, createdAt:d(-40), dueDate:d(-25), sprint:'Sprint 3', storyPoints:8, labels:['logging','elk'], timeEstimated:24, timeSpent:20 },
];
