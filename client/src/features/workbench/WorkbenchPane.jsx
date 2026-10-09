/**
 * The YAML / OpenAPI side of the app, in one of two variants:
 *
 *   variant="swagger" (Swagger Only page): where projects are created and YAML
 *     files uploaded; the selected file is shown in Swagger UI.
 *       Project [select] [manage] [Upload YAML]
 *       ┌ YAML files ┐ ┌ Swagger UI ──────┐
 *
 *   variant="forms" (Side by Side page): browse and run only, no upload or
 *     project creation; the selected API is shown as a generated form.
 *       Project [select]
 *       ┌ YAML files ┐ ┌ API form ────────┐
 *       │ APIs       │ │ response         │
 */
import { lazy, Suspense, useRef, useState } from 'react';
import { Button, EmptyState, Icon, IconButton, Select } from '../../ui/index.jsx';

// Swagger UI is large (~1.5 MB); load it only when the Swagger UI view is used.
const SwaggerView = lazy(() => import('./SwaggerView.jsx'));
import { EndpointList, YamlFileList, ApiOverview } from './Navigator.jsx';
import OperationForm from './OperationForm.jsx';
import { ProjectForm, ProjectsModal, UploadReportModal } from './ProjectDialogs.jsx';

export default function WorkbenchPane({ wb, settings, onOpenSettings, onOpenSwagger, hidden, variant = 'forms' }) {
  // Only the Swagger Only page creates projects and uploads YAML files.
  const swaggerStyle = variant === 'swagger';
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
          {swaggerStyle && <IconButton icon="folder" label="Manage projects" onClick={() => setManageOpen(true)} disabled={!wb.source} />}
        </div>
        {swaggerStyle && (
          <div className="wb-upload">
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
        )}
      </header>

      {!wb.source ? (
        <div className="wb-center">
          <EmptyState icon="refresh" title="Connecting to the database…" />
        </div>
      ) : noProjects && !swaggerStyle ? (
        <div className="wb-center">
          <EmptyState
            icon="folder"
            title="No projects yet"
            action={
              onOpenSwagger && (
                <Button variant="primary" icon="api" onClick={onOpenSwagger}>
                  Go to Swagger Only
                </Button>
              )
            }
          >
            Projects are created and YAML files uploaded on the Swagger Only page.
          </EmptyState>
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
            <YamlFileList wb={wb} onDropFiles={swaggerStyle ? wb.uploadFiles : null} />
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
                  !wb.yamlFiles.length &&
                  (swaggerStyle ? (
                    <Button variant="primary" icon="upload" onClick={() => inputRef.current?.click()}>
                      Upload YAML
                    </Button>
                  ) : (
                    onOpenSwagger && (
                      <Button variant="primary" icon="api" onClick={onOpenSwagger}>
                        Go to Swagger Only
                      </Button>
                    )
                  ))
                }
              >
                {wb.yamlFiles.length
                  ? swaggerStyle
                    ? 'It opens in Swagger UI.'
                    : 'Its APIs are listed once it opens.'
                  : swaggerStyle
                    ? `Add one or more .yaml files to ${wb.project?.name ?? 'this project'}. Each file is checked before it is saved.`
                    : `${wb.project?.name ?? 'This project'} has no YAML files yet. Upload them on the Swagger Only page.`}
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

      {swaggerStyle && <ProjectsModal open={manageOpen} onClose={() => setManageOpen(false)} wb={wb} />}
      <UploadReportModal report={wb.uploadReport} onClose={wb.closeUploadReport} />
    </section>
  );
}
