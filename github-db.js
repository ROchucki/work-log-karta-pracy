/**
 * GitHub Database Integration
 * Przechowuje dane w repozytorium GitHub jako worklog-data.json
 * Używa GitHub REST API z Personal Access Token
 */

const GITHUB_DB = {
  // Konfiguracja
  owner: 'ROchucki',
  repo: 'work-log-karta-pracy',
  branch: 'main',
  filePath: 'worklog-data.json',
  tokenKey: 'github_token',
  lastSyncKey: 'github_last_sync',
  localCacheKey: 'github_cache_data',

  // Klucze Settings w localStorage
  async getToken() {
    return await this.localGet(this.tokenKey);
  },

  async setToken(token) {
    return await this.localSet(this.tokenKey, token);
  },

  async clearToken() {
    return await this.localDel(this.tokenKey);
  },

  // Helper do localStorage (async - kompatybilne z indexedDB API)
  localGet(key) {
    return Promise.resolve(localStorage.getItem(key));
  },

  localSet(key, val) {
    return Promise.resolve(localStorage.setItem(key, val));
  },

  localDel(key) {
    return Promise.resolve(localStorage.removeItem(key));
  },

  // Pobranie repozytorium na GitHub
  async getGitHubFile() {
    const token = await this.getToken();
    if (!token) throw new Error('GitHub token nie ustawiony');

    const url = `https://api.github.com/repos/${this.owner}/${this.repo}/contents/${this.filePath}`;
    const resp = await fetch(url, {
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    if (resp.status === 404) {
      // Plik nie istnieje - zwróć pusty inicjalny stan
      return { sha: null, data: { entries: [], lastModified: new Date().toISOString() } };
    }

    if (!resp.ok) {
      throw new Error(`GitHub API error: ${resp.status} ${resp.statusText}`);
    }

    const json = await resp.json();
    const content = atob(json.content); // dekoduj base64
    return {
      sha: json.sha,
      data: JSON.parse(content)
    };
  },

  // Zapis do GitHub
  async saveToGitHub(data, message = 'Update worklog data') {
    const token = await this.getToken();
    if (!token) throw new Error('GitHub token nie ustawiony');

    // Pobierz bieżący SHA aby nie nadpisać
    let currentSha = null;
    try {
      const existing = await this.getGitHubFile();
      currentSha = existing.sha;
    } catch (e) {
      // Plik nie istnieje - to ok, SHA będzie null
    }

    const url = `https://api.github.com/repos/${this.owner}/${this.repo}/contents/${this.filePath}`;
    const encoded = btoa(JSON.stringify(data, null, 2));

    const payload = {
      message,
      content: encoded,
      branch: this.branch
    };

    if (currentSha) {
      payload.sha = currentSha; // Wymagane do aktualizacji
    }

    const resp = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!resp.ok) {
      const err = await resp.json();
      throw new Error(`GitHub save error: ${err.message}`);
    }

    return await resp.json();
  },

  // Synchronizacja danych z GitHub
  async sync() {
    try {
      const { data } = await this.getGitHubFile();
      await this.localSet(this.localCacheKey, JSON.stringify(data));
      await this.localSet(this.lastSyncKey, new Date().toISOString());
      return data;
    } catch (e) {
      toast(`Błąd synchronizacji: ${e.message}`);
      throw e;
    }
  },

  // Pobierz Cache (może być nieświeże)
  async getCache() {
    const cached = await this.localGet(this.localCacheKey);
    return cached ? JSON.parse(cached) : { entries: [], lastModified: new Date().toISOString() };
  },

  // Wszystkie wpisy
  async getAllEntries() {
    try {
      const data = await this.sync();
      return data.entries || [];
    } catch (e) {
      // Fallback do cache
      const data = await this.getCache();
      return data.entries || [];
    }
  },

  // Dodaj wpis
  async addEntry(entry) {
    const token = await this.getToken();
    if (!token) throw new Error('Musisz najpierw ustawić GitHub token');

    const data = await this.getCache();
    if (!data.entries) data.entries = [];

    // Dodaj nowy wpis z ID
    entry.id = Date.now().toString();
    entry.created = new Date().toISOString();
    entry.updated = entry.created;

    data.entries.push(entry);
    data.lastModified = new Date().toISOString();

    await this.saveToGitHub(data, `Add entry: ${entry.data}`);
    return entry;
  },

  // Aktualizuj wpis
  async updateEntry(entryId, updates) {
    const token = await this.getToken();
    if (!token) throw new Error('Musisz najpierw ustawić GitHub token');

    const data = await this.getCache();
    const idx = data.entries?.findIndex(e => e.id === entryId);

    if (idx === -1 || idx === undefined) {
      throw new Error('Wpis nie znaleziony');
    }

    data.entries[idx] = { ...data.entries[idx], ...updates, updated: new Date().toISOString() };
    data.lastModified = new Date().toISOString();

    await this.saveToGitHub(data, `Update entry: ${entryId}`);
    return data.entries[idx];
  },

  // Usuń wpis
  async deleteEntry(entryId) {
    const token = await this.getToken();
    if (!token) throw new Error('Musisz najpierw ustawić GitHub token');

    const data = await this.getCache();
    data.entries = (data.entries || []).filter(e => e.id !== entryId);
    data.lastModified = new Date().toISOString();

    await this.saveToGitHub(data, `Delete entry: ${entryId}`);
  },

  // Wipe all
  async wipeAll() {
    const token = await this.getToken();
    if (!token) throw new Error('Musisz najpierw ustawić GitHub token');

    const data = { entries: [], lastModified: new Date().toISOString() };
    await this.saveToGitHub(data, 'Wipe all entries');
  }
};
