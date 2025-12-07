import * as path from 'path';
import * as fs from 'fs';
import { EventEmitter } from 'events';
import {
  PluginManifest,
  PluginContext,
  PluginStorage,
  PluginLogger,
  PluginEventBus,
  PluginStoreAccess,
  LoadedPlugin,
  PluginStatus,
  MarkdownExtensionPlugin,
  RendererReplacementPlugin,
  DiscoveredPlugin,
} from '../../src/types/plugin.types';
import { store } from './store.service';

// ============================================================================
// Plugin Loader Service
// ============================================================================

export class PluginLoaderService extends EventEmitter {
  private loadedPlugins: Map<string, LoadedPlugin> = new Map();
  private pluginStorage: Map<string, Record<string, unknown>> = new Map();
  private globalEventBus: EventEmitter = new EventEmitter();

  constructor() {
    super();
  }

  /**
   * Load a plugin from a discovered plugin.
   */
  async loadPlugin(discovered: DiscoveredPlugin): Promise<LoadedPlugin> {
    const { id, path: pluginPath, manifest } = discovered;

    console.log(`[PluginLoader] Loading plugin: ${manifest.name} (${id})`);

    // Check if already loaded
    if (this.loadedPlugins.has(id)) {
      console.log(`[PluginLoader] Plugin ${id} already loaded`);
      return this.loadedPlugins.get(id)!;
    }

    try {
      // Resolve the entry point
      const entryPoint = path.resolve(pluginPath, manifest.main);

      if (!fs.existsSync(entryPoint)) {
        throw new Error(`Entry point not found: ${entryPoint}`);
      }

      // Clear require cache for hot reload support
      this.clearRequireCache(entryPoint);

      // Dynamically require the plugin module
      const pluginModule = require(entryPoint);
      const pluginInstance = pluginModule.default || pluginModule;

      // Validate the plugin instance
      this.validatePluginInstance(pluginInstance, manifest);

      // Create plugin context
      const context = this.createPluginContext(id, manifest);

      // Create loaded plugin record
      const loadedPlugin: LoadedPlugin = {
        id,
        manifest,
        instance: pluginInstance,
        context,
        status: 'loaded',
      };

      // Call init lifecycle hook if present
      if (typeof pluginInstance.init === 'function') {
        await Promise.resolve(pluginInstance.init(context));
      }

      // Store the loaded plugin
      this.loadedPlugins.set(id, loadedPlugin);

      console.log(`[PluginLoader] Successfully loaded plugin: ${manifest.name}`);
      this.emit('pluginLoaded', { pluginId: id, manifest });

      return loadedPlugin;
    } catch (error) {
      console.error(`[PluginLoader] Failed to load plugin ${id}:`, error);

      const failedPlugin: LoadedPlugin = {
        id,
        manifest,
        instance: {} as any,
        context: this.createPluginContext(id, manifest),
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
      };

      this.loadedPlugins.set(id, failedPlugin);
      this.emit('pluginError', { pluginId: id, error: failedPlugin.error });

      throw error;
    }
  }

  /**
   * Unload a plugin.
   */
  async unloadPlugin(pluginId: string): Promise<void> {
    const plugin = this.loadedPlugins.get(pluginId);

    if (!plugin) {
      console.log(`[PluginLoader] Plugin ${pluginId} not loaded`);
      return;
    }

    console.log(`[PluginLoader] Unloading plugin: ${plugin.manifest.name}`);

    try {
      // Call dispose lifecycle hook if present
      if (typeof plugin.instance.dispose === 'function') {
        await Promise.resolve(plugin.instance.dispose(plugin.context));
      }

      // Clear require cache
      const entryPoint = path.resolve(
        this.getPluginPath(pluginId) || '',
        plugin.manifest.main
      );
      this.clearRequireCache(entryPoint);

      // Remove from loaded plugins
      this.loadedPlugins.delete(pluginId);

      console.log(`[PluginLoader] Successfully unloaded plugin: ${plugin.manifest.name}`);
      this.emit('pluginUnloaded', { pluginId });
    } catch (error) {
      console.error(`[PluginLoader] Failed to unload plugin ${pluginId}:`, error);
      throw error;
    }
  }

  /**
   * Reload a plugin (for development).
   */
  async reloadPlugin(discovered: DiscoveredPlugin): Promise<LoadedPlugin> {
    const { id } = discovered;

    // Unload if loaded
    if (this.loadedPlugins.has(id)) {
      await this.unloadPlugin(id);
    }

    // Load fresh
    return this.loadPlugin(discovered);
  }

  /**
   * Activate a loaded plugin.
   */
  async activatePlugin(pluginId: string): Promise<void> {
    const plugin = this.loadedPlugins.get(pluginId);

    if (!plugin) {
      throw new Error(`Plugin ${pluginId} not loaded`);
    }

    if (plugin.status === 'active') {
      console.log(`[PluginLoader] Plugin ${pluginId} already active`);
      return;
    }

    console.log(`[PluginLoader] Activating plugin: ${plugin.manifest.name}`);

    try {
      // Call activate lifecycle hook if present
      if (typeof plugin.instance.activate === 'function') {
        await Promise.resolve(plugin.instance.activate(plugin.context));
      }

      plugin.status = 'active';
      this.emit('pluginActivated', { pluginId });

      console.log(`[PluginLoader] Successfully activated plugin: ${plugin.manifest.name}`);
    } catch (error) {
      console.error(`[PluginLoader] Failed to activate plugin ${pluginId}:`, error);
      plugin.status = 'error';
      plugin.error = error instanceof Error ? error.message : 'Activation failed';
      throw error;
    }
  }

  /**
   * Deactivate a loaded plugin.
   */
  async deactivatePlugin(pluginId: string): Promise<void> {
    const plugin = this.loadedPlugins.get(pluginId);

    if (!plugin) {
      throw new Error(`Plugin ${pluginId} not loaded`);
    }

    if (plugin.status !== 'active') {
      console.log(`[PluginLoader] Plugin ${pluginId} not active`);
      return;
    }

    console.log(`[PluginLoader] Deactivating plugin: ${plugin.manifest.name}`);

    try {
      // Call deactivate lifecycle hook if present
      if (typeof plugin.instance.deactivate === 'function') {
        await Promise.resolve(plugin.instance.deactivate(plugin.context));
      }

      plugin.status = 'inactive';
      this.emit('pluginDeactivated', { pluginId });

      console.log(`[PluginLoader] Successfully deactivated plugin: ${plugin.manifest.name}`);
    } catch (error) {
      console.error(`[PluginLoader] Failed to deactivate plugin ${pluginId}:`, error);
      throw error;
    }
  }

  /**
   * Get a loaded plugin by ID.
   */
  getPlugin(pluginId: string): LoadedPlugin | undefined {
    return this.loadedPlugins.get(pluginId);
  }

  /**
   * Get all loaded plugins.
   */
  getAllPlugins(): LoadedPlugin[] {
    return Array.from(this.loadedPlugins.values());
  }

  /**
   * Get all active extension plugins (sorted by priority).
   */
  getActiveExtensionPlugins(): MarkdownExtensionPlugin[] {
    return Array.from(this.loadedPlugins.values())
      .filter(
        (p) =>
          p.status === 'active' &&
          p.manifest.type === 'renderer-extension'
      )
      .sort((a, b) => {
        const priorityA = a.manifest.renderer?.priority ?? 100;
        const priorityB = b.manifest.renderer?.priority ?? 100;
        return priorityA - priorityB;
      })
      .map((p) => p.instance as MarkdownExtensionPlugin);
  }

  /**
   * Get the active replacement plugin (only one allowed).
   */
  getActiveReplacementPlugin(): RendererReplacementPlugin | undefined {
    const replacement = Array.from(this.loadedPlugins.values()).find(
      (p) =>
        p.status === 'active' &&
        p.manifest.type === 'renderer-replacement'
    );
    return replacement?.instance as RendererReplacementPlugin | undefined;
  }

  /**
   * Create a plugin context.
   */
  private createPluginContext(pluginId: string, manifest: PluginManifest): PluginContext {
    const capabilities = manifest.capabilities || {};

    // Load plugin settings
    const allSettings = store.get('plugins.settings', {}) as Record<string, Record<string, unknown>>;
    const pluginSettings = allSettings[pluginId] || {};

    return {
      pluginId,
      manifest,
      storage: this.createPluginStorage(pluginId),
      store: capabilities.accessStore ? this.createStoreAccess() : undefined,
      electron: capabilities.accessElectron ? this.getElectronAPI() : undefined,
      logger: this.createPluginLogger(pluginId),
      settings: pluginSettings,
      events: this.createPluginEventBus(pluginId),
    };
  }

  /**
   * Create isolated storage for a plugin.
   */
  private createPluginStorage(pluginId: string): PluginStorage {
    const getStorageKey = () => `plugins.data.${pluginId}`;

    return {
      get: async <T>(key: string, defaultValue?: T): Promise<T | undefined> => {
        const data = store.get(getStorageKey(), {}) as Record<string, unknown>;
        return (data[key] as T) ?? defaultValue;
      },
      set: async <T>(key: string, value: T): Promise<void> => {
        const data = store.get(getStorageKey(), {}) as Record<string, unknown>;
        data[key] = value;
        store.set(getStorageKey(), data);
      },
      delete: async (key: string): Promise<void> => {
        const data = store.get(getStorageKey(), {}) as Record<string, unknown>;
        delete data[key];
        store.set(getStorageKey(), data);
      },
      clear: async (): Promise<void> => {
        store.set(getStorageKey(), {});
      },
    };
  }

  /**
   * Create Redux store access for plugins.
   */
  private createStoreAccess(): PluginStoreAccess {
    // Note: This returns a limited interface that will be populated
    // by the renderer process when the plugin is used there.
    // For main process, we provide a placeholder.
    return {
      getState: () => ({}),
      dispatch: () => {},
      subscribe: () => () => {},
    };
  }

  /**
   * Get Electron API for plugins.
   */
  private getElectronAPI(): typeof window.electron | undefined {
    // In main process, we don't have window.electron
    // Plugins that need Electron API will get it through IPC
    return undefined;
  }

  /**
   * Create a logger for a plugin.
   */
  private createPluginLogger(pluginId: string): PluginLogger {
    const prefix = `[Plugin:${pluginId}]`;
    return {
      debug: (message: string, ...args: unknown[]) =>
        console.debug(prefix, message, ...args),
      info: (message: string, ...args: unknown[]) =>
        console.info(prefix, message, ...args),
      warn: (message: string, ...args: unknown[]) =>
        console.warn(prefix, message, ...args),
      error: (message: string, ...args: unknown[]) =>
        console.error(prefix, message, ...args),
    };
  }

  /**
   * Create an event bus for inter-plugin communication.
   */
  private createPluginEventBus(pluginId: string): PluginEventBus {
    return {
      emit: (event: string, data?: unknown) => {
        this.globalEventBus.emit(`plugin:${event}`, { source: pluginId, data });
      },
      on: (event: string, handler: (data: unknown) => void) => {
        const wrappedHandler = (payload: { source: string; data: unknown }) => {
          handler(payload.data);
        };
        this.globalEventBus.on(`plugin:${event}`, wrappedHandler);
        return () => this.globalEventBus.off(`plugin:${event}`, wrappedHandler);
      },
      off: (event: string, handler: (data: unknown) => void) => {
        // Note: This won't work correctly with wrapped handlers
        // Consider using a Map to track handlers for proper cleanup
        this.globalEventBus.off(`plugin:${event}`, handler as any);
      },
    };
  }

  /**
   * Validate a plugin instance matches its manifest type.
   */
  private validatePluginInstance(instance: unknown, manifest: PluginManifest): void {
    if (!instance || typeof instance !== 'object') {
      throw new Error('Plugin must export an object');
    }

    if (manifest.type === 'renderer-replacement') {
      const plugin = instance as RendererReplacementPlugin;
      if (!plugin.Renderer || typeof plugin.Renderer !== 'function') {
        throw new Error('Renderer replacement plugins must export a Renderer component');
      }
    }

    // Extension plugins are more flexible - they can have any combination of:
    // remarkPlugins, rehypePlugins, components, preProcess, postProcess
  }

  /**
   * Clear require cache for a module and its dependencies.
   */
  private clearRequireCache(modulePath: string): void {
    try {
      const resolved = require.resolve(modulePath);
      const mod = require.cache[resolved];

      if (mod) {
        // Remove from parent's children
        if (mod.parent) {
          const index = mod.parent.children.indexOf(mod);
          if (index !== -1) {
            mod.parent.children.splice(index, 1);
          }
        }

        // Delete from cache
        delete require.cache[resolved];
      }
    } catch {
      // Module not in cache, that's fine
    }
  }

  /**
   * Get the path for a loaded plugin.
   */
  private getPluginPath(pluginId: string): string | undefined {
    // This would need to be stored during loading
    // For now, return undefined
    return undefined;
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let instance: PluginLoaderService | null = null;

export function getPluginLoaderService(): PluginLoaderService {
  if (!instance) {
    instance = new PluginLoaderService();
  }
  return instance;
}
