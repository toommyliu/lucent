import { resolve } from "node:path";
import { syncCssModuleTypes } from "./cssModuleTypes";

await syncCssModuleTypes(resolve(import.meta.dirname, "../src"));
