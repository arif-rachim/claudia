import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import {
  PluginManifest,
  DiscoveredPlugin,
  PluginCapabilities,
} from '../../src/types/plugin.types';

// ============================================================================
// Constants
// ============================================================================

const LOCAL_PLUGINS_DIR = '.claudia/plugins';
const PLUGIN_MANIFEST_FILE = 'plugin.json';
const NPM_PLUGIN_PREFIX = 'claudia-plugin-';
const NPM_SCOPED_PLUGIN_PATTERN = /^@[\w-]+\/claudia-plugin-/;

// ============================================================================
// Plugin Discovery Service
// ============================================================================

export class PluginDiscoveryService {
  private localPluginsDir: string;
  private nodeModulesDir: string;

  constructor() {
    this.localPluginsDir = path.join(app.getPath('home'), LOCAL_PLUGINS_DIR);
    // Node modules relative to the app
    this.nodeModulesDir = path.join(app.getAppPath(), 'node_modules');
  }

  /**
   * Discover all plugins from both local and npm sources.
   */
  async discoverPlugins(): Promise<DiscoveredPlugin[]> {
    const plugins: DiscoveredPlugin[] = [];

    // Discover local plugins
    const localPlugins = await this.discoverLocalPlugins();
    plugins.push(...localPlugins);

    // Discover npm plugins
    const npmPlugins = await this.discoverNpmPlugins();
    plugins.push(...npmPlugins);

    console.log(`[PluginDiscovery] Discovered ${plugins.length} plugins (${localPlugins.length} local, ${npmPlugins.length} npm)`);

    return plugins;
  }

  /**
   * Discover local plugins from ~/.claudia/plugins/
   */
  async discoverLocalPlugins(): Promise<DiscoveredPlugin[]> {
    const plugins: DiscoveredPlugin[] = [];

    // Ensure plugins directory exists
    await this.ensureLocalPluginsDir();

    try {
      const entries = await fs.promises.readdir(this.localPluginsDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const pluginPath = path.join(this.localPluginsDir, entry.name);
        const manifestPath = path.join(pluginPath, PLUGIN_MANIFEST_FILE);

        // Check if plugin.json exists
        if (!fs.existsSync(manifestPath)) {
          console.log(`[PluginDiscovery] Skipping ${entry.name}: no plugin.json found`);
          continue;
        }

        try {
          const manifestContent = await fs.promises.readFile(manifestPath, 'utf-8');
          const manifestJson = JSON.parse(manifestContent);

          const validation = this.validateManifest(manifestJson);

          if (validation.valid) {
            plugins.push({
              id: manifestJson.id || entry.name,
              source: 'local',
              path: pluginPath,
              manifest: manifestJson as PluginManifest,
              isValid: true,
            });
            console.log(`[PluginDiscovery] Found valid local plugin: ${manifestJson.name || entry.name}`);
          } else {
            plugins.push({
              id: manifestJson.id || entry.name,
              source: 'local',
              path: pluginPath,
              manifest: manifestJson as PluginManifest,
              isValid: false,
              validationErrors: validation.errors,
            });
            console.warn(`[PluginDiscovery] Invalid local plugin ${entry.name}:`, validation.errors);
          }
        } catch (error) {
          console.error(`[PluginDiscovery] Failed to read plugin ${entry.name}:`, error);
          plugins.push({
            id: entry.name,
            source: 'local',
            path: pluginPath,
            manifest: { id: entry.name, name: entry.name, version: '0.0.0', type: 'renderer-extension', main: '' },
            isValid: false,
            validationErrors: [`Failed to parse plugin.json: ${error instanceof Error ? error.message : 'Unknown error'}`],
          });
        }
      }
    } catch (error) {
      console.error('[PluginDiscovery] Failed to read local plugins directory:', error);
    }

    return plugins;
  }

  /**
   * Discover npm plugins from node_modules/
   */
  async discoverNpmPlugins(): Promise<DiscoveredPlugin[]> {
    const plugins: DiscoveredPlugin[] = [];

    try {
      if (!fs.existsSync(this.nodeModulesDir)) {
        console.log('[PluginDiscovery] node_modules directory not found');
        return plugins;
      }

      const entries = await fs.promises.readdir(this.nodeModulesDir, { withFileTypes: true });

      for (const entry of entries) {
        // Handle scoped packages (@org/claudia-plugin-*)
        if (entry.name.startsWith('@') && entry.isDirectory()) {
          const scopedDir = path.join(this.nodeModulesDir, entry.name);
          const scopedEntries = await fs.promises.readdir(scopedDir, { withFileTypes: true });

          for (const scopedEntry of scopedEntries) {
            if (scopedEntry.isDirectory() && scopedEntry.name.startsWith(NPM_PLUGIN_PREFIX)) {
              const fullName = `${entry.name}/${scopedEntry.name}`;
              const pluginPath = path.join(scopedDir, scopedEntry.name);
              const plugin = await this.loadNpmPlugin(fullName, pluginPath);
              if (plugin) plugins.push(plugin);
            }
          }
        }
        // Handle regular packages (claudia-plugin-*)
        else if (entry.isDirectory() && entry.name.startsWith(NPM_PLUGIN_PREFIX)) {
          const pluginPath = path.join(this.nodeModulesDir, entry.name);
          const plugin = await this.loadNpmPlugin(entry.name, pluginPath);
          if (plugin) plugins.push(plugin);
        }
      }
    } catch (error) {
      console.error('[PluginDiscovery] Failed to scan node_modules:', error);
    }

    return plugins;
  }

  /**
   * Load an npm plugin from its package.json
   */
  private async loadNpmPlugin(packageName: string, pluginPath: string): Promise<DiscoveredPlugin | null> {
    const packageJsonPath = path.join(pluginPath, 'package.json');

    if (!fs.existsSync(packageJsonPath)) {
      return null;
    }

    try {
      const packageContent = await fs.promises.readFile(packageJsonPath, 'utf-8');
      const packageJson = JSON.parse(packageContent);

      // Check for claudia field in package.json
      const claudiaConfig = packageJson.claudia;
      if (!claudiaConfig) {
        console.log(`[PluginDiscovery] Skipping ${packageName}: no claudia field in package.json`);
        return null;
      }

      // Build manifest from package.json + claudia config
      const manifest: PluginManifest = {
        id: packageJson.name || packageName,
        name: claudiaConfig.name || packageJson.name || packageName,
        version: packageJson.version || '0.0.0',
        description: packageJson.description,
        author: typeof packageJson.author === 'string' ? packageJson.author : packageJson.author?.name,
        homepage: packageJson.homepage,
        license: packageJson.license,
        type: claudiaConfig.type || 'renderer-extension',
        main: claudiaConfig.main || packageJson.main || 'index.js',
        renderer: claudiaConfig.renderer,
        capabilities: claudiaConfig.capabilities,
        dependencies: claudiaConfig.dependencies,
        settingsSchema: claudiaConfig.settingsSchema,
      };

      const validation = this.validateManifest(manifest);

      if (validation.valid) {
        console.log(`[PluginDiscovery] Found valid npm plugin: ${manifest.name}`);
        return {
          id: manifest.id,
          source: 'npm',
          path: pluginPath,
          manifest,
          isValid: true,
        };
      } else {
        console.warn(`[PluginDiscovery] Invalid npm plugin ${packageName}:`, validation.errors);
        return {
          id: manifest.id,
          source: 'npm',
          path: pluginPath,
          manifest,
          isValid: false,
          validationErrors: validation.errors,
        };
      }
    } catch (error) {
      console.error(`[PluginDiscovery] Failed to load npm plugin ${packageName}:`, error);
      return null;
    }
  }

  /**
   * Validate a plugin manifest.
   */
  validateManifest(manifest: unknown): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!manifest || typeof manifest !== 'object') {
      return { valid: false, errors: ['Manifest must be an object'] };
    }

    const m = manifest as Record<string, unknown>;

    // Required fields
    if (!m.id || typeof m.id !== 'string') {
      errors.push('Missing or invalid "id" field');
    }

    if (!m.name || typeof m.name !== 'string') {
      errors.push('Missing or invalid "name" field');
    }

    if (!m.version || typeof m.version !== 'string') {
      errors.push('Missing or invalid "version" field');
    }

    if (!m.type || (m.type !== 'renderer-extension' && m.type !== 'renderer-replacement')) {
      errors.push('Missing or invalid "type" field (must be "renderer-extension" or "renderer-replacement")');
    }

    if (!m.main || typeof m.main !== 'string') {
      errors.push('Missing or invalid "main" field');
    }

    // Validate renderer config if present
    if (m.renderer && typeof m.renderer === 'object') {
      const renderer = m.renderer as Record<string, unknown>;
      if (renderer.priority !== undefined && typeof renderer.priority !== 'number') {
        errors.push('renderer.priority must be a number');
      }
      if (renderer.allowFallback !== undefined && typeof renderer.allowFallback !== 'boolean') {
        errors.push('renderer.allowFallback must be a boolean');
      }
    }

    // Validate capabilities if present
    if (m.capabilities && typeof m.capabilities === 'object') {
      const caps = m.capabilities as Record<string, unknown>;
      const validCaps = ['accessStore', 'accessElectron', 'accessServices', 'accessNetwork'];
      for (const key of Object.keys(caps)) {
        if (!validCaps.includes(key)) {
          errors.push(`Unknown capability: ${key}`);
        } else if (typeof caps[key] !== 'boolean') {
          errors.push(`Capability ${key} must be a boolean`);
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Ensure the local plugins directory exists.
   */
  private async ensureLocalPluginsDir(): Promise<void> {
    try {
      await fs.promises.mkdir(this.localPluginsDir, { recursive: true });
    } catch (error) {
      // Ignore if already exists
    }
  }

  /**
   * Get the local plugins directory path.
   */
  getLocalPluginsDir(): string {
    return this.localPluginsDir;
  }

  /**
   * Watch for plugin changes in the local plugins directory.
   * Returns a cleanup function to stop watching.
   */
  watchPlugins(callback: (event: 'added' | 'removed' | 'changed', pluginId: string) => void): () => void {
    let watcher: fs.FSWatcher | null = null;

    try {
      // Ensure directory exists before watching
      if (!fs.existsSync(this.localPluginsDir)) {
        fs.mkdirSync(this.localPluginsDir, { recursive: true });
      }

      watcher = fs.watch(this.localPluginsDir, { recursive: true }, (eventType, filename) => {
        if (!filename) return;

        // Extract plugin folder name from path
        const parts = filename.split(path.sep);
        const pluginId = parts[0];

        if (eventType === 'rename') {
          // Check if it was added or removed
          const pluginPath = path.join(this.localPluginsDir, pluginId);
          if (fs.existsSync(pluginPath)) {
            callback('added', pluginId);
          } else {
            callback('removed', pluginId);
          }
        } else {
          callback('changed', pluginId);
        }
      });

      console.log('[PluginDiscovery] Started watching local plugins directory');
    } catch (error) {
      console.error('[PluginDiscovery] Failed to watch plugins directory:', error);
    }

    return () => {
      if (watcher) {
        watcher.close();
        console.log('[PluginDiscovery] Stopped watching local plugins directory');
      }
    };
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let instance: PluginDiscoveryService | null = null;

export function getPluginDiscoveryService(): PluginDiscoveryService {
  if (!instance) {
    instance = new PluginDiscoveryService();
  }
  return instance;
}
