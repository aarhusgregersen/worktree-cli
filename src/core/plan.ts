import { readFileSync } from "node:fs";
import { readStdin } from "../utils/stdin.js";

export const resolvePlanText = async (options: {
  plan?: string;
  planFile?: string;
}): Promise<string> => {
  if (options.planFile) {
    return readFileSync(options.planFile, "utf-8");
  }
  if (options.plan === "-") {
    return readStdin();
  }
  return options.plan ?? "";
};
