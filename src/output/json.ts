export const printJson = <T>(data: T): void => {
  console.log(JSON.stringify(data, null, 2));
};

export const printJsonError = (message: string): never => {
  console.error(JSON.stringify({ error: message }, null, 2));
  process.exit(1);
};
