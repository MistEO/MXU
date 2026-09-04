export function cacheTaskEnabledForController(
  cache: Record<string, boolean> | undefined,
  controllerName: string | undefined,
  enabled: boolean,
): Record<string, boolean> | undefined {
  if (!controllerName) return cache;
  return { ...cache, [controllerName]: enabled };
}
