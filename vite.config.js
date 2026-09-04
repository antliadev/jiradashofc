import { defineConfig } from 'vite';
import { resolve } from 'path';
import { execFileSync } from 'node:child_process';

function deploymentBranch() {
  const configured = process.env.VERCEL_GIT_COMMIT_REF || process.env.RJA_DEPLOY_BRANCH;
  if (configured) return configured;
  try {
    return execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

export default defineConfig({
  define: {
    'import.meta.env.RJA_GIT_BRANCH': JSON.stringify(deploymentBranch()),
  },
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src')
    }
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false
      }
    }
  },
  optimizeDeps: {
    include: ['html2canvas', 'jspdf']
  },
  build: {
    chunkSizeWarningLimit: 1000
  }
});
