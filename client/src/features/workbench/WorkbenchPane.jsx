/**
 * The YAML / OpenAPI side of the app:
 *   Project [select] [Upload YAML]
 *   ┌ YAML files ┐ ┌ API form ────────┐
 *   │ APIs       │ │ response         │
 * Flow: select project → its YAML files → select a file (parsed) → its APIs →
 * select an API → form generated from the definition → Execute.
 */
import { lazy, Suspense, useRef, useState } from 'react';
import { Button, EmptyState, Icon, IconButton, Select, Tabs } from '../../ui/index.jsx';

// Swagger UI is large (~1.5 MB); load it only when the Swagger UI view is used.
const SwaggerView = lazy(() => import('./SwaggerView.jsx'));
import { EndpointList, YamlFileList, ApiOverview } from './Navigator.jsx';
import OperationForm from './OperationForm.jsx';
import { ProjectForm, ProjectsModal, UploadReportModal } from './ProjectDialogs.jsx';

export default function WorkbenchPane({ wb, settings, onOpenSettings, hidden, viewStyle = 'forms', onViewStyle }) {
  const swaggerStyle = viewStyle === 'swagger';
  const inputRef = useRef(null);
  const [manageOpen, setManageOpen] = useState(false);
  const accept = [...settings.validation.allowedExtensions, 'application/yaml', 'text/yaml', 'application/x-yaml'].join(',');
  const noProjects = wb.projectsStatus === 'ready' && wb.projects.length === 0;

  return (
    <section className="wb" aria-label="YAML and API workbench" hidden={hidden}>
      <header className="wb-head">
        <div className="wb-project">
          <label className="eyebrow" htmlFor="wb-project-select">
            Project
          </label>
          <Select
            id="wb-project-select"
            size="sm"
            value={wb.projectId}
            disabled={!wb.source || wb.projectsStatus === 'loading'}
            onChange={(e) => wb.selectProject(e.target.value)}
          >
            <option value="">{wb.projectsStatus === 'loading' ? 'Loading projects…' : 'Select project'}</option>
            {wb.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.yamlCount})
              </option>
            ))}
          </Select>
          <IconButton icon="folder" label="Manage projects" onClick={() => setManageOpen(true)} disabled={!wb.source} />
        </div>
        <div className="wb-upload">
          {onViewStyle && (
            <Tabs
              label="How to show the API"
              value={viewStyle}
              onChange={onViewStyle}
              items={[
                { id: 'swagger', label: 'Swagger UI', icon: 'api' },
                { id: 'forms', label: 'Forms', icon: 'list' },
              ]}
            />
          )}
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={accept}
            hidden
            onChange={(e) => {
              const files = e.target.files;
              wb.uploadFiles(files).finally(() => {
                e.target.value = '';
              });
            }}
          />
          <Button
            variant="primary"
            size="sm"
            icon="upload"
            disabled={!wb.projectId || !!wb.uploading}
            loading={!!wb.uploading}
            title={wb.projectId ? 'Choose one or more YAML files' : 'Select a project first'}
            onClick={() => inputRef.current?.click()}
          >
            {wb.uploading ? `Uploading ${wb.uploading.count} file${wb.uploading.count === 1 ? '' : 's'}…` : 'Upload YAML'}
          </Button>
        </div>
      </header>

      {!wb.source ? (
        <div className="wb-center">
          <EmptyState icon="refresh" title="Connecting to the database…" />
        </div>
      ) : noProjects ? (
        <div className="wb-center">
          <div className="first-run card">
            <Icon name="folder" size={28} strokeWidth={1.2} />
            <h2>Create your first project</h2>
            <p className="muted">
              YAML files always belong to a project. Create one, then upload its YAML files. Everything is saved in this browser only.
            </p>
            <ProjectForm submitLabel="Create project" onSubmit={(d) => wb.createProject(d)} />
            <div className="first-run-alt">
              <span className="muted">or</span>
              <Button size="sm" variant="ghost" icon="folder" onClick={wb.loadSamples}>
                Load example projects
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className={`wb-body${swaggerStyle ? ' swagger-style' : ''}`}>
          <nav className="wb-nav" aria-label={swaggerStyle ? 'YAML files' : 'YAML files and APIs'}>
            <YamlFileList wb={wb} onDropFiles={wb.uploadFiles} />
            {!swaggerStyle && <EndpointList wb={wb} />}
          </nav>
          <div className="wb-main">
            {!wb.projectId ? (
              <EmptyState icon="folder" title="Select a project">
                Choose a project above to see its YAML files and APIs.
              </EmptyState>
            ) : !wb.yamlFileId ? (
              <EmptyState
                icon="file"
                title={wb.yamlFiles.length ? 'Select a YAML file' : 'Upload YAML files'}
                action={
                  !wb.yamlFiles.length && (
                    <Button variant="primary" icon="upload" onClick={() => inputRef.current?.click()}>
                      Upload YAML
                    </Button>
                  )
                }
              >
                {wb.yamlFiles.length
                  ? 'Its APIs are listed once it opens.'
                  : `Add one or more .yaml files to ${wb.project?.name ?? 'this project'}. Each file is checked before it is saved.`}
              </EmptyState>
            ) : wb.detailStatus === 'loading' && !wb.detail?.model ? (
              <EmptyState icon="refresh" title="Opening YAML file…" />
            ) : wb.detail?.error ? (
              <EmptyState icon="error" title="This YAML file can't be shown">
                {wb.detail.error.message}
              </EmptyState>
            ) : wb.detail?.model && swaggerStyle ? (
              <Suspense fallback={<EmptyState icon="refresh" title="Loading Swagger UI…" />}>
                <SwaggerView wb={wb} settings={settings} />
              </Suspense>
            ) : wb.detail?.model && wb.operation ? (
              <OperationForm key={`${wb.yamlFileId}::${wb.operation.id}`} wb={wb} settings={settings} onOpenSettings={onOpenSettings} />
            ) : wb.detail?.model ? (
              <ApiOverview wb={wb} />
            ) : null}
          </div>
        </div>
      )}

      <ProjectsModal open={manageOpen} onClose={() => setManageOpen(false)} wb={wb} />
      <UploadReportModal report={wb.uploadReport} onClose={wb.closeUploadReport} />
    </section>
  );
}
