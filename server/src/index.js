import { SERVICE_ROLE } from "./config.js";
import { bootstrapNode } from "./bootstrap.js";

await bootstrapNode({ role: SERVICE_ROLE });
