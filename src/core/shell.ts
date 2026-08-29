export const escapeShell = (value: string): string =>
  `'${value.replace(/'/g, "'\\''")}'`;
