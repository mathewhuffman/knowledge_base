export interface AppConfig {
  workspaces: {
    defaultRoot: string;
  };
  featureFlags: Record<string, boolean>;
}
