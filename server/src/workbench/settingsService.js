/**
 * Application settings, stored in MongoDB (one document).
 *
 * Public settings go to the browser. Credentials are write-only: the browser
 * can set or clear them, but only sees `tokenSet: true` etc. They are
 * encrypted at rest and only decrypted when the server sends an API request.
 */
import { sanitizeSettings, withDefaults, SECRET_FIELDS } from '@workbench/shared/settings';
import { decryptSecret, encryptSecret } from './secrets.js';

export class SettingsService {
  constructor(repo) {
    this.repo = repo;
  }

  #withFlags(data, secrets) {
    const s = withDefaults(data);
    s.auth.tokenSet = !!secrets.token;
    s.auth.passwordSet = !!secrets.password;
    s.auth.apiKeyValueSet = !!secrets.apiKeyValue;
    return s;
  }

  /** Settings safe to send to the browser. */
  async getPublic() {
    const { data, secrets } = await this.repo.load();
    return this.#withFlags(data, secrets);
  }

  /**
   * Update settings. `secretUpdates` = { token?, password?, apiKeyValue? }:
   * a string sets the value, null or "" clears it, a missing key keeps it.
   */
  async update(input, secretUpdates = {}) {
    const { data, secrets } = await this.repo.load();
    const current = this.#withFlags(data, secrets);
    const next = sanitizeSettings(input, current);
    const nextSecrets = { ...secrets };
    for (const field of SECRET_FIELDS) {
      if (!(field in (secretUpdates ?? {}))) continue;
      const v = secretUpdates[field];
      nextSecrets[field] = typeof v === 'string' && v !== '' ? encryptSecret(v.slice(0, 8192)) : null;
    }
    const { tokenSet: _a, passwordSet: _b, apiKeyValueSet: _c, ...authData } = next.auth;
    await this.repo.save({ data: { ...next, auth: authData }, secrets: nextSecrets });
    return this.getPublic();
  }

  /** Settings plus decrypted credentials, for building an outgoing request on the server only. */
  async getForRequest() {
    const { data, secrets } = await this.repo.load();
    const settings = this.#withFlags(data, secrets);
    const auth = {
      ...settings.auth,
      token: decryptSecret(secrets.token),
      password: decryptSecret(secrets.password),
      apiKeyValue: decryptSecret(secrets.apiKeyValue),
    };
    return { settings, auth };
  }
}
