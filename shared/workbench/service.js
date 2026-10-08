/**
 * Project → YAML file → endpoint management.
 *
 * The rules live here once; storage is pluggable. A store implements:
 *
 *   projects:  list() get(id) findByName(name) create(data) update(id, patch) remove(id)
 *   yamlFiles: listByProject(projectId) get(id) findByName(projectId, fileName)
 *              create(data) update(id, patch) remove(id) removeByProject(projectId) countByProject()
 *   endpoints: listByYamlFile(yamlFileId) replaceForYamlFile(yamlFileId, projectId, endpoints)
 *              removeByYamlFile(yamlFileId) removeByProject(projectId)
 *
 * Implementations: server/src/workbench/mongoStore.js (MongoDB),
 * client/src/services/artifactStore.js (hosted demo) and MemoryStore below (tests).
 */
import { AppError, MESSAGES } from '../openapi/errors.js';
import { processYamlFile, safeFileName, fileExtension } from './ingest.js';

const nowIso = () => new Date().toISOString();

export function slugify(name) {
  return (
    String(name)
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/[\s_]+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 60) || 'project'
  );
}

function cleanProjectInput({ name, description } = {}) {
  const n = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : '';
  if (!n) throw new AppError('PROJECT_NAME_REQUIRED');
  if (n.length > 80) throw new AppError('PROJECT_NAME_REQUIRED', 'Use a project name of 80 characters or fewer.');
  return { name: n, description: typeof description === 'string' ? description.trim().slice(0, 500) : '' };
}

/** Summary of a YAML file without its content (for lists). */
export function yamlSummary(f) {
  const { content: _content, ...rest } = f;
  return rest;
}

export class WorkbenchService {
  constructor(store) {
    this.store = store;
  }

  // ---------------------------------------------------------------- projects

  async listProjects() {
    const [projects, counts] = await Promise.all([this.store.projects.list(), this.store.yamlFiles.countByProject()]);
    return projects
      .map((p) => ({ ...p, yamlCount: counts[p.id]?.files ?? 0, endpointCount: counts[p.id]?.endpoints ?? 0 }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }

  async getProject(id) {
    const p = await this.store.projects.get(id);
    if (!p) throw new AppError('NOT_FOUND', 'That project no longer exists.', { status: 404 });
    return p;
  }

  async createProject(input) {
    const data = cleanProjectInput(input);
    if (await this.store.projects.findByName(data.name)) throw new AppError('PROJECT_EXISTS', undefined, { status: 409 });
    const t = nowIso();
    return this.store.projects.create({ ...data, slug: slugify(data.name), createdAt: t, updatedAt: t });
  }

  async updateProject(id, input) {
    const current = await this.getProject(id);
    const data = cleanProjectInput({ name: input.name ?? current.name, description: input.description ?? current.description });
    const clash = await this.store.projects.findByName(data.name);
    if (clash && clash.id !== id) throw new AppError('PROJECT_EXISTS', undefined, { status: 409 });
    return this.store.projects.update(id, { ...data, slug: slugify(data.name), updatedAt: nowIso() });
  }

  /** Deletes the project with all of its YAML files and endpoints. */
  async deleteProject(id) {
    await this.getProject(id);
    await this.store.endpoints.removeByProject(id);
    await this.store.yamlFiles.removeByProject(id);
    await this.store.projects.remove(id);
    return { id };
  }

  // ---------------------------------------------------------------- YAML files

  async listYamlFiles(projectId, { search = '' } = {}) {
    await this.getProject(projectId);
    const q = search.trim().toLowerCase();
    const files = (await this.store.yamlFiles.listByProject(projectId)).map(yamlSummary);
    return files
      .filter((f) => !q || [f.fileName, f.title].some((v) => String(v ?? '').toLowerCase().includes(q)))
      .sort((a, b) => a.fileName.localeCompare(b.fileName, undefined, { numeric: true, sensitivity: 'base' }));
  }

  /** One YAML file with its content and endpoints. */
  async getYamlFile(id) {
    const file = await this.store.yamlFiles.get(id);
    if (!file) throw new AppError('NOT_FOUND', 'That YAML file no longer exists.', { status: 404 });
    const endpoints = await this.store.endpoints.listByYamlFile(id);
    return { ...file, endpoints };
  }

  async deleteYamlFile(id) {
    const file = await this.store.yamlFiles.get(id);
    if (!file) throw new AppError('NOT_FOUND', 'That YAML file no longer exists.', { status: 404 });
    await this.store.endpoints.removeByYamlFile(id);
    await this.store.yamlFiles.remove(id);
    await this.store.projects.update(file.projectId, { updatedAt: nowIso() });
    return { id, projectId: file.projectId };
  }

  /**
   * Validate and store several YAML files for one project. Files are handled
   * one by one, so a bad file never blocks the good ones. Invalid files are
   * not stored. Returns one result per file, in the order given.
   */
  async uploadYamlFiles(projectId, files, settings) {
    if (!projectId) throw new AppError('NO_PROJECT');
    const project = await this.getProject(projectId);
    if (!Array.isArray(files) || !files.length) throw new AppError('NO_FILES');
    const validation = settings.validation;

    const results = [];
    for (const file of files) {
      const original = safeFileName(file.fileName);
      try {
        if (file.readError) throw new AppError('READ_FAILED');
        const checked = processYamlFile(file, validation);
        results.push(await this.#store(project, checked, file.text, validation.duplicatePolicy));
      } catch (err) {
        results.push({
          fileName: original,
          status: 'failed',
          error: err instanceof AppError ? err.toJSON() : { code: 'UPLOAD_FAILED', message: MESSAGES.UPLOAD_FAILED },
        });
      }
    }
    if (results.some((r) => r.status !== 'failed')) await this.store.projects.update(projectId, { updatedAt: nowIso() });
    return {
      projectId,
      results,
      succeeded: results.filter((r) => r.status !== 'failed').length,
      failed: results.filter((r) => r.status === 'failed').length,
    };
  }

  async #store(project, checked, content, policy) {
    const t = nowIso();
    let fileName = checked.fileName;
    const existing = await this.store.yamlFiles.findByName(project.id, fileName);

    const record = {
      projectId: project.id,
      fileName,
      filePath: `projects/${project.slug ?? slugify(project.name)}/${fileName}`,
      content,
      sizeBytes: checked.sizeBytes,
      format: checked.format,
      specVersion: checked.specVersion,
      title: checked.title,
      apiVersion: checked.apiVersion,
      endpointCount: checked.endpoints.length,
      warnings: checked.warnings,
      updatedAt: t,
    };

    if (existing && policy === 'reject') throw new AppError('DUPLICATE_FILE', undefined, { status: 409 });

    let saved;
    let status;
    if (existing && policy === 'replace') {
      saved = await this.store.yamlFiles.update(existing.id, record);
      status = 'updated';
    } else {
      if (existing) {
        fileName = await this.#freeName(project.id, fileName);
        record.fileName = fileName;
        record.filePath = `projects/${project.slug ?? slugify(project.name)}/${fileName}`;
      }
      saved = await this.store.yamlFiles.create({ ...record, createdAt: t });
      status = 'created';
    }
    await this.store.endpoints.replaceForYamlFile(saved.id, project.id, checked.endpoints);

    return {
      fileName,
      status,
      id: saved.id,
      endpointCount: checked.endpoints.length,
      warnings: checked.warnings,
      renamedFrom: fileName !== checked.fileName ? checked.fileName : undefined,
    };
  }

  async #freeName(projectId, fileName) {
    const ext = fileExtension(fileName);
    const stem = fileName.slice(0, fileName.length - ext.length);
    for (let i = 2; i < 1000; i += 1) {
      const candidate = `${stem} (${i})${ext}`;
      if (!(await this.store.yamlFiles.findByName(projectId, candidate))) return candidate;
    }
    return `${stem}-${Date.now()}${ext}`;
  }
}

/** In-memory store, used by tests and as a fallback when no database is available. */
export class MemoryStore {
  constructor() {
    const tables = { projects: new Map(), yamlFiles: new Map(), endpoints: new Map() };
    let seq = 0;
    const id = (prefix) => `${prefix}_${Date.now().toString(36)}${(seq += 1).toString(36)}`;
    const clone = (v) => (v ? JSON.parse(JSON.stringify(v)) : v);

    const crud = (table, prefix) => ({
      async get(key) {
        return clone(tables[table].get(key)) ?? null;
      },
      async create(data) {
        const rec = { ...clone(data), id: id(prefix) };
        tables[table].set(rec.id, rec);
        return clone(rec);
      },
      async update(key, patch) {
        const cur = tables[table].get(key);
        if (!cur) return null;
        const next = { ...cur, ...clone(patch), id: key };
        tables[table].set(key, next);
        return clone(next);
      },
      async remove(key) {
        tables[table].delete(key);
      },
    });

    this.projects = {
      ...crud('projects', 'prj'),
      async list() {
        return [...tables.projects.values()].map(clone);
      },
      async findByName(name) {
        const n = name.toLowerCase();
        return clone([...tables.projects.values()].find((p) => p.name.toLowerCase() === n)) ?? null;
      },
    };
    this.yamlFiles = {
      ...crud('yamlFiles', 'yml'),
      async listByProject(projectId) {
        return [...tables.yamlFiles.values()].filter((f) => f.projectId === projectId).map(clone);
      },
      async findByName(projectId, fileName) {
        return clone([...tables.yamlFiles.values()].find((f) => f.projectId === projectId && f.fileName === fileName)) ?? null;
      },
      async removeByProject(projectId) {
        for (const [k, f] of tables.yamlFiles) if (f.projectId === projectId) tables.yamlFiles.delete(k);
      },
      async countByProject() {
        const out = {};
        for (const f of tables.yamlFiles.values()) {
          out[f.projectId] ??= { files: 0, endpoints: 0 };
          out[f.projectId].files += 1;
          out[f.projectId].endpoints += f.endpointCount ?? 0;
        }
        return out;
      },
    };
    this.endpoints = {
      async listByYamlFile(yamlFileId) {
        return [...tables.endpoints.values()].filter((e) => e.yamlFileId === yamlFileId).map(clone);
      },
      async replaceForYamlFile(yamlFileId, projectId, endpoints) {
        for (const [k, e] of tables.endpoints) if (e.yamlFileId === yamlFileId) tables.endpoints.delete(k);
        const t = nowIso();
        for (const e of endpoints) {
          const rec = { ...clone(e), id: id('ep'), yamlFileId, projectId, createdAt: t };
          tables.endpoints.set(rec.id, rec);
        }
      },
      async removeByYamlFile(yamlFileId) {
        for (const [k, e] of tables.endpoints) if (e.yamlFileId === yamlFileId) tables.endpoints.delete(k);
      },
      async removeByProject(projectId) {
        for (const [k, e] of tables.endpoints) if (e.projectId === projectId) tables.endpoints.delete(k);
      },
    };
  }
}
