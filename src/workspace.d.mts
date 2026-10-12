export type PortState = 'free' | 'occupied' | 'unknown';
export interface WorkspaceDescriptor {
  version: 1;
  home: string;
  id: string;
  mode: 'isolated' | 'legacy';
  basePort: number | null;
}
export interface WorkspaceRuntime {
  home: string;
  id: string;
  mode: 'isolated' | 'legacy' | 'legacy-unselected';
  defaultSql: string;
  sqlContainer: string;
  database: string;
  login: string;
  ownsSqlName: boolean;
  stateDirectory: string;
  ports: { gateway: number; data: number; functions: number; blob: number; queue: number; sql: number | null };
  origins: { app: string; data: string; functions: string };
  names: { storage: string; functions: string; data: string; network: string; sqlNetwork: string;
    state: string; sqlState: string; dataConfig: string };
  settingsPath: string;
  imageRepository: string;
  labels: string[];
}
export function workspaceFile(root?: string): string;
export function readWorkspace(root?: string): WorkspaceDescriptor | null;
export function describeWorkspace(root: string, selection: number | 'legacy'): WorkspaceDescriptor;
export function runtimeFor(container?: string, root?: string, proposed?: WorkspaceDescriptor): WorkspaceRuntime;
export function functionsImage(runtime?: WorkspaceRuntime): string;
export function portState(port: number): Promise<PortState>;
export function proposeWorkspace(root?: string, probe?: (port: number) => Promise<PortState>): Promise<{
  selected?: WorkspaceDescriptor;
  descriptor?: WorkspaceDescriptor;
  conflicts?: { name: string; port: number; state: PortState }[];
  alternative?: WorkspaceDescriptor | null;
  nextAction?: string;
  scope: string;
}>;
export function initializeWorkspace(root: string | undefined, selection: number | 'legacy',
  probe?: (port: number) => Promise<PortState>): Promise<WorkspaceRuntime>;
