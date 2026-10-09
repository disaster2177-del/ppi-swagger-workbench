/**
 * Workbench state: Project → YAML file → endpoint → form.
 * Lives at the shell level so switching view modes keeps the selection and
 * any half-filled forms. Projects and YAML files come from this browser's
 * workspace (localStorage); the last selection is restored after a reload,
 * and changes made in another tab of the same browser show up here too.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MESSAGES, buildApiModel, parseDefinitionText } from '@workbench/shared/openapi';
import { toUserError, describeDetails } from '../../services/errors.js';
import { readPref, writePref } from '../../state/prefs.js';

const HISTORY_LIMIT = 40;

export default function useWorkbench({ source, settings, settingsReady, toast }) {
  const [projects, setProjects] = useState([]);
  const [projectsStatus, setProjectsStatus] = useState('idle'); // idle | loading | ready | error
  const [projectId, setProjectId] = useState('');
  const [yamlFiles, setYamlFiles] = useState([]);
  const [yamlStatus, setYamlStatus] = useState('idle');
  const [yamlFileId, setYamlFileId] = useState('');
  const [detail, setDetail] = useState(null); // { file, endpoints, model } | { error }
  const [detailStatus, setDetailStatus] = useState('idle');
  const [endpointKey, setEndpointKey] = useState('');
  const [uploading, setUploading] = useState(null); // { count } while uploading
  const [uploadReport, setUploadReport] = useState(null);
  const [lastUpload, setLastUpload] = useState(null);
  const [history, setHistory] = useState([]);
  const forms = useRef(new Map());
  const token = useRef({ yaml: 0, detail: 0 });
  const appliedDefault = useRef(false);
  const pendingRestore = useRef(null);
  const current = useRef({});

  // ------------------------------------------------------------ projects
  const loadProjects = useCallback(async () => {
    if (!source) return [];
    setProjectsStatus((s) => (s === 'ready' ? s : 'loading'));
    try {
      const list = await source.projects.list();
      setProjects(list);
      setProjectsStatus('ready');
      return list;
    } catch (err) {
      setProjectsStatus('error');
      const e = toUserError(err);
      toast.error('Could not load projects.', { message: e.message, details: e.details });
      return [];
    }
  }, [source, toast]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  // On load: reopen the last selection in this browser, else the default project chosen in Settings.
  useEffect(() => {
    if (appliedDefault.current || projectsStatus !== 'ready') return;
    appliedDefault.current = true;
    const last = readPref('selection', null);
    const fallback = readPref('defaultProjectId', '');
    if (last?.projectId && projects.some((p) => p.id === last.projectId)) {
      pendingRestore.current = last;
      setProjectId(last.projectId);
    } else if (fallback && projects.some((p) => p.id === fallback)) {
      setProjectId(fallback);
    }
  }, [projectsStatus, projects]);

  // ------------------------------------------------------------ YAML files of the selected project
  const loadYamlFiles = useCallback(
    async (pid = projectId) => {
      const t = (token.current.yaml += 1);
      if (!pid) {
        setYamlFiles([]);
        setYamlStatus('idle');
        return [];
      }
      setYamlStatus('loading');
      try {
        const list = await source.yamlFiles.list(pid);
        if (t !== token.current.yaml) return list;
        setYamlFiles(list);
        setYamlStatus('ready');
        return list;
      } catch (err) {
        if (t !== token.current.yaml) return [];
        setYamlStatus('error');
        const e = toUserError(err);
        toast.error('Could not load YAML files.', { message: e.message, details: e.details });
        return [];
      }
    },
    [source, projectId, toast],
  );

  // Changing project refreshes the list and clears everything below it.
  useEffect(() => {
    setYamlFileId('');
    setDetail(null);
    setEndpointKey('');
    if (!source) return;
    loadYamlFiles(projectId).then((list) => {
      const r = pendingRestore.current;
      if (r && r.projectId === projectId) {
        pendingRestore.current = null;
        if (r.yamlFileId && list.some((f) => f.id === r.yamlFileId)) {
          setYamlFileId(r.yamlFileId);
          loadDetail(r.yamlFileId);
          if (r.endpointKey) setEndpointKey(r.endpointKey);
        }
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, source]);

  // ------------------------------------------------------------ one YAML file: content → parse → endpoints
  const loadDetail = useCallback(
    async (id) => {
      const t = (token.current.detail += 1);
      if (!id) {
        setDetail(null);
        setDetailStatus('idle');
        return;
      }
      setDetailStatus('loading');
      try {
        const file = await source.yamlFiles.get(id);
        let model;
        try {
          model = buildApiModel(parseDefinitionText(file.content));
        } catch (err) {
          if (t !== token.current.detail) return;
          setDetail({ file, endpoints: file.endpoints ?? [], error: toUserError(err, 'INVALID_YAML') });
          setDetailStatus('error');
          return;
        }
        if (t !== token.current.detail) return;
        setDetail({ file, endpoints: file.endpoints ?? [], model });
        setDetailStatus('ready');
      } catch (err) {
        if (t !== token.current.detail) return;
        const e = toUserError(err);
        setDetail({ error: e });
        setDetailStatus('error');
        toast.error('Could not open the YAML file.', { message: e.message });
      }
    },
    [source, toast],
  );

  const selectYaml = useCallback(
    (id) => {
      setYamlFileId(id);
      setEndpointKey('');
      loadDetail(id);
    },
    [loadDetail],
  );

  // ------------------------------------------------------------ actions
  const createProject = useCallback(
    async (data) => {
      const p = await source.projects.create(data);
      await loadProjects();
      setProjectId(p.id);
      toast.success('Project created.', { message: p.name });
      return p;
    },
    [source, loadProjects, toast],
  );

  const updateProject = useCallback(
    async (id, data) => {
      const p = await source.projects.update(id, data);
      await loadProjects();
      toast.success('Project updated.', { message: p.name });
      return p;
    },
    [source, loadProjects, toast],
  );

  const deleteProject = useCallback(
    async (id) => {
      const name = projects.find((p) => p.id === id)?.name;
      await source.projects.remove(id);
      if (id === projectId) setProjectId('');
      await loadProjects();
      toast.success('Project deleted.', { message: name ? `${name} and its YAML files were removed.` : undefined });
    },
    [source, projects, projectId, loadProjects, toast],
  );

  const uploadFiles = useCallback(
    async (fileList) => {
      const files = [...(fileList ?? [])];
      if (!projectId) {
        toast.error(MESSAGES.NO_PROJECT);
        return null;
      }
      if (!files.length) return null;
      setUploading({ count: files.length });
      try {
        const out = await source.yamlFiles.upload(projectId, files, settings);
        const projectName = projects.find((p) => p.id === projectId)?.name ?? 'the project';
        if (out.failed === 0) {
          toast.success(MESSAGES.UPLOAD_OK, {
            message: out.succeeded === 1 ? `${out.results[0].fileName} was added to ${projectName}.` : `${out.succeeded} files were added to ${projectName}.`,
          });
        } else if (out.succeeded === 0) {
          const first = out.results[0]?.error;
          toast.error(files.length === 1 ? first?.message ?? MESSAGES.UPLOAD_FAILED : MESSAGES.UPLOAD_FAILED, {
            message: files.length === 1 ? describeDetails(first?.details) : `None of the ${files.length} files could be stored. See the upload report.`,
          });
        } else {
          toast.warning(`${out.succeeded} of ${files.length} YAML files uploaded.`, { message: `${out.failed} could not be stored. See the upload report.` });
        }
        setLastUpload({ succeeded: out.succeeded, failed: out.failed, at: new Date().toISOString() });
        if (out.failed > 0 || files.length > 1) setUploadReport({ ...out, projectName, at: new Date().toISOString() });
        const list = await loadYamlFiles(projectId);
        loadProjects();
        const firstOk = out.results.find((r) => r.status !== 'failed');
        if (firstOk && (!yamlFileId || out.succeeded === 1)) selectYaml(firstOk.id);
        else if (yamlFileId && out.results.some((r) => r.id === yamlFileId)) loadDetail(yamlFileId);
        return { ...out, list };
      } catch (err) {
        const e = toUserError(err, 'UPLOAD_FAILED');
        toast.error(e.code === 'NO_PROJECT' ? MESSAGES.NO_PROJECT : MESSAGES.UPLOAD_FAILED, { message: e.code === 'NO_PROJECT' ? undefined : e.message, details: e.details });
        return null;
      } finally {
        setUploading(null);
      }
    },
    [projectId, projects, source, settings, toast, loadYamlFiles, loadProjects, yamlFileId, selectYaml, loadDetail],
  );

  const deleteYaml = useCallback(
    async (id) => {
      const name = yamlFiles.find((f) => f.id === id)?.fileName;
      await source.yamlFiles.remove(id);
      if (id === yamlFileId) {
        setYamlFileId('');
        setDetail(null);
        setEndpointKey('');
      }
      await loadYamlFiles(projectId);
      loadProjects();
      toast.success('YAML file deleted.', { message: name });
    },
    [source, yamlFiles, yamlFileId, projectId, loadYamlFiles, loadProjects, toast],
  );

  // Remember the selection in this browser so a reload reopens it.
  useEffect(() => {
    current.current = { projectId, yamlFileId, endpointKey };
    if (appliedDefault.current && !pendingRestore.current) writePref('selection', { projectId, yamlFileId, endpointKey });
  }, [projectId, yamlFileId, endpointKey]);

  // Another tab of this browser changed the workspace: refresh what is shown.
  useEffect(() => {
    if (!source?.storage) return undefined;
    return source.storage.subscribe(async () => {
      const list = await loadProjects();
      const { projectId: pid, yamlFileId: yid } = current.current;
      if (pid && !list.some((p) => p.id === pid)) {
        setProjectId('');
        return;
      }
      const files = await loadYamlFiles(pid);
      if (yid && !files.some((f) => f.id === yid)) {
        setYamlFileId('');
        setDetail(null);
        setEndpointKey('');
      } else if (yid) {
        loadDetail(yid);
      }
    });
  }, [source, loadProjects, loadYamlFiles, loadDetail]);

  /** Add the example projects (Payment Service, User Service) to this browser's workspace. */
  const loadSamples = useCallback(async () => {
    try {
      const samples = await source.samples();
      let stored = 0;
      let firstProject = null;
      for (const sample of samples) {
        const existing = (await source.projects.list()).find((p) => p.name.toLowerCase() === sample.name.toLowerCase());
        const project = existing ?? (await source.projects.create({ name: sample.name, description: sample.description }));
        firstProject ??= project;
        const out = await source.yamlFiles.upload(project.id, sample.files, {
          ...settings,
          validation: { ...settings.validation, mode: 'standard', duplicatePolicy: 'replace' },
        });
        stored += out.succeeded;
      }
      await loadProjects();
      if (firstProject) {
        if (firstProject.id === projectId) loadYamlFiles(projectId);
        else setProjectId(firstProject.id);
      }
      toast.success('Example projects added.', { message: `${stored} YAML files saved in this browser.` });
    } catch (err) {
      const e = toUserError(err);
      toast.error('Could not add the example projects.', { message: e.message });
    }
  }, [source, settings, projectId, loadProjects, loadYamlFiles, toast]);

  /** Download this browser's workspace as a JSON file. */
  const exportWorkspace = useCallback(() => {
    const data = source?.storage?.export();
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ppi-swagger-workspace-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast.success('Workspace exported.', { message: 'Import the file on another PC or browser to copy these projects there.' });
  }, [source, toast]);

  /** Replace this browser's workspace with an exported file. */
  const importWorkspace = useCallback(
    async (file) => {
      try {
        let payload;
        try {
          payload = JSON.parse(await file.text());
        } catch {
          throw Object.assign(new Error('This file is not a workspace export from this app.'), { name: 'ApiError', code: 'IMPORT_INVALID' });
        }
        await source.storage.import(payload);
        setProjectId('');
        await loadProjects();
        toast.success('Workspace imported.', { message: 'The projects and YAML files from the file are now in this browser.' });
      } catch (err) {
        const e = toUserError(err);
        toast.error('Could not import the workspace.', { message: e.message });
      }
    },
    [source, loadProjects, toast],
  );

  const clearWorkspace = useCallback(async () => {
    source?.storage?.clear();
    setProjectId('');
    await loadProjects();
    toast.success("This browser's workspace was cleared.");
  }, [source, loadProjects, toast]);

  const recordExecution = useCallback((entry) => {
    setHistory((h) => [{ ...entry, id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}` }, ...h].slice(0, HISTORY_LIMIT));
  }, []);

  const operation = useMemo(() => detail?.model?.operations.find((o) => o.id === endpointKey) ?? null, [detail, endpointKey]);
  const project = useMemo(() => projects.find((p) => p.id === projectId) ?? null, [projects, projectId]);

  return {
    source,
    projects,
    projectsStatus,
    project,
    projectId,
    selectProject: setProjectId,
    createProject,
    updateProject,
    deleteProject,
    reloadProjects: loadProjects,

    yamlFiles,
    yamlStatus,
    yamlFileId,
    selectYaml,
    deleteYaml,
    reloadYamlFiles: () => loadYamlFiles(projectId),
    uploadFiles,
    uploading,
    uploadReport,
    closeUploadReport: () => setUploadReport(null),
    uploadReportLast: lastUpload,

    detail,
    detailStatus,
    endpointKey,
    selectEndpoint: setEndpointKey,
    operation,

    forms: forms.current,
    history,
    recordExecution,
    clearHistory: () => setHistory([]),

    loadSamples,
    exportWorkspace,
    importWorkspace,
    clearWorkspace,
  };
}
