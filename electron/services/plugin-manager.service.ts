import { EventEmitter } from 'events';
import {
  PluginConfig,
  PluginStatus,
  DiscoveredPlugin,
  LoadedPlugin,
  MarkdownExtensionPlugin,
  RendererReplacementPlugin,
} from '../../src/types/plugin.types';
import { getPluginDiscoveryService, PluginDiscoveryService } from './plugin-discovery.service';
import { getPluginLoaderService, PluginLoaderService } from './plugin-loader.service';
import { store } from './store.service';

// ============================================================================
// Plugin Manager Service
// ============================================================================

export class PluginManager extends EventEmitter {
  private discoveryService: PluginDiscoveryService;
  private loaderService: PluginLoaderService;
  private discoveredPlugins: Map<string, DiscoveredPlugin> = new Map();
  private stopWatching: (() => void) | null = null;
  private initialized: boolean = false;

  constructor() {
    super();
    this.discoveryService = getPluginDiscoveryService();
    this.loaderService = getPluginLoaderService();

    // Forward loader events
    this.loaderService.on('pluginLoaded', (event) => this.emit('pluginStatusChanged', event));
    this.loaderService.on('pluginUnloaded', (event) => this.emit('pluginStatusChanged', event));
    this.loaderService.on('pluginActivated', (event) => this.emit('pluginStatusChanged', event));
    this.loaderService.on('pluginDeactivated', (event) => this.emit('pluginStatusChanged', event));
    this.loaderService.on('pluginError', (event) => this.emit('pluginError', event));
  }

  /**
   * Initialize the plugin manager.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      console.log('[PluginManager] Already initialized');
      return;
    }

    console.log('[PluginManager] Initializing...');

    // Discover all plugins
    await this.discoverPlugins();

    // Load and activate enabled plugins
    await this.loadEnabledPlugins();

    // Start watching for plugin changes
    this.startWatching();

    this.initialized = true;
    console.log('[PluginManager] Initialization complete');
  }

  /**
   * Shutdown the plugin manager.
   */
  async shutdown(): Promise<void> {
    console.log('[PluginManager] Shutting down...');

    // Stop watching
    if (this.stopWatching) {
      this.stopWatching();
      this.stopWatching = null;
    }

    // Unload all plugins
    const loadedPlugins = this.loaderService.getAllPlugins();
    for (const plugin of loadedPlugins) {
      try {
        await this.loaderService.unloadPlugin(plugin.id);
      } catch (error) {
        console.error(`[PluginManager] Failed to unload plugin ${plugin.id}:`, error);
      }
    }

    this.initialized = false;
    console.log('[PluginManager] Shutdown complete');
  }

  /**
   * Discover all available plugins.
   */
  async discoverPlugins(): Promise<DiscoveredPlugin[]> {
    console.log('[PluginManager] Discovering plugins...');

    const discovered = await this.discoveryService.discoverPlugins();

    // Update discovered plugins map
    this.discoveredPlugins.clear();
    for (const plugin of discovered) {
      this.discoveredPlugins.set(plugin.id, plugin);
    }

    // Sync with stored configs
    this.syncWithStoredConfigs(discovered);

    console.log(`[PluginManager] Discovered ${discovered.length} plugins`);
    this.emit('pluginsDiscovered', { plugins: discovered });

    return discovered;
  }

  /**
   * Load and activate all enabled plugins.
   */
  private async loadEnabledPlugins(): Promise<void> {
    const configs = this.getPluginConfigs();

    for (const [pluginId, config] of Object.entries(configs)) {
      if (!config.enabled) continue;

      const discovered = this.discoveredPlugins.get(pluginId);
      if (!discovered) {
        console.warn(`[PluginManager] Enabled plugin ${pluginId} not found`);
        continue;
      }

      if (!discovered.isValid) {
        console.warn(`[PluginManager] Enabled plugin ${pluginId} is invalid`);
        continue;
      }

      try {
        await this.loaderService.loadPlugin(discovered);
        await this.loaderService.activatePlugin(pluginId);
      } catch (error) {
        console.error(`[PluginManager] Failed to load/activate plugin ${pluginId}:`, error);
      }
    }
  }

  /**
   * Enable a plugin.
   */
  async enablePlugin(pluginId: string): Promise<void> {
    console.log(`[PluginManager] Enabling plugin: ${pluginId}`);

    const discovered = this.discoveredPlugins.get(pluginId);
    if (!discovered) {
      throw new Error(`Plugin ${pluginId} not found`);
    }

    if (!discovered.isValid) {
      throw new Error(`Plugin ${pluginId} is invalid: ${discovered.validationErrors?.join(', ')}`);
    }

    // Check for replacement plugin conflicts
    if (discovered.manifest.type === 'renderer-replacement') {
      const currentReplacement = this.getActiveReplacementPluginId();
      if (currentReplacement && currentReplacement !== pluginId) {
        throw new Error(`Cannot enable ${pluginId}: Another replacement plugin (${currentReplacement}) is already active. Disable it first.`);
      }
    }

    // Load and activate
    await this.loaderService.loadPlugin(discovered);
    await this.loaderService.activatePlugin(pluginId);

    // Update stored config
    this.updatePluginConfig(pluginId, { enabled: true });

    console.log(`[PluginManager] Plugin ${pluginId} enabled`);
  }

  /**
   * Disable a plugin.
   */
  async disablePlugin(pluginId: string): Promise<void> {
    console.log(`[PluginManager] Disabling plugin: ${pluginId}`);

    const plugin = this.loaderService.getPlugin(pluginId);
    if (plugin && plugin.status === 'active') {
      await this.loaderService.deactivatePlugin(pluginId);
    }

    // Update stored config
    this.updatePluginConfig(pluginId, { enabled: false });

    console.log(`[PluginManager] Plugin ${pluginId} disabled`);
  }

  /**
   * Reload a plugin (for development).
   */
  async reloadPlugin(pluginId: string): Promise<void> {
    console.log(`[PluginManager] Reloading plugin: ${pluginId}`);

    const discovered = this.discoveredPlugins.get(pluginId);
    if (!discovered) {
      throw new Error(`Plugin ${pluginId} not found`);
    }

    const config = this.getPluginConfig(pluginId);
    const wasEnabled = config?.enabled ?? false;

    await this.loaderService.reloadPlugin(discovered);

    if (wasEnabled) {
      await this.loaderService.activatePlugin(pluginId);
    }

    console.log(`[PluginManager] Plugin ${pluginId} reloaded`);
  }

  /**
   * Get plugin status.
   */
  getPluginStatus(pluginId: string): PluginStatus {
    const plugin = this.loaderService.getPlugin(pluginId);
    if (plugin) {
      return plugin.status;
    }

    const discovered = this.discoveredPlugins.get(pluginId);
    if (discovered) {
      return discovered.isValid ? 'discovered' : 'error';
    }

    return 'error';
  }

  /**
   * Get all plugin configs.
   */
  getPluginConfigs(): Record<string, PluginConfig> {
    return store.get('plugins.configs', {}) as Record<string, PluginConfig>;
  }

  /**
   * Get a single plugin config.
   */
  getPluginConfig(pluginId: string): PluginConfig | undefined {
    const configs = this.getPluginConfigs();
    return configs[pluginId];
  }

  /**
   * Update plugin config.
   */
  updatePluginConfig(pluginId: string, updates: Partial<PluginConfig>): void {
    const configs = this.getPluginConfigs();
    const existing = configs[pluginId];

    if (existing) {
      configs[pluginId] = { ...existing, ...updates };
    }

    store.set('plugins.configs', configs);
  }

  /**
   * Get plugin settings.
   */
  getPluginSettings(pluginId: string): Record<string, unknown> {
    const allSettings = store.get('plugins.settings', {}) as Record<string, Record<string, unknown>>;
    return allSettings[pluginId] || {};
  }

  /**
   * Update plugin settings.
   */
  updatePluginSettings(pluginId: string, settings: Record<string, unknown>): void {
    const allSettings = store.get('plugins.settings', {}) as Record<string, Record<string, unknown>>;
    allSettings[pluginId] = settings;
    store.set('plugins.settings', allSettings);

    // Update context settings for loaded plugin
    const plugin = this.loaderService.getPlugin(pluginId);
    if (plugin) {
      plugin.context.settings = settings;
    }
  }

  /**
   * Get all discovered plugins.
   */
  getDiscoveredPlugins(): DiscoveredPlugin[] {
    return Array.from(this.discoveredPlugins.values());
  }

  /**
   * Get a loaded plugin.
   */
  getLoadedPlugin(pluginId: string): LoadedPlugin | undefined {
    return this.loaderService.getPlugin(pluginId);
  }

  /**
   * Get all active extension plugins.
   */
  getActiveExtensionPlugins(): MarkdownExtensionPlugin[] {
    return this.loaderService.getActiveExtensionPlugins();
  }

  /**
   * Get the active replacement plugin.
   */
  getActiveReplacementPlugin(): RendererReplacementPlugin | undefined {
    return this.loaderService.getActiveReplacementPlugin();
  }

  /**
   * Get the ID of the active replacement plugin.
   */
  getActiveReplacementPluginId(): string | undefined {
    const plugins = this.loaderService.getAllPlugins();
    const replacement = plugins.find(
      (p) => p.status === 'active' && p.manifest.type === 'renderer-replacement'
    );
    return replacement?.id;
  }

  /**
   * Get ordered list of active extension plugin IDs.
   */
  getActiveExtensionPluginIds(): string[] {
    const plugins = this.loaderService.getAllPlugins();
    return plugins
      .filter((p) => p.status === 'active' && p.manifest.type === 'renderer-extension')
      .sort((a, b) => {
        const priorityA = a.manifest.renderer?.priority ?? 100;
        const priorityB = b.manifest.renderer?.priority ?? 100;
        return priorityA - priorityB;
      })
      .map((p) => p.id);
  }

  /**
   * Sync discovered plugins with stored configs.
   */
  private syncWithStoredConfigs(discovered: DiscoveredPlugin[]): void {
    const existingConfigs = this.getPluginConfigs();
    const newConfigs: Record<string, PluginConfig> = {};

    for (const plugin of discovered) {
      if (existingConfigs[plugin.id]) {
        // Keep existing config, update path and manifest info
        newConfigs[plugin.id] = {
          ...existingConfigs[plugin.id],
          name: plugin.manifest.name,
          version: plugin.manifest.version,
          path: plugin.path,
          type: plugin.manifest.type,
          capabilities: plugin.manifest.capabilities || {},
        };
      } else {
        // Create new config
        newConfigs[plugin.id] = {
          id: plugin.id,
          name: plugin.manifest.name,
          version: plugin.manifest.version,
          source: plugin.source,
          type: plugin.manifest.type,
          enabled: false,
          priority: plugin.manifest.renderer?.priority ?? 100,
          path: plugin.path,
          capabilities: plugin.manifest.capabilities || {},
          settings: {},
          installedAt: new Date().toISOString(),
        };
      }
    }

    store.set('plugins.configs', newConfigs);
  }

  /**
   * Start watching for plugin changes.
   */
  private startWatching(): void {
    this.stopWatching = this.discoveryService.watchPlugins(async (event, pluginId) => {
      console.log(`[PluginManager] Plugin ${event}: ${pluginId}`);

      // Re-discover plugins
      await this.discoverPlugins();

      // Emit change event
      this.emit('pluginChanged', { event, pluginId });
    });
  }

  /**
   * Get the local plugins directory path.
   */
  getLocalPluginsDir(): string {
    return this.discoveryService.getLocalPluginsDir();
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let instance: PluginManager | null = null;

export function getPluginManager(): PluginManager {
  if (!instance) {
    instance = new PluginManager();
  }
  return instance;
}
