import { broadcastResponseToMainFrame } from '@azure/msal-browser/redirect-bridge';

void broadcastResponseToMainFrame().catch((error: unknown) => {
  console.error('Microsoft sign-in callback failed.', { errorType: error instanceof Error ? error.name : 'UnknownError' });
  const status = document.getElementById('redirect-status');
  if (status) status.textContent = 'Sign-in could not be completed. Return to the application and try again.';
});
