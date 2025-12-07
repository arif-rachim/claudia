import { ComponentType, ReactNode } from 'react';
import type { Plugin as UnifiedPlugin } from 'unified';
import {
  MarkdownExtensionPlugin,
  RendererReplacementPlugin,
  RenderContext,
  RendererProps,
} from '../../types/plugin.types';
import { Message } from '../../types/message.types';

// ============================================================================
// Plugin Registry (Renderer-side)
// ============================================================================

/**
 * Registry for renderer plugins loaded in the frontend.
 * This manages plugin instances that have been loaded and activated.
 */
class PluginRendererRegistry {
  private extensionPlugins: Map<string, MarkdownExtensionPlugin> = new Map();
  private replacementPlugin: { id: string; plugin: RendererReplacementPlugin } | null = null;
  private extensionOrder: string[] = [];

  /**
   * Register an extension plugin.
   */
  registerExtension(id: string, plugin: MarkdownExtensionPlugin, priority: number = 100): void {
    this.extensionPlugins.set(id, plugin);
    this.rebuildExtensionOrder();
    console.log(`[PluginRenderer] Registered extension plugin: ${id} (priority: ${priority})`);
  }

  /**
   * Unregister an extension plugin.
   */
  unregisterExtension(id: string): void {
    this.extensionPlugins.delete(id);
    this.rebuildExtensionOrder();
    console.log(`[PluginRenderer] Unregistered extension plugin: ${id}`);
  }

  /**
   * Register a replacement plugin.
   */
  registerReplacement(id: string, plugin: RendererReplacementPlugin): void {
    if (this.replacementPlugin) {
      console.warn(`[PluginRenderer] Replacing existing replacement plugin: ${this.replacementPlugin.id}`);
    }
    this.replacementPlugin = { id, plugin };
    console.log(`[PluginRenderer] Registered replacement plugin: ${id}`);
  }

  /**
   * Unregister the replacement plugin.
   */
  unregisterReplacement(): void {
    if (this.replacementPlugin) {
      console.log(`[PluginRenderer] Unregistered replacement plugin: ${this.replacementPlugin.id}`);
      this.replacementPlugin = null;
    }
  }

  /**
   * Get all registered extension plugins in order.
   */
  getExtensionPlugins(): MarkdownExtensionPlugin[] {
    return this.extensionOrder.map((id) => this.extensionPlugins.get(id)!).filter(Boolean);
  }

  /**
   * Get the replacement plugin if registered.
   */
  getReplacementPlugin(): RendererReplacementPlugin | undefined {
    return this.replacementPlugin?.plugin;
  }

  /**
   * Check if a replacement plugin is registered.
   */
  hasReplacementPlugin(): boolean {
    return this.replacementPlugin !== null;
  }

  /**
   * Get collected remark plugins from all extensions.
   */
  getRemarkPlugins(): UnifiedPlugin[] {
    const plugins: UnifiedPlugin[] = [];
    for (const id of this.extensionOrder) {
      const plugin = this.extensionPlugins.get(id);
      if (plugin?.remarkPlugins) {
        plugins.push(...plugin.remarkPlugins);
      }
    }
    return plugins;
  }

  /**
   * Get collected rehype plugins from all extensions.
   */
  getRehypePlugins(): UnifiedPlugin[] {
    const plugins: UnifiedPlugin[] = [];
    for (const id of this.extensionOrder) {
      const plugin = this.extensionPlugins.get(id);
      if (plugin?.rehypePlugins) {
        plugins.push(...plugin.rehypePlugins);
      }
    }
    return plugins;
  }

  /**
   * Get merged components from all extensions.
   * Later plugins override earlier ones.
   */
  getComponents(): Record<string, ComponentType<unknown>> {
    const components: Record<string, ComponentType<unknown>> = {};
    for (const id of this.extensionOrder) {
      const plugin = this.extensionPlugins.get(id);
      if (plugin?.components) {
        Object.assign(components, plugin.components);
      }
    }
    return components;
  }

  /**
   * Apply pre-processing from all extensions.
   */
  preProcess(content: string, context: RenderContext): string {
    let result = content;
    for (const id of this.extensionOrder) {
      const plugin = this.extensionPlugins.get(id);
      if (plugin?.preProcess) {
        try {
          result = plugin.preProcess(result, context);
        } catch (error) {
          console.error(`[PluginRenderer] Pre-process error in plugin ${id}:`, error);
        }
      }
    }
    return result;
  }

  /**
   * Apply post-processing from all extensions.
   */
  postProcess(element: ReactNode, context: RenderContext): ReactNode {
    let result = element;
    for (const id of this.extensionOrder) {
      const plugin = this.extensionPlugins.get(id);
      if (plugin?.postProcess) {
        try {
          result = plugin.postProcess(result, context);
        } catch (error) {
          console.error(`[PluginRenderer] Post-process error in plugin ${id}:`, error);
        }
      }
    }
    return result;
  }

  /**
   * Check if the replacement plugin can render the given message.
   */
  canReplacementRender(message: Message, context: RenderContext): boolean {
    if (!this.replacementPlugin) return false;

    const { plugin } = this.replacementPlugin;
    if (typeof plugin.canRender === 'function') {
      try {
        return plugin.canRender(message, context);
      } catch (error) {
        console.error(`[PluginRenderer] canRender error:`, error);
        return false;
      }
    }

    // If no canRender, always use replacement
    return true;
  }

  /**
   * Clear all registered plugins.
   */
  clear(): void {
    this.extensionPlugins.clear();
    this.extensionOrder = [];
    this.replacementPlugin = null;
    console.log('[PluginRenderer] Cleared all plugins');
  }

  /**
   * Rebuild the extension order based on priorities.
   */
  private rebuildExtensionOrder(): void {
    // For now, just use insertion order
    // In a real implementation, we'd sort by priority from plugin manifests
    this.extensionOrder = Array.from(this.extensionPlugins.keys());
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let registry: PluginRendererRegistry | null = null;

export function getPluginRendererRegistry(): PluginRendererRegistry {
  if (!registry) {
    registry = new PluginRendererRegistry();
  }
  return registry;
}

// ============================================================================
// Helper Types for MarkdownRenderer
// ============================================================================

export interface PluginRenderConfig {
  remarkPlugins: UnifiedPlugin[];
  rehypePlugins: UnifiedPlugin[];
  components: Record<string, ComponentType<unknown>>;
  preProcess: (content: string, context: RenderContext) => string;
  postProcess: (element: ReactNode, context: RenderContext) => ReactNode;
  ReplacementRenderer: ComponentType<RendererProps> | null;
  canUseReplacement: (message: Message, context: RenderContext) => boolean;
}

/**
 * Get the current plugin render configuration.
 */
export function getPluginRenderConfig(): PluginRenderConfig {
  const reg = getPluginRendererRegistry();

  return {
    remarkPlugins: reg.getRemarkPlugins(),
    rehypePlugins: reg.getRehypePlugins(),
    components: reg.getComponents(),
    preProcess: (content, context) => reg.preProcess(content, context),
    postProcess: (element, context) => reg.postProcess(element, context),
    ReplacementRenderer: reg.getReplacementPlugin()?.Renderer || null,
    canUseReplacement: (message, context) => reg.canReplacementRender(message, context),
  };
}
