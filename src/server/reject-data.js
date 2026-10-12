export function rejectDataPaths(req, res, next) {
  const requestPath = String(req.path || '').replaceAll('\\', '/');
  if (requestPath === '/data' || requestPath.startsWith('/data/')) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  next();
}
