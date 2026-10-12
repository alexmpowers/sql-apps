import { ApiError, SqlAppsClient } from '../client.js';
import { parseBrowserConfig } from '../browser-config.js';
import { parseCurrentUser } from '../access.js';
import { prepareAuthentication, SessionExpiredError, type BrowserAuthentication } from './session.js';
import { renderAuthentication, authenticationErrorMessage, type AuthState } from './auth-view.js';
import { watchJobProgress } from './job-progress.js';

const element = <T extends HTMLElement>(id: string) => {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing element: ${id}`);
  return value as T;
};
const status = element('status');
const authElements = {
  login: element<HTMLButtonElement>('login'), logout: element<HTMLButtonElement>('logout'),
  retry: element<HTMLButtonElement>('auth-retry'), status: element('auth-status'), workspace: element('workspace'),
};
let authentication: BrowserAuthentication | undefined;
let authMode: 'local' | 'entra' = 'entra';
let authState: AuthState = { kind: 'signed-out' };
const canUseApp = () => authState.kind === 'authorized';
function showAuth(state: AuthState) {
  authState = state;
  renderAuthentication(authElements, authMode, state);
}
function clearWorkspace() {
  for (const id of ['files', 'jobs', 'traces']) element(id).replaceChildren();
  element('function-result').textContent = '';
  element<HTMLFormElement>('file-form').reset();
}
function report(error: unknown): boolean {
  if (error instanceof SessionExpiredError || (error instanceof ApiError && error.status === 401)) {
    authentication?.forgetExpiredSession();
    clearWorkspace();
    showAuth({ kind: 'expired' });
  } else if (authState.kind === 'expired') {
    return false;
  } else if (!canUseApp()) {
    showAuth({ kind: 'unavailable', ...('name' in authState && authState.name ? { name: authState.name } : {}) });
  }
  status.textContent = authenticationErrorMessage(error, authMode);
  return true;
}
authElements.retry.onclick = () => location.reload();

async function main() {
  const response = await fetch('/auth/config', { redirect: 'error', signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new ApiError(response.status);
  const config = parseBrowserConfig(await response.json());
  authMode = config.mode;
  const notice = config.mode === 'local'
    ? 'Local preview only. Accounts and roles are simulated; do not expose this app remotely.'
    : config.localBackend ? 'Microsoft sign-in is real. Local DAB claims and backend services remain development simulations.' : '';
  element('auth-notice').textContent = notice;
  element('auth-notice').hidden = !notice;
  const auth = await prepareAuthentication(config);
  authentication = auth;
  authElements.login.onclick = () => {
    showAuth({ kind: 'signing-in' });
    void auth.signIn().catch(error => {
      showAuth({ kind: 'signed-out' });
      status.textContent = authenticationErrorMessage(error, authMode);
    });
  };
  authElements.logout.onclick = () => {
    const previous = authState;
    showAuth({ kind: 'signing-out' });
    void auth.signOut().catch(error => {
      if (authState.kind !== 'expired') showAuth(previous);
      report(error);
    });
  };
  const session = auth.session;
  if (!session) { showAuth({ kind: 'signed-out' }); return; }
  showAuth({ kind: 'checking', name: session.name });
  const client = new SqlAppsClient({ baseUrl: location.origin, getAccessToken: session.getAccessToken });
  const current = parseCurrentUser(await (await client.request('/auth/me')).json());
  if (!current.access.allowed) { showAuth({ kind: 'forbidden', name: session.name }); return; }
  showAuth({ kind: 'authorized', name: session.name });
  const signedIn = config.mode === 'local' ? 'Local preview is open.' : `Signed in as ${session.name}`;
  status.textContent = signedIn;
  element('file-form').hidden = !config.capabilities.files;
  element('echo').hidden = !config.capabilities.functions;
  element('service-notice').hidden = config.capabilities.files && config.capabilities.functions;
  element('file-workspace').hidden = !config.capabilities.files;
  element('job-workspace').hidden = !config.capabilities.processing;
  element('trace-workspace').hidden = !config.capabilities.tracing;
  element('job-progress').textContent = config.capabilities.automaticProgress ? 'Job progress updates automatically.' : 'Use Refresh jobs to update progress.';

  let busy = false;
  let fileContinuationToken: string | undefined;
  let displayedFiles = 0;
  async function operation(message: string, action: () => Promise<void>) {
    if (busy || !canUseApp()) return;
    busy = true;
    const controls = document.querySelectorAll<HTMLButtonElement | HTMLInputElement>('#workspace button, #workspace input');
    controls.forEach(control => { control.disabled = true; });
    authElements.logout.disabled = true;
    status.textContent = message;
    try { await action(); if (canUseApp()) status.textContent = signedIn; }
    catch (error) { report(error); }
    finally {
      busy = false;
      document.querySelectorAll<HTMLButtonElement | HTMLInputElement>('#workspace button, #workspace input')
        .forEach(control => { control.disabled = false; });
      authElements.logout.disabled = false;
    }
  }
  async function refreshFiles(append = false) {
    if (!canUseApp() || !config.capabilities.files) return;
    const page = await client.listFiles(append ? fileContinuationToken : undefined);
    if (!canUseApp()) return;
    if (!append) {
      displayedFiles = 0;
      element('files').replaceChildren();
    }
    displayedFiles += page.files.length;
    element('no-files').hidden = displayedFiles !== 0;
    for (const file of page.files) {
      const item = document.createElement('li');
      item.append(`${file.name} (${file.size} bytes) `);
      const download = document.createElement('button');
      download.textContent = 'Download';
      download.onclick = () => { void operation('Downloading file...', async () => {
        const bytes = await client.download(file.name);
        if (!canUseApp()) return;
        const url = URL.createObjectURL(new Blob([bytes]));
        const anchor = document.createElement('a');
        anchor.href = url; anchor.download = file.name;
        document.body.append(anchor); anchor.click(); anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
      }); };
      const remove = document.createElement('button');
      remove.textContent = 'Delete file';
      remove.onclick = () => { void operation('Deleting file...', async () => { await client.deleteFile(file.name); await refreshFiles(); }); };
      item.append(download, remove);
      if (config.capabilities.processing && config.capabilities.jobSubmission !== false) {
        const process = document.createElement('button');
        process.textContent = 'Process file';
        process.onclick = () => { void operation('Submitting processing job...', async () => {
          await client.processFile(file.name); await refreshJobs();
        }); };
        item.append(process);
      }
      item.querySelectorAll('button').forEach(button => { button.disabled = busy; });
      element('files').append(item);
    }
    fileContinuationToken = page.continuationToken;
    element('load-more-files').hidden = fileContinuationToken === undefined;
  }
  let lastJobs = '';
  let jobRefresh = 0;
  async function refreshJobs(signal?: AbortSignal) {
    if (!canUseApp() || !config.capabilities.processing) return;
    const generation = ++jobRefresh;
    const jobs = await client.listJobs(signal);
    if (signal?.aborted || generation !== jobRefresh || !canUseApp()) return;
    const serialized = JSON.stringify(jobs);
    if (serialized === lastJobs) return;
    lastJobs = serialized;
    element('no-jobs').hidden = jobs.length !== 0;
    element('jobs').replaceChildren();
    for (const job of jobs) {
      const item = document.createElement('li');
      item.textContent = `${job.filename}: ${job.status}`;
      item.append(` | Job ${job.id}`);
      if (job.created_at) item.append(` | Created ${job.created_at} UTC`);
      if (job.parent_job_id) item.append(` | Retry of ${job.parent_job_id}`);
      if (job.status === 'completed') item.append(` | ${job.byte_count} bytes | ${job.line_count} text lines | SHA-256 ${job.sha256}`);
      if (job.error) item.append(` | ${job.error}`);
      if (job.status === 'completed' || job.status === 'failed') {
        if (job.status === 'failed' && config.capabilities.jobRetry) {
          const retry = document.createElement('button');
          retry.textContent = 'Retry snapshot';
          retry.onclick = () => { void operation('Retrying saved snapshot...', async () => {
            await client.retryJob(job.id); await refreshJobs();
          }); };
          item.append(retry);
        }
        const remove = document.createElement('button');
        remove.textContent = 'Delete job';
        remove.onclick = () => { void operation('Deleting job...', async () => { await client.deleteJob(job.id); await refreshJobs(); }); };
        item.append(remove);
      }
      item.querySelectorAll('button').forEach(button => { button.disabled = busy; });
      element('jobs').append(item);
    }
  }
  async function refreshTraces() {
    if (!canUseApp() || !config.capabilities.tracing) return;
    const traces = await client.listTraces();
    if (!canUseApp()) return;
    element('traces').replaceChildren();
    for (const trace of traces) {
      const item = document.createElement('li');
      item.textContent = `${trace.name} | ${trace.status} | ${trace.durationMs.toFixed(1)} ms | ${trace.startedAt} | Trace ${trace.traceId} | Span ${trace.spanId}`;
      if (trace.parentSpanId) item.append(` | Parent ${trace.parentSpanId}`);
      if (trace.jobId) item.append(` | Job ${trace.jobId}`);
      element('traces').append(item);
    }
    if (!traces.length) element('traces').textContent = 'No traces yet. Upload or process a file to record activity.';
  }
  element('refresh-traces').onclick = () => { void operation('Loading traces...', refreshTraces); };
  element('refresh-files').onclick = () => { void operation('Loading files...', refreshFiles); };
  element('load-more-files').onclick = () => {
    void operation('Loading more files...', () => refreshFiles(true));
  };
  element('refresh-jobs').onclick = () => { void operation('Loading jobs...', refreshJobs); };
  element<HTMLFormElement>('file-form').onsubmit = event => {
    event.preventDefault();
    const file = element<HTMLInputElement>('file').files?.[0];
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) { report(new Error('Files must be at most 4 MiB')); return; }
    void operation('Uploading file...', async () => {
      await client.upload(file.name, file); element<HTMLFormElement>('file-form').reset(); await refreshFiles();
    });
  };
  element('echo').onclick = () => {
    void operation('Invoking Azure Function...', async () => {
      const result = await client.echo({ message: 'Hello Azure' });
      if (!canUseApp()) return;
      element('function-result').textContent = JSON.stringify(result);
    });
  };
  await operation('Loading workspace...', async () => { await refreshFiles(); await refreshJobs(); });
  if (canUseApp() && config.capabilities.processing && config.capabilities.automaticProgress) {
    const stop = watchJobProgress({
      intervalMs: config.capabilities.progressIntervalMs ?? 2000,
      available: () => canUseApp() && !busy && document.visibilityState === 'visible',
      refresh: refreshJobs,
      report: error => {
        if (error) {
          if (!report(error)) return;
          element('job-progress').textContent = error instanceof SessionExpiredError || (error instanceof ApiError && error.status === 401)
            ? authenticationErrorMessage(error, authMode)
            : error instanceof ApiError && error.status === 403 ? 'Reading job progress is not permitted.'
              : 'Automatic progress is unavailable; retrying with backoff. Check local services.';
        } else if (canUseApp()) {
          element('job-progress').textContent = 'Job progress updates automatically.';
        }
      },
    });
    window.addEventListener('pagehide', stop, { once: true });
  }
}
void main().catch(report);
