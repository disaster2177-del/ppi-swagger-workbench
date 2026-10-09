/**
 * Project management (create, rename, delete) and the bulk upload report.
 */
import { useId, useState } from 'react';
import { MESSAGES } from '@workbench/shared/openapi';
import { Badge, Button, ConfirmDialog, Field, Icon, IconButton, Modal, TextInput, Textarea, formatDateTime, useToast } from '../../ui/index.jsx';
import { describeDetails, toUserError } from '../../services/errors.js';

export function ProjectForm({ initial, onSubmit, submitLabel, onCancel }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const uid = useId().replace(/:/g, '');
  const nameId = `pf-name-${initial?.id ?? 'new'}-${uid}`;
  const descId = `pf-desc-${initial?.id ?? 'new'}-${uid}`;
  return (
    <form
      className="project-form"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim()) {
          setError(MESSAGES.PROJECT_NAME_REQUIRED);
          return;
        }
        setBusy(true);
        try {
          await onSubmit({ name, description });
          setError(null);
          if (!initial) {
            setName('');
            setDescription('');
          }
        } catch (err) {
          setError(toUserError(err).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field id={nameId} label="Project name" required error={error}>
        <TextInput id={nameId} value={name} maxLength={80} placeholder="e.g. Payment Service" onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field id={descId} label="Description" optional>
        <Textarea id={descId} rows={2} value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <div className="row-end">
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" variant="primary" loading={busy} icon={initial ? 'check' : 'plus'}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

export function ProjectsModal({ open, onClose, wb }) {
  const toast = useToast();
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);

  return (
    <Modal open={open} onClose={onClose} title="Projects" wide>
      <section className="modal-section">
        <h3 className="eyebrow">New project</h3>
        <ProjectForm submitLabel="Create project" onSubmit={(d) => wb.createProject(d)} />
      </section>
      <section className="modal-section">
        <h3 className="eyebrow">All projects ({wb.projects.length})</h3>
        {!wb.projects.length ? (
          <p className="muted">No projects yet.</p>
        ) : (
          <ul className="project-list">
            {wb.projects.map((p) => (
              <li key={p.id} className={p.id === wb.projectId ? 'current' : ''}>
                {editing === p.id ? (
                  <ProjectForm
                    initial={p}
                    submitLabel="Save"
                    onCancel={() => setEditing(null)}
                    onSubmit={async (d) => {
                      await wb.updateProject(p.id, d);
                      setEditing(null);
                    }}
                  />
                ) : (
                  <div className="project-row">
                    <Icon name="folder" />
                    <div className="project-main">
                      <div className="project-name">
                        {p.name} {p.id === wb.projectId && <Badge tone="accent">Selected</Badge>}
                      </div>
                      {p.description && <div className="muted">{p.description}</div>}
                      <div className="file-meta tabular">
                        {p.yamlCount} YAML files · {p.endpointCount} APIs · created {formatDateTime(p.createdAt)}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => {
                        wb.selectProject(p.id);
                        onClose();
                      }}
                      disabled={p.id === wb.projectId}
                    >
                      Open
                    </Button>
                    <IconButton icon="edit" size="sm" label={`Rename ${p.name}`} onClick={() => setEditing(p.id)} />
                    <IconButton icon="trash" size="sm" label={`Delete ${p.name}`} onClick={() => setDeleting(p)} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <ConfirmDialog
        open={!!deleting}
        title="Delete project?"
        danger
        busy={busy}
        confirmLabel="Delete project"
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          setBusy(true);
          try {
            await wb.deleteProject(deleting.id);
          } catch (err) {
            toast.error('Could not delete the project.', { message: toUserError(err).message });
          } finally {
            setBusy(false);
            setDeleting(null);
          }
        }}
      >
        <strong>{deleting?.name}</strong>, its {deleting?.yamlCount} YAML files and {deleting?.endpointCount} APIs will be deleted. This can&apos;t be undone.
      </ConfirmDialog>
    </Modal>
  );
}

export function UploadReportModal({ report, onClose }) {
  if (!report) return null;
  return (
    <Modal
      open
      onClose={onClose}
      title="Upload report"
      wide
      footer={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <p className="report-summary">
        Project <strong>{report.projectName}</strong>: <span className="text-good">{report.succeeded} stored</span>
        {report.failed > 0 && (
          <>
            , <span className="text-bad">{report.failed} rejected</span>
          </>
        )}
        . Rejected files were not saved.
      </p>
      <ul className="report-list">
        {report.results.map((r, i) => (
          <li key={i} className={r.status === 'failed' ? 'failed' : 'ok'}>
            <Icon name={r.status === 'failed' ? 'error' : 'success'} />
            <div className="report-main">
              <div className="report-name">
                {r.fileName}
                {r.status === 'updated' && <Badge tone="info">Replaced existing</Badge>}
                {r.status === 'created' && <Badge tone="good">New</Badge>}
                {r.renamedFrom && <Badge>Renamed from {r.renamedFrom}</Badge>}
              </div>
              {r.status === 'failed' ? (
                <>
                  <div className="text-bad">{r.error.message}</div>
                  {r.error.details && <pre className="code-block report-details">{describeDetails(r.error.details)}</pre>}
                </>
              ) : (
                <div className="muted">
                  {r.endpointCount} APIs found
                  {r.warnings?.length ? ` · ${r.warnings.length} validation note${r.warnings.length === 1 ? '' : 's'}` : ''}
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
