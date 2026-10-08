// Launch preflight from the command line. Checks the settings in the environment, for example:
//   node --env-file=../../apps/web/.env.production scripts/preflight.mjs
// Exits with 1 while anything is blocking.
import { LAUNCH_TASKS, launchChecks } from "../src/launch.ts";

const checks = launchChecks(process.env);
const mark = (c) => (c.ok ? "ok  " : c.severity === "blocker" ? "STOP" : "warn");
for (const c of checks) {
  console.log(`${mark(c)}  ${c.area.padEnd(11)} ${c.label}`);
  if (!c.ok) console.log(`      ${c.fix}`);
}
console.log("\nAlso done by a person:");
for (const t of LAUNCH_TASKS) console.log(`  - ${t}`);
const blocking = checks.filter((c) => !c.ok && c.severity === "blocker").length;
console.log(blocking ? `\n${blocking} blocking ${blocking === 1 ? "item" : "items"} left.` : "\nNothing blocking.");
process.exit(blocking ? 1 : 0);
