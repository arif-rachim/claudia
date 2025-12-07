import { PluginConfig, PluginStatus } from '../../types/plugin.types';

interface PluginCardProps {
  plugin: PluginConfig;
  status: PluginStatus;
  onEnable: () => void;
  onDisable: () => void;
  onReload?: () => void;
  isLoading?: boolean;
}

export function PluginCard({
  plugin,
  status,
  onEnable,
  onDisable,
  onReload,
  isLoading = false,
}: PluginCardProps) {
  const isEnabled = plugin.enabled;
  const isActive = status === 'active';
  const hasError = status === 'error';

  const getStatusBadge = () => {
    switch (status) {
      case 'active':
        return (
          <span className="inline-flex items-center rounded-full bg-green-500/20 px-2 py-0.5 text-xs font-medium text-green-400">
            Active
          </span>
        );
      case 'loading':
        return (
          <span className="inline-flex items-center rounded-full bg-yellow-500/20 px-2 py-0.5 text-xs font-medium text-yellow-400">
            Loading...
          </span>
        );
      case 'error':
        return (
          <span className="inline-flex items-center rounded-full bg-red-500/20 px-2 py-0.5 text-xs font-medium text-red-400">
            Error
          </span>
        );
      case 'inactive':
        return (
          <span className="inline-flex items-center rounded-full bg-gray-500/20 px-2 py-0.5 text-xs font-medium text-gray-400">
            Disabled
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center rounded-full bg-blue-500/20 px-2 py-0.5 text-xs font-medium text-blue-400">
            Available
          </span>
        );
    }
  };

  const getTypeBadge = () => {
    if (plugin.type === 'renderer-replacement') {
      return (
        <span className="inline-flex items-center rounded-full bg-purple-500/20 px-2 py-0.5 text-xs font-medium text-purple-400">
          Replacement
        </span>
      );
    }
    return (
      <span className="inline-flex items-center rounded-full bg-blue-500/20 px-2 py-0.5 text-xs font-medium text-blue-400">
        Extension
      </span>
    );
  };

  return (
    <div
      className={`rounded-lg border p-4 transition-colors ${
        hasError
          ? 'border-red-500/50 bg-red-500/5'
          : isActive
          ? 'border-green-500/50 bg-green-500/5'
          : 'border-border bg-surface'
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-text-primary">{plugin.name}</h3>
            {getTypeBadge()}
            {getStatusBadge()}
          </div>
          <p className="mt-1 text-xs text-text-secondary">
            v{plugin.version} • {plugin.source === 'local' ? 'Local' : 'NPM'}
          </p>
        </div>

        {/* Toggle */}
        <div className="flex items-center gap-2">
          {isActive && onReload && (
            <button
              onClick={onReload}
              disabled={isLoading}
              className="rounded p-1 text-text-secondary hover:bg-surface-hover hover:text-text-primary transition-colors disabled:opacity-50"
              title="Reload plugin"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 2v6h-6" />
                <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                <path d="M3 22v-6h6" />
                <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
              </svg>
            </button>
          )}
          <button
            onClick={isEnabled ? onDisable : onEnable}
            disabled={isLoading}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${
              isEnabled ? 'bg-accent' : 'bg-gray-600'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                isEnabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      </div>

      {/* Capabilities */}
      {plugin.capabilities && Object.keys(plugin.capabilities).length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {plugin.capabilities.accessStore && (
            <span className="rounded bg-surface-hover px-1.5 py-0.5 text-xs text-text-secondary">
              Store Access
            </span>
          )}
          {plugin.capabilities.accessElectron && (
            <span className="rounded bg-surface-hover px-1.5 py-0.5 text-xs text-text-secondary">
              Electron API
            </span>
          )}
          {plugin.capabilities.accessNetwork && (
            <span className="rounded bg-surface-hover px-1.5 py-0.5 text-xs text-text-secondary">
              Network
            </span>
          )}
        </div>
      )}

      {/* Path */}
      <p className="mt-2 truncate text-xs text-text-secondary" title={plugin.path}>
        {plugin.path}
      </p>
    </div>
  );
}
