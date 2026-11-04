// Starts the local Postgres 16 container `fortu-pg` on port 5432 (password `dev`)
// and waits until it accepts connections. Does nothing if it already runs.
import { execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const NAME = "fortu-pg";

function docker(...args) {
  return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function state() {
  try {
    return docker("inspect", "-f", "{{.State.Running}}", NAME); // "true" | "false"
  } catch {
    return "missing";
  }
}

const s = state();
if (s === "true") {
  console.log(`${NAME} already running`);
  process.exit(0);
}
if (s === "false") {
  docker("start", NAME);
  console.log(`started ${NAME}`);
} else {
  docker("run", "-d", "--name", NAME, "-e", "POSTGRES_PASSWORD=dev", "-p", "5432:5432", "postgres:16");
  console.log(`created ${NAME} (postgres:16 on localhost:5432)`);
}

// Check over TCP: during first-time init the temporary server only listens on a socket.
for (let i = 0; i < 60; i++) {
  try {
    docker("exec", NAME, "pg_isready", "-h", "127.0.0.1", "-U", "postgres");
    console.log(`${NAME} ready`);
    process.exit(0);
  } catch {
    await sleep(500);
  }
}
console.error(`${NAME} did not become ready in 30 s (docker logs ${NAME})`);
process.exit(1);
