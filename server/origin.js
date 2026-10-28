// Cross-site requests with ambient cookies are the risk, so a browser Origin must match our host (or be allow-listed).
// Requests without an Origin (native apps, tools) pass: they cannot ride on a victim's cookies.
export function makeOriginCheck(config) {
  return (origin, host) => {
    if (!origin) return true;
    if (config.allowedOrigins.includes(origin)) return true;
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  };
}

export function originGuard(originAllowed) {
  return (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    if (!originAllowed(req.headers.origin, req.headers.host)) return res.status(403).json({ error: 'bad_origin' });
    return next();
  };
}
