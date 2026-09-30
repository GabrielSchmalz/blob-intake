import { createIntake } from "../adapter/index";
import type { AppFactory } from "../contract/index";

/** The app supplies authenticated storage, provider verification and durable config. */
export const createCandidate: AppFactory = (dependencies) => createIntake(dependencies);
export { createIntake };
