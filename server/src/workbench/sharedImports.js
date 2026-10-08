/** One place for the server's imports from the shared package. */
export { AppError, MESSAGES, HTTP_METHODS, applyAuth, buildApiModel, effectiveBase, joinUrl, parseDefinitionText } from '@workbench/shared/openapi';
import { activeEnvironment } from '@workbench/shared/settings';

/** { baseUrl, basePath } of the active environment. */
export function activeEnvironmentBase(settings) {
  const env = activeEnvironment(settings);
  return { baseUrl: env?.baseUrl ?? '', basePath: env?.basePath ?? '' };
}
