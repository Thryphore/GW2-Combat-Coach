import { useCallback, useEffect, useState } from 'react';

export interface Route {
  /** Log permalink being analyzed, if any. */
  log?: string;
  /** Optional reference log permalink for comparison mode. */
  ref?: string;
  /** Character or account name of the player to focus on. */
  player?: string;
}

/**
 * Hash routing keeps deep links working on GitHub Pages, which serves a single
 * index.html and cannot rewrite unknown paths.
 */
function parseHash(hash: string): Route {
  const query = hash.replace(/^#\/?/, '');
  if (!query) return {};
  const params = new URLSearchParams(query);
  const route: Route = {};
  for (const key of ['log', 'ref', 'player'] as const) {
    const value = params.get(key);
    if (value) route[key] = value;
  }
  return route;
}

function serialize(route: Route): string {
  const params = new URLSearchParams();
  for (const key of ['log', 'ref', 'player'] as const) {
    const value = route[key];
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return query ? `#/${query}` : '#/';
}

export function useHashRoute(): [Route, (next: Route) => void] {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));

  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const navigate = useCallback((next: Route) => {
    const serialized = serialize(next);
    if (serialized === window.location.hash) {
      setRoute(next);
      return;
    }
    window.location.hash = serialized;
  }, []);

  return [route, navigate];
}
