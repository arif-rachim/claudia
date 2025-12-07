// Electron API type declarations for the renderer process

export interface ElectronAPI {
  config: {
    get: () => Promise<any>;
    set: (config: any) => Promise<void>;
  };
  file: {
    select: () => Promise<string[]>;
    read: (path: string) => Promise<Buffer>;
    save: (path: string, data: any) => Promise<void>;
  };
  conversation: {
    save: (conversation: any) => Promise<any>;
    load: (id: string, projectId: string | null) => Promise<any>;
    list: (projectId?: string | null) => Promise<any>;
    delete: (id: string, projectId: string | null) => Promise<any>;
  };
  project: {
    create: (project: any) => Promise<any>;
    update: (id: string, updates: any) => Promise<any>;
    delete: (id: string) => Promise<any>;
    get: (id: string) => Promise<any>;
    list: () => Promise<any>;
  };
  platform: string;
  onMenuEvent: (channel: string, callback: () => void) => (() => void) | undefined;
  mcp: {
    startServer: (serverId: string) => Promise<any>;
    stopServer: (serverId: string) => Promise<any>;
    restartServer: (serverId: string) => Promise<any>;
    getServerStatus: (serverId: string) => Promise<any>;
    getLogs: (serverId: string) => Promise<any>;
    clearLogs: (serverId: string) => Promise<any>;
    listConfigs: () => Promise<any>;
    getConfig: (serverId: string) => Promise<any>;
    saveConfig: (config: any) => Promise<any>;
    deleteConfig: (serverId: string) => Promise<any>;
    listTools: (serverId: string) => Promise<any>;
    callTool: (serverId: string, toolName: string, args: any) => Promise<any>;
    importClaudeDesktop: () => Promise<any>;
    onServerStatusChanged: (callback: (event: any) => void) => () => void;
    onServerToolsUpdated: (callback: (event: any) => void) => () => void;
    onServerError: (callback: (event: any) => void) => () => void;
  };
  plugins: {
    discover: () => Promise<any>;
    load: (pluginId: string) => Promise<any>;
    unload: (pluginId: string) => Promise<any>;
    reload: (pluginId: string) => Promise<any>;
    enable: (pluginId: string) => Promise<any>;
    disable: (pluginId: string) => Promise<any>;
    list: () => Promise<any>;
    getConfig: (pluginId: string) => Promise<any>;
    updateConfig: (pluginId: string, updates: any) => Promise<any>;
    getSettings: (pluginId: string) => Promise<any>;
    setSettings: (pluginId: string, settings: any) => Promise<any>;
    getStatus: (pluginId: string) => Promise<any>;
    getActiveExtensions: () => Promise<any>;
    getActiveReplacement: () => Promise<any>;
    getLocalPluginsDir: () => Promise<any>;
    onStatusChanged: (callback: (event: any) => void) => () => void;
    onError: (callback: (event: any) => void) => () => void;
    onDiscovered: (callback: (event: any) => void) => () => void;
    onChanged: (callback: (event: any) => void) => () => void;
  };
}

declare global {
  interface Window {
    electron: ElectronAPI;
  }
}
