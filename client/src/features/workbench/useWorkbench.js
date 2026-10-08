/**
 * Workbench state: Project → YAML file → endpoint → form.
 * Lives at the shell level so switching view modes keeps the selection and
 * any half-filled forms.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MESSAGES, buildApiModel, parseDefinitionText } from '@workbench/shared/openapi';
import { toUserError, describeDetails } from '../../services/errors.js';

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

  // Default project from Settings, once both are loaded.
  useEffect(() => {
    if (appliedDefault.current || !settingsReady || projectsStatus !== 'ready') return;
    appliedDefault.current = true;
    const id = settings.defaults?.projectId;
    if (id && projects.some((p) => p.id === id)) setProjectId(id);
  }, [settingsReady, projectsStatus, projects, settings.defaults?.projectId]);

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
    if (source) loadYamlFiles(projectId);
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
        const out = await source.yamlFiles.upload(projectId, files);
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
    [projectId, projects, source, toast, loadYamlFiles, loadProjects, yamlFileId, selectYaml, loadDetail],
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
  };
}
