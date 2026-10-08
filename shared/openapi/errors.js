/**
 * Error types and user-facing messages.
 *
 * Every failure the UI can show has a stable `code` and a plain-language
 * `message`. Technical detail (parser output, HTTP bodies) goes in `details`
 * so the UI can offer it behind a "Technical details" toggle instead of
 * showing it by default.
 */

export const MESSAGES = {
  // YAML upload / validation
  NO_PROJECT: 'Please select a project before uploading YAML files.',
  NO_FILES: 'Choose one or more YAML files to upload.',
  UNSUPPORTED_TYPE: 'Unsupported file type. Upload a .yaml or .yml file.',
  FILE_TOO_LARGE: 'The file is too large.',
  EMPTY_FILE: 'The file is empty.',
  READ_FAILED: 'The file could not be read.',
  INVALID_YAML: 'Invalid YAML format. Unable to parse the uploaded file.',
  NOT_AN_OBJECT: 'The file does not contain a YAML object. Expected an OpenAPI or Swagger definition.',
  INVALID_OPENAPI: 'Invalid OpenAPI/Swagger definition.',
  DUPLICATE_FILE: 'A YAML file with this name already exists in the project.',
  UPLOAD_FAILED: 'Failed to upload YAML file.',
  UPLOAD_OK: 'YAML uploaded successfully.',

  // Forms and requests
  REQUIRED_FIELDS: 'Please enter all required fields.',
  REQUEST_FAILED: 'API request failed.',
  REQUEST_OK: 'API request completed.',
  NO_BASE_URL: 'Set a Base URL in Settings, or add a server to the YAML file.',
  TIMEOUT: 'The request took too long and was stopped. You can raise the timeout in Settings.',
  NETWORK: "We couldn't reach the service. Check the Base URL and that the server is running.",
  CANCELLED: 'Request was cancelled.',
  HOSTED_NO_NETWORK:
    "This hosted copy can't send requests to outside services. Run the app locally (npm run dev) to execute APIs.",

  // Projects and settings
  PROJECT_NAME_REQUIRED: 'Enter a project name.',
  PROJECT_EXISTS: 'A project with this name already exists.',
  NOT_FOUND: "We couldn't find that. It may have been deleted.",
  SETTINGS_INVALID: 'Some settings are not valid. Check the highlighted fields.',
  GENERIC: 'Something went wrong. Please try again.',
};

/** An expected, user-facing failure. `status` is the HTTP status the server should answer with. */
export class AppError extends Error {
  constructor(code, message = MESSAGES[code] ?? MESSAGES.GENERIC, { status = 400, details } = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
  }

  toJSON() {
    return { code: this.code, message: this.message, ...(this.details !== undefined ? { details: this.details } : {}) };
  }
}

/** Plain-language summary for an HTTP status returned by a target API. */
export function describeHttpStatus(status) {
  if (status === 400 || status === 422)
    return { title: "Some details don't look right", hint: 'Please check the information you entered and try again.' };
  if (status === 401) return { title: 'Please sign in', hint: 'This needs valid access details. Add them under Settings.' };
  if (status === 403) return { title: "You don't have access", hint: "Your account isn't allowed to do this." };
  if (status === 404) return { title: "We couldn't find that", hint: 'Nothing matches what you entered. Double-check the details and try again.' };
  if (status === 405) return { title: "That isn't allowed", hint: 'This action is not available right now.' };
  if (status === 408) return { title: 'The service took too long', hint: 'Please try again in a moment.' };
  if (status === 409) return { title: 'That conflicts with something', hint: 'It may already exist, or was changed by someone else.' };
  if (status === 413) return { title: 'That is too large', hint: 'Try a smaller file or less content.' };
  if (status === 429) return { title: 'Too many requests', hint: 'Please wait a moment and try again.' };
  if (status >= 500) return { title: 'The service ran into a problem', hint: 'This is not your fault. Please try again in a moment.' };
  if (status >= 400) return { title: 'Something went wrong', hint: 'The request could not be completed.' };
  return null;
}
