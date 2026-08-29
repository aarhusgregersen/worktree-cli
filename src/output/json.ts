export const printJson = <T>(data: T): void => {
  console.log(JSON.stringify(data, null, 2));
};
