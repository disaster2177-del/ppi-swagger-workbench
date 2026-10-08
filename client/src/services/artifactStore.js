/**
 * WorkbenchService store backed by the hosted artifact's database
 * (`claude.use("db")`), for the browser-only build.
 *
 * Layout (same relationships as MongoDB, adapted to a document store):
 *   projects/{projectId}            name, slug, description, dates
 *   yamlFiles/{yamlFileId}          projectId, fileName, filePath, metadata, dates (no content)
 *   yamlContents/{yamlFileId}       projectId, content   (kept apart so lists stay small)
 *   endpointSets/{yamlFileId}       projectId, yamlFileId, endpoints: [...]   (one document per file)
 *   settings/app                    public settings (never credentials)
 */
const rand = () => Math.random().toString(36).slice(2, 10);
const newId = (prefix) => `${prefix}_${Date.now().toString(36)}${rand()}`;
const data = (snap) => (snap.exists ? { ...snap.data(), id: snap.id } : null);
const all = (q) => q.get().then((s) => s.docs.map((d) => ({ ...d.data(), id: d.id })));
const strip = ({ id: _id, ...rest }) => JSON.parse(JSON.stringify(rest));

export function createArtifactStore(db) {
  const col = (name) => db.collection(name);

  const crud = (name, prefix) => ({
    async get(id) {
      if (!id || !/^[\w.~:@+-]+$/.test(id)) return null;
      return data(await col(name).doc(id).get());
    },
    async create(rec) {
      const id = newId(prefix);
      await col(name).doc(id).set(strip(rec));
      return { ...rec, id };
    },
    async update(id, patch) {
      const ref = col(name).doc(id);
      await ref.update(strip(patch));
      return data(await ref.get());
    },
    async remove(id) {
      await col(name).doc(id).delete();
    },
  });

  const yamlBase = crud('yamlFiles', 'yml');

  return {
    projects: {
      ...crud('projects', 'prj'),
      list: () => all(col('projects')),
      async findByName(name) {
        const n = name.toLowerCase();
        return (await all(col('projects'))).find((p) => p.name.toLowerCase() === n) ?? null;
      },
    },

    yamlFiles: {
      listByProject: (projectId) => all(col('yamlFiles').where('projectId', '==', projectId)),
      async get(id) {
        const meta = await yamlBase.get(id);
        if (!meta) return null;
        const content = data(await col('yamlContents').doc(id).get());
        return { ...meta, content: content?.content ?? '' };
      },
      async findByName(projectId, fileName) {
        const rows = await all(col('yamlFiles').where('projectId', '==', projectId).where('fileName', '==', fileName).limit(1));
        return rows[0] ?? null;
      },
      async create(rec) {
        const { content, ...meta } = rec;
        const created = await yamlBase.create(meta);
        await col('yamlContents').doc(created.id).set({ projectId: rec.projectId, content });
        return created;
      },
      async update(id, patch) {
        const { content, ...meta } = patch;
        if (content !== undefined) await col('yamlContents').doc(id).set({ projectId: patch.projectId ?? (await yamlBase.get(id))?.projectId, content });
        return yamlBase.update(id, meta);
      },
      async remove(id) {
        await col('yamlContents').doc(id).delete();
        await yamlBase.remove(id);
      },
      async removeByProject(projectId) {
        const files = await all(col('yamlFiles').where('projectId', '==', projectId));
        for (const f of files) {
          await col('yamlContents').doc(f.id).delete();
          await col('yamlFiles').doc(f.id).delete();
        }
      },
      async countByProject() {
        const out = {};
        for (const f of await all(col('yamlFiles'))) {
          out[f.projectId] ??= { files: 0, endpoints: 0 };
          out[f.projectId].files += 1;
          out[f.projectId].endpoints += f.endpointCount ?? 0;
        }
        return out;
      },
    },

    endpoints: {
      async listByYamlFile(yamlFileId) {
        const set = data(await col('endpointSets').doc(yamlFileId).get());
        return (set?.endpoints ?? []).map((e, i) => ({ ...e, id: `${yamlFileId}:${i}`, yamlFileId, projectId: set.projectId }));
      },
      async replaceForYamlFile(yamlFileId, projectId, endpoints) {
        await col('endpointSets').doc(yamlFileId).set({ projectId, yamlFileId, endpoints: strip({ id: 0, endpoints }).endpoints, createdAt: new Date().toISOString() });
      },
      async removeByYamlFile(yamlFileId) {
        await col('endpointSets').doc(yamlFileId).delete();
      },
      async removeByProject(projectId) {
        for (const s of await all(col('endpointSets').where('projectId', '==', projectId))) await col('endpointSets').doc(s.id).delete();
      },
    },
  };
}

export function createArtifactSettingsRepo(db) {
  const ref = db.doc('settings/app');
  return {
    async load() {
      const snap = await ref.get();
      return snap.exists ? snap.data() : {};
    },
    async save(settings) {
      await ref.set(JSON.parse(JSON.stringify(settings)));
    },
  };
}
