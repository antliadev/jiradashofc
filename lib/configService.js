/**
 * configService.js — Serviço de configuração do Jira com Supabase
 * 
 * Em produção: usa Supabase para persistência
 * Em desenvolvimento: usa arquivo local
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { supabase, isConfigured } from './supabaseServer.js';
import { encrypt, decrypt } from './encryption.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Verificar se está em produção Vercel
const IS_VERCEL = process.env.VERCEL === '1' || process.env.VERCEL === 'true';
const IS_PRODUCTION = process.env.NODE_ENV === 'production' || IS_VERCEL;

// Arquivo local para desenvolvimento
const CONFIG_FILE = path.join(__dirname, '../jira-config.json');

const DEFAULT_JQL = 'project in (BLCASH, BB, CEP, CTR, CVM175, DTVSLI, ETF, PGINT, SDDS2, SDDSF2, BNPTD, BTA, MAR, P1) AND status is not EMPTY ORDER BY project ASC, status ASC, assignee ASC, updated DESC';
const DEFAULT_CACHE_TTL = 10;

class ConfigService {
  constructor() {
    this._config = this._loadConfig();
  }

  _loadConfig() {
    // Em produção com Supabase, carregar do Supabase
    if (IS_PRODUCTION && isConfigured && supabase) {
      return {
        source: 'supabase',
        isConfigured: false // será verificado dinamicamente
      };
    }

    // Desenvolvimento - tentar carregar do arquivo
    let configFromFile = {};
    try {
      if (fs.existsSync(CONFIG_FILE)) {
        const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
        configFromFile = JSON.parse(data);
      }
    } catch (error) {
      console.error('[ConfigService] Erro ao carregar configuração:', error.message);
    }

    return {
      baseUrl: configFromFile.baseUrl || '',
      email: configFromFile.email || '',
      token: configFromFile.token || '',
      jql: configFromFile.jql || DEFAULT_JQL,
      cacheTtlMinutes: configFromFile.cacheTtlMinutes || DEFAULT_CACHE_TTL,
      lastSync: configFromFile.lastSync || null,
      lastSyncStatus: configFromFile.lastSyncStatus || null,
      lastSyncError: configFromFile.lastSyncError || null,
      source: 'file'
    };
  }

  _saveConfigLocal(configToSave) {
    if (IS_PRODUCTION) return; // Não salvar local em produção

    try {
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(configToSave, null, 2));
    } catch (error) {
      console.error('[ConfigService] Erro ao salvar configuração:', error.message);
    }
  }

  /**
   * Busca configuração ativa do Supabase
   */
  async getActiveConnection() {
    if (!isConfigured || !supabase) {
      return null;
    }

    try {
      const { data, error } = await supabase
        .from('jira_connections')
        .select('*')
        .eq('is_active', true)
        .limit(1)
        .single();

      if (error) {
        console.error('[ConfigService] Erro ao buscar conexão:', error.message);
        return null;
      }

      if (!data) {
        return null;
      }

      // Descriptografar token
      let token = '';
      try {
        token = decrypt(data.api_token_encrypted);
      } catch (e) {
        console.error('[ConfigService] Erro ao descriptografar token:', e.message);
      }

      // Verificar se o status está preso (running há mais de 5 minutos)
      let syncStatus = data.last_sync_status;
      let syncError = data.last_sync_error;
      let syncAt = data.last_sync_at;

      if (syncStatus === 'running' && syncAt) {
        const lastSyncDate = new Date(syncAt);
        const diffMinutes = (new Date() - lastSyncDate) / (1000 * 60);
        
        if (diffMinutes > 5) {
          console.warn('[ConfigService] Detectado sync preso (> 5 min). Resetando.');
          syncStatus = 'error';
          syncError = 'Processo interrompido por inatividade (Timeout)';
          
          // Tentar atualizar no banco em background
          supabase.from('jira_connections').update({ 
            last_sync_status: syncStatus,
            last_sync_error: syncError
          }).eq('id', data.id).then(({error}) => {
            if (error) console.error('[ConfigService] Erro ao resetar sync preso:', error.message);
          });
        }
      }

      return {
        baseUrl: data.base_url,
        email: data.email,
        token: token,
        jql: data.jql,
        cacheTtl: data.cache_ttl,
        id: data.id,
        lastSync: syncAt,
        lastSyncStatus: syncStatus,
        lastSyncError: syncError
      };
    } catch (error) {
      console.error('[ConfigService] Erro ao buscar conexão do Supabase:', error.message);
      return null;
    }
  }

  /**
   * Salva configuração no Supabase
   */
  async saveConnection({ baseUrl, email, token, jql, cacheTtlMinutes }) {
    if (!isConfigured || !supabase) {
      // Salvar localmente em desenvolvimento
      this._config = {
        ...this._config,
        baseUrl,
        email,
        token,
        jql,
        cacheTtlMinutes
      };
      this._saveConfigLocal(this._config);
      return this.getConfig();
    }

    const tokenEncrypted = encrypt(token);

    // Desativar conexões antigas
    await supabase
      .from('jira_connections')
      .update({ is_active: false })
      .eq('is_active', true);

    // Inserir nova conexão
    const { data, error } = await supabase
      .from('jira_connections')
      .insert({
        base_url: baseUrl.replace(/\/$/, ''),
        email: email,
        api_token_encrypted: tokenEncrypted,
        jql: jql || DEFAULT_JQL,
        cache_ttl: (cacheTtlMinutes || DEFAULT_CACHE_TTL) * 60 * 1000,
        is_active: true
      })
      .select()
      .single();

    if (error) {
      console.error('[ConfigService] Erro ao salvar conexão:', error.message);
      throw new Error('Erro ao salvar configuração: ' + error.message);
    }

    return this.getConfig();
  }

  async getConfigAsync() {
    const isConfigured = await this.isConfiguredAsync();
    const conn = isConfigured ? await this.getActiveConnection() : null;

    if (IS_PRODUCTION) {
      return {
        isConfigured: isConfigured, 
        source: 'supabase',
        canEdit: true,
        isProduction: true,
        lastSync: conn?.lastSync || null,
        lastSyncStatus: conn?.lastSyncStatus || null,
        lastSyncError: conn?.lastSyncError || null,
        baseUrl: conn?.baseUrl || '',
        jql: conn?.jql || DEFAULT_JQL,
        email: '' // Sempre vazio conforme solicitado pelo usuário
      };
    }

    // Desenvolvimento
    const { baseUrl, email, jql, cacheTtlMinutes, lastSync, lastSyncStatus, lastSyncError } = this._config;
    const hasToken = !!this._config.token;
    const isLocalConfigured = !!(baseUrl && email && hasToken);

    return {
      baseUrl,
      email: '', // Sempre vazio conforme solicitado
      jql,
      cacheTtlMinutes,
      hasToken,
      isConfigured: isLocalConfigured,
      isProduction: IS_PRODUCTION,
      source: this._config.source,
      canEdit: true,
      lastSync,
      lastSyncStatus,
      lastSyncError
    };
  }

  getConfig() {
    // Mantido para compatibilidade síncrona, mas recomenda-se getConfigAsync
    return {
      ...this._config,
      email: '',
      isConfigured: this.isConfigured(),
      isProduction: IS_PRODUCTION
    };
  }

  /**
   * Retorna configuração para uso interno (com token)
   */
  async getActiveConfig() {
    // Tentar do Supabase primeiro em produção
    if (IS_PRODUCTION && isConfigured) {
      const conn = await this.getActiveConnection();
      if (conn) {
        return conn;
      }
    }

    // Fallback para desenvolvimento
    return {
      baseUrl: this._config.baseUrl,
      email: this._config.email,
      token: this._config.token,
      jql: this._config.jql,
      cacheTtl: (this._config.cacheTtlMinutes || DEFAULT_CACHE_TTL) * 60 * 1000
    };
  }

  setConfig({ baseUrl, email, token, jql, cacheTtlMinutes }) {
    // Validar
    if (baseUrl && !baseUrl.startsWith('https://')) {
      throw new Error('URL deve começar com https://');
    }
    if (email && !email.includes('@')) {
      throw new Error('Email inválido');
    }

    // Salvar no Supabase em produção
    if (IS_PRODUCTION) {
      return this.saveConnection({ baseUrl, email, token, jql, cacheTtlMinutes });
    }

    // Salvar localmente em desenvolvimento
    this._config = {
      ...this._config,
      baseUrl: baseUrl || this._config.baseUrl,
      email: email || this._config.email,
      token: token || this._config.token,
      jql: jql || this._config.jql,
      cacheTtlMinutes: cacheTtlMinutes || this._config.cacheTtlMinutes
    };
    this._saveConfigLocal(this._config);
    return this.getConfig();
  }

  getToken() {
    // Em produção o token vem do Supabase (via getActiveConnection)
    // Nunca exposto em memória estática
    if (IS_PRODUCTION) {
      return this._config.token || null;
    }
    return this._config.token || null;
  }

  getJQL() {
    return this._config.jql || DEFAULT_JQL;
  }

  getCacheTtl() {
    return (this._config.cacheTtlMinutes || DEFAULT_CACHE_TTL) * 60 * 1000;
  }

  async updateSyncStatus(status, error = null) {
    const now = new Date().toISOString();
    this._config.lastSync = now;
    this._config.lastSyncStatus = status;
    this._config.lastSyncError = error;
    
    if (IS_PRODUCTION && isConfigured && supabase) {
      try {
        const conn = await this.getActiveConnection();
        if (conn && conn.id) {
          await supabase
            .from('jira_connections')
            .update({ 
              last_sync_at: now,
              last_sync_status: status,
              last_sync_error: error
            })
            .eq('id', conn.id);
        }
      } catch (err) {
        console.error('[ConfigService] Erro ao persistir status de sync:', err.message);
      }
    } else if (!IS_PRODUCTION) {
      this._saveConfigLocal(this._config);
    }
  }

  clearCache() {
    this._config.lastSync = null;
    this._config.lastSyncStatus = null;
    this._config.lastSyncError = null;
    
    if (!IS_PRODUCTION) {
      this._saveConfigLocal(this._config);
    }
  }

  async isConfiguredAsync() {
    // Em produção: verificar se existe conexão ativa no banco
    if (IS_PRODUCTION && isConfigured && supabase) {
      const conn = await this.getActiveConnection();
      return !!conn;
    }
    // Em desenvolvimento: verificar config local
    return !!(this._config.baseUrl && this._config.email && this._config.token);
  }

  isConfigured() {
    // Versão síncrona para compatibilidade — usa config em memória
    if (IS_PRODUCTION) {
      // Em produção não temos como saber sem consultar o banco
      // Assumimos configurado se Supabase está disponível (verificação real ocorre no handler)
      return isConfigured;
    }
    return !!(this._config.baseUrl && this._config.email && this._config.token);
  }
}

export const configService = new ConfigService();