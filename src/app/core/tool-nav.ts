/**
 * Files handed to a tool by the dashboard or the results panel. Angular's
 * router state survives the navigation and is read here exactly once, when the
 * page loads, so a normal sidebar visit still starts empty.
 */
export function routerPaths(): string[] {
  const state = window.history.state as { paths?: unknown } | null;
  if (!state || !Array.isArray(state.paths)) return [];
  return state.paths.filter((path): path is string => typeof path === 'string');
}
