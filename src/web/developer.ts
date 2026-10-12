import { parseCurrentUser } from '../access.js';
import { parseBrowserConfig } from '../browser-config.js';
import { createPreviewSession, localSessionKey } from './session.js';

function pageElements() {
  const form = document.getElementById('identity-form');
  const users = document.getElementById('development-user');
  const select = document.getElementById('select-user');
  const status = document.getElementById('development-status');
  if (!(form instanceof HTMLFormElement) || !(users instanceof HTMLSelectElement) ||
      !(select instanceof HTMLButtonElement) || !(status instanceof HTMLElement)) {
    throw new Error('Development identity page is incomplete');
  }
  return { form, users, select, status };
}

const { form, users, select, status } = pageElements();

function report(error: unknown) {
  status.textContent = error instanceof Error ? error.message : 'Development identity operation failed';
}

async function main() {
  const configuration = await fetch('/auth/config', { signal: AbortSignal.timeout(10_000), redirect: 'error' });
  if (!configuration.ok) throw new Error(`Authentication configuration unavailable (${configuration.status})`);
  const config = parseBrowserConfig(await configuration.json());
  if (config.mode !== 'local') throw new Error('Development identities are unavailable with real sign-in');
  const response = await fetch('/local/users', { signal: AbortSignal.timeout(10_000), redirect: 'error' });
  if (!response.ok) throw new Error(`Development identities unavailable (${response.status})`);
  const body: unknown = await response.json();
  if (!body || typeof body !== 'object' || !('users' in body) || !Array.isArray(body.users) || !body.users.length) {
    throw new Error('Development identity configuration is invalid');
  }
  const options = body.users.map((user: unknown) => {
    if (!user || typeof user !== 'object' || !('id' in user) || typeof user.id !== 'string' || !user.id.trim() ||
        !('name' in user) || typeof user.name !== 'string' || !user.name.trim()) {
      throw new Error('Development identity configuration is invalid');
    }
    const option = document.createElement('option');
    option.value = user.id;
    option.textContent = user.name;
    return option;
  });
  users.replaceChildren(...options);
  const token = sessionStorage.getItem(localSessionKey);
  if (token) {
    const identity = await fetch('/auth/me', { headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000), redirect: 'error' });
    if (identity.status === 401) {
      sessionStorage.removeItem(localSessionKey);
      status.textContent = 'The previous preview session expired.';
    } else {
      if (!identity.ok) throw new Error(`Preview identity lookup failed (${identity.status})`);
      const current = parseCurrentUser(await identity.json());
      if (!options.some(option => option.value === current.oid)) throw new Error('Unrecognized preview identity');
      users.value = current.oid;
      status.textContent = current.access.allowed ? 'Current test identity has application access.'
        : 'Current test identity does not have the required application role.';
    }
  }
  select.disabled = false;
  form.onsubmit = event => {
    event.preventDefault();
    select.disabled = true;
    void createPreviewSession(users.value).then(() => location.assign('/')).catch(report)
      .finally(() => { select.disabled = false; });
  };
}

void main().catch(report);
