import autocannon from "autocannon";

const url = process.env.LOAD_BASE_URL || "http://127.0.0.1:8787";
const duration = Number(process.env.LOAD_DURATION_SECONDS || 15);
const connections = Number(process.env.LOAD_CONNECTIONS || 40);

const result = await autocannon({
  url,
  duration,
  connections,
  requests: [{ method: "GET", path: "/" }, { method: "GET", path: "/config.json" }]
});

console.log(
  JSON.stringify(
    {
      url,
      duration,
      connections,
      requests: result.requests.average,
      latency: result.latency.average,
      errors: result.errors,
      timeouts: result.timeouts
    },
    null,
    2
  )
);

if (result.errors || result.timeouts) process.exit(1);
