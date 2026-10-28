// There is no file system in the app: reads report a missing file, which the bot loaders treat as "no network".
function missing(path) {
  const err = new Error(`ENOENT: ${path}`);
  err.code = 'ENOENT';
  throw err;
}

export const readFileSync = missing;
export const existsSync = () => false;
export default { readFileSync, existsSync };
