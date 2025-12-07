import { ipcMain, BrowserWindow } from 'electron';
import { getPluginManager } from '../services/plugin-manager.service';
import { PluginConfig } from '../../src/types/plugin.types';

let mainWindow: BrowserWindow | null = null;

export function setPluginMainWindow(window: BrowserWindow) {
  mainWindow = window;
}

export function registerPluginHandlers() {
  const manager = getPluginManager();

  // ============================================================================
  // Discovery
  // ============================================================================

  ipcMain.handle('plugin:discover', async () => {
    try {
      const plugins = await manager.discoverPlugins();
      return {
        success: true,
        plugins: plugins.map((p) => ({
          id: p.id,
          source: p.source,
          path: p.path,
          manifest: p.manifest,
          isValid: p.isValid,
          validationErrors: p.validationErrors,
        })),
      };
    } catch (error) {
      console.error('[Plugin] Failed to discover plugins:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to discover plugins',
      };
    }
  });

  // ============================================================================
  // Loading / Unloading
  // ============================================================================

  ipcMain.handle('plugin:load', async (_event, pluginId: string) => {
    try {
      const discovered = manager.getDiscoveredPlugins().find((p) => p.id === pluginId);
      if (!discovered) {
        throw new Error(`Plugin ${pluginId} not found`);
      }
      // Loading is handled internally by enable
      return { success: true };
    } catch (error) {
      console.error('[Plugin] Failed to load plugin:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to load plugin',
      };
    }
  });

  ipcMain.handle('plugin:unload', async (_event, pluginId: string) => {
    try {
      await manager.disablePlugin(pluginId);
      return { success: true };
    } catch (error) {
      console.error('[Plugin] Failed to unload plugin:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to unload plugin',
      };
    }
  });

  // ============================================================================
  // Enable / Disable
  // ============================================================================

  ipcMain.handle('plugin:enable', async (_event, pluginId: string) => {
    try {
      await manager.enablePlugin(pluginId);
      return { success: true };
    } catch (error) {
      console.error('[Plugin] Failed to enable plugin:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to enable plugin',
      };
    }
  });

  ipcMain.handle('plugin:disable', async (_event, pluginId: string) => {
    try {
      await manager.disablePlugin(pluginId);
      return { success: true };
    } catch (error) {
      console.error('[Plugin] Failed to disable plugin:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to disable plugin',
      };
    }
  });

  // ============================================================================
  // Reload (for development)
  // ============================================================================

  ipcMain.handle('plugin:reload', async (_event, pluginId: string) => {
    try {
      await manager.reloadPlugin(pluginId);
      return { success: true };
    } catch (error) {
      console.error('[Plugin] Failed to reload plugin:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to reload plugin',
      };
    }
  });

  // ============================================================================
  // Configuration
  // ============================================================================

  ipcMain.handle('plugin:list', async () => {
    try {
      const configs = manager.getPluginConfigs();
      return { success: true, configs };
    } catch (error) {
      console.error('[Plugin] Failed to list plugins:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list plugins',
      };
    }
  });

  ipcMain.handle('plugin:getConfig', async (_event, pluginId: string) => {
    try {
      const config = manager.getPluginConfig(pluginId);
      if (!config) {
        throw new Error(`Plugin ${pluginId} not found`);
      }
      return { success: true, config };
    } catch (error) {
      console.error('[Plugin] Failed to get plugin config:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get plugin config',
      };
    }
  });

  ipcMain.handle(
    'plugin:updateConfig',
    async (_event, pluginId: string, updates: Partial<PluginConfig>) => {
      try {
        manager.updatePluginConfig(pluginId, updates);
        return { success: true };
      } catch (error) {
        console.error('[Plugin] Failed to update plugin config:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to update plugin config',
        };
      }
    }
  );

  // ============================================================================
  // Settings
  // ============================================================================

  ipcMain.handle('plugin:getSettings', async (_event, pluginId: string) => {
    try {
      const settings = manager.getPluginSettings(pluginId);
      return { success: true, settings };
    } catch (error) {
      console.error('[Plugin] Failed to get plugin settings:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get plugin settings',
      };
    }
  });

  ipcMain.handle(
    'plugin:setSettings',
    async (_event, pluginId: string, settings: Record<string, unknown>) => {
      try {
        manager.updatePluginSettings(pluginId, settings);
        return { success: true };
      } catch (error) {
        console.error('[Plugin] Failed to set plugin settings:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to set plugin settings',
        };
      }
    }
  );

  // ============================================================================
  // Status
  // ============================================================================

  ipcMain.handle('plugin:getStatus', async (_event, pluginId: string) => {
    try {
      const status = manager.getPluginStatus(pluginId);
      return { success: true, status };
    } catch (error) {
      console.error('[Plugin] Failed to get plugin status:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get plugin status',
      };
    }
  });

  ipcMain.handle('plugin:getActiveExtensions', async () => {
    try {
      const extensionIds = manager.getActiveExtensionPluginIds();
      return { success: true, extensionIds };
    } catch (error) {
      console.error('[Plugin] Failed to get active extensions:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get active extensions',
      };
    }
  });

  ipcMain.handle('plugin:getActiveReplacement', async () => {
    try {
      const replacementId = manager.getActiveReplacementPluginId();
      return { success: true, replacementId };
    } catch (error) {
      console.error('[Plugin] Failed to get active replacement:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get active replacement',
      };
    }
  });

  // ============================================================================
  // Utility
  // ============================================================================

  ipcMain.handle('plugin:getLocalPluginsDir', async () => {
    try {
      const dir = manager.getLocalPluginsDir();
      return { success: true, dir };
    } catch (error) {
      console.error('[Plugin] Failed to get local plugins dir:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get local plugins dir',
      };
    }
  });

  // ============================================================================
  // Event Forwarding
  // ============================================================================

  // Forward plugin status changes to renderer
  manager.on('pluginStatusChanged', (event: any) => {
    if (mainWindow) {
      mainWindow.webContents.send('plugin:statusChanged', event);
    }
  });

  // Forward plugin errors to renderer
  manager.on('pluginError', (event: any) => {
    if (mainWindow) {
      mainWindow.webContents.send('plugin:error', event);
    }
  });

  // Forward plugin discovery events to renderer
  manager.on('pluginsDiscovered', (event: any) => {
    if (mainWindow) {
      mainWindow.webContents.send('plugin:discovered', event);
    }
  });

  // Forward plugin change events to renderer
  manager.on('pluginChanged', (event: any) => {
    if (mainWindow) {
      mainWindow.webContents.send('plugin:changed', event);
    }
  });

  console.log('[Plugin] Handlers registered');
}

// ============================================================================
// Initialization and Cleanup
// ============================================================================

export async function initializePluginManager(): Promise<void> {
  const manager = getPluginManager();
  await manager.initialize();
}

export async function cleanupPluginManager(): Promise<void> {
  const manager = getPluginManager();
  await manager.shutdown();
}
