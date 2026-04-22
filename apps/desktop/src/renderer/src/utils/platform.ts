export function isMacPlatform(): boolean {
  const platformNavigator = navigator as Navigator & {
    userAgentData?: {
      platform?: string;
    };
  };

  const platform = platformNavigator.userAgentData?.platform ?? platformNavigator.platform ?? '';
  return /mac/i.test(platform);
}
