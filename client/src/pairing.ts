const TOKEN_KEY = "rmc.token";

export function rememberToken(): string | null {
  const params = new URLSearchParams(window.location.search);
  const fresh = params.get("t");
  if (fresh) {
    localStorage.setItem(TOKEN_KEY, fresh);
    return fresh;
  }
  return localStorage.getItem(TOKEN_KEY);
}

export function buildWsUrl(token: string): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/?t=${encodeURIComponent(token)}`;
}
