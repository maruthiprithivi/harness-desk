import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const defaults = {
  repoRoots: [], repos: [], journalPath: '', scanIntervalMinutes: 0, repoBudgets: {},
  routes: { global: {}, repos: {} }, budgets: { globalTokens: 2000, repoTokens: 8000, contextPercent: 15 }
};
export function safeRelative(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || path.posix.isAbsolute(value) || value.split('/').some(p => p === '..' || p === '.')) throw new Error('Invalid artifact path');
  return value;
}
export class Store {
  constructor(root) { this.root = path.resolve(root); this.manifest = {}; this.pendingWrite = Promise.resolve(); }
  async init() {
    await fs.mkdir(this.root, {recursive: true, mode: 0o700});
    if ((await fs.lstat(this.root)).isSymbolicLink()) throw new Error('Data directory must not be a symlink');
    this.manifest = await this.read('manifest.json', {});
    this.settings = { ...defaults, ...await this.read('settings.json', {}) };
    return this;
  }
  async location(relative) {
    safeRelative(relative);
    const target = path.join(this.root, relative);
    let current = this.root;
    for (const component of relative.split('/')) {
      current = path.join(current, component);
      try { if ((await fs.lstat(current)).isSymbolicLink()) throw new Error('Symlinks are not permitted in generated data'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return target;
  }
  async read(relative, fallback = null) {
    try { return JSON.parse(await fs.readFile(await this.location(relative), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
  }
  write(relative, content, options = {}) {
    if (options.internal) return this.commitWrite(relative, content, options);
    const pending = this.pendingWrite.then(() => this.commitWrite(relative, content, options));
    this.pendingWrite = pending.catch(() => {});
    return pending;
  }
  async commitWrite(relative, content, {kind = 'report', pinned = false, internal = false} = {}) {
    const target = await this.location(relative);
    await fs.mkdir(path.dirname(target), {recursive: true, mode: 0o700});
    const temporary = target + '.' + randomUUID() + '.tmp';
    const previous = this.manifest, next = {...previous, [relative]: {kind, pinned, updatedAt: new Date().toISOString()}};
    let reserved = false, committed = false;
    try {
      await fs.writeFile(temporary, typeof content === 'string' ? content : JSON.stringify(content, null, 2) + '\n', {mode: 0o600});
      // Commit the artifact last so a manifest failure cannot publish a failed save.
      if (!internal) { await this.write('manifest.json', next, {internal: true}); reserved = true; }
      await fs.rename(temporary, target);
      committed = true;
      if (!internal) this.manifest = next;
    } catch (error) {
      if (reserved) {
        try { await this.write('manifest.json', previous, {internal: true}); }
        catch { this.manifest = next; throw new Error('Artifact was not saved, but its manifest reservation could not be restored. Review local storage before retrying.', {cause: error}); }
      }
      throw error;
    } finally { if (!committed) await fs.unlink(temporary).catch(() => {}); }
    return relative;
  }
  async saveSettings(settings) {
    await this.write('settings.json', settings, {internal: true});
    this.settings = settings;
  }
  async conversations() {
    const result = [];
    for (const [file, entry] of Object.entries(this.manifest)) {
      if (entry.kind === 'conversation' && !file.startsWith('_archive/')) {
        const chat = await this.read(file);
        if (chat) result.push(chat);
      }
    }
    return result.sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async saveConversation(chat) {
    await this.write('conversations/' + chat.id + '.json', chat, {kind: 'conversation', pinned: chat.pinned || chat.status === 'running'});
  }
  async storage() {
    let bytes = 0, files = 0, archiveBytes = 0;
    const byKind = {};
    for (const [file, entry] of Object.entries(this.manifest)) {
      try {
        const size = (await fs.stat(await this.location(file))).size;
        files++; bytes += size;
        byKind[entry.kind] = (byKind[entry.kind] || 0) + size;
        if (file.startsWith('_archive/')) archiveBytes += size;
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    for (const file of ['settings.json', 'manifest.json']) {
      try { bytes += (await fs.stat(await this.location(file))).size; files++; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return {bytes, files, byKind, archiveBytes};
  }
  async prune(days, preview = true, now = Date.now()) {
    if (![1,7,30].includes(days)) throw new Error('Choose 24 hours, 7 days or 30 days');
    const cutoff = now - days * 86400000;
    const candidates = [];
    for (const [file, entry] of Object.entries(this.manifest)) {
      if (entry.pinned || file.startsWith('_archive/') || !['.json','.md','.html'].includes(path.extname(file)) || !(Date.parse(entry.updatedAt) < cutoff)) continue;
      try { candidates.push({path:file,bytes:(await fs.stat(await this.location(file))).size}); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    if (!preview) {
      for (const item of candidates) {
        const relative = '_archive/' + randomUUID() + '/' + item.path;
        const destination = await this.location(relative);
        await fs.mkdir(path.dirname(destination), {recursive:true,mode:0o700});
        await fs.rename(await this.location(item.path), destination);
        this.manifest[relative] = {...this.manifest[item.path], originalPath:item.path};
        delete this.manifest[item.path];
      }
      await this.write('manifest.json', this.manifest, {internal:true});
    }
    return {files:candidates,bytes:candidates.reduce((n,f)=>n+f.bytes,0),preview};
  }
}
