const config = require('./config');
const os = require('os');

// ---- HTTP request metrics (reset after each report) ----
const requests = { GET: 0, POST: 0, PUT: 0, DELETE: 0 };
let totalRequests = 0;
let latencyTotalMs = 0;
let latencyCount = 0;

function requestTracker(req, res, next) {
  const start = Date.now();

  // Count right away: we know the method the moment the request arrives.
  if (req.method in requests) {
    requests[req.method]++;
  }
  totalRequests++;

  // Latency is only known once the response has been sent.
  res.on('finish', () => {
    latencyTotalMs += Date.now() - start;
    latencyCount++;
  });

  next();
}

// ---- System metrics (sampled at report time, nothing to reset) ----
function getCpuUsagePercentage() {
  const cpuUsage = os.loadavg()[0] / os.cpus().length;
  return cpuUsage.toFixed(2) * 100;
}

function getMemoryUsagePercentage() {
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const usedMemory = totalMemory - freeMemory;
  const memoryUsage = (usedMemory / totalMemory) * 100;
  return memoryUsage.toFixed(2);
}

// ---- Purchase metrics (reset after each report) ----
let pizzasSold = 0;
let pizzaFailures = 0;
let revenue = 0;
let pizzaLatencyTotalMs = 0;
let pizzaLatencyCount = 0;

function pizzaPurchase(success, latencyMs, price, pizzaCount) {
  if (success) {
    pizzasSold += pizzaCount;
    revenue += price;
  } else {
    pizzaFailures++;
  }
  pizzaLatencyTotalMs += latencyMs;
  pizzaLatencyCount++;
}

// ---- Auth metrics (reset after each report) ----
let authSuccess = 0;
let authFailure = 0;

function authAttempt(success) {
  if (success) {
    authSuccess++;
  } else {
    authFailure++;
  }
}

// ---- Active users (NOT reset; entries expire) ----
const ACTIVE_WINDOW_MS = 5 * 60 * 1000;
const activeUsers = new Map(); // userId -> last time seen (ms)

function userSeen(userId) {
  activeUsers.set(userId, Date.now());
}

function userLoggedOut(userId) {
  activeUsers.delete(userId);
}

function getActiveUserCount() {
  const cutoff = Date.now() - ACTIVE_WINDOW_MS;
  for (const [userId, lastSeen] of activeUsers) {
    if (lastSeen < cutoff) {
      activeUsers.delete(userId);
    }
  }
  return activeUsers.size;
}

// ---- Reporting to Grafana ----
function buildMetric(name, value, unit, attributes = {}) {
  const attrs = [{ key: 'source', value: { stringValue: config.metrics.source } }];
  for (const [key, val] of Object.entries(attributes)) {
    attrs.push({ key, value: { stringValue: val } });
  }
  return {
    name,
    unit,
    gauge: {
      dataPoints: [{ asDouble: Number(value), timeUnixNano: `${Date.now()}000000`, attributes: attrs }],
    },
  };
}

function collectMetrics() {
  const list = [];
  for (const [method, count] of Object.entries(requests)) {
    list.push(buildMetric('http_requests', count, '1', { method }));
  }
  list.push(buildMetric('http_requests_total', totalRequests, '1'));
  list.push(buildMetric('http_latency', latencyCount ? latencyTotalMs / latencyCount : 0, 'ms'));

  list.push(buildMetric('cpu_usage', getCpuUsagePercentage(), '%'));
  list.push(buildMetric('memory_usage', getMemoryUsagePercentage(), '%'));

  list.push(buildMetric('active_users', getActiveUserCount(), '1'));
  list.push(buildMetric('auth_attempts', authSuccess, '1', { status: 'success' }));
  list.push(buildMetric('auth_attempts', authFailure, '1', { status: 'failure' }));

  list.push(buildMetric('pizzas_sold', pizzasSold, '1'));
  list.push(buildMetric('pizza_failures', pizzaFailures, '1'));
  list.push(buildMetric('revenue', revenue, '1'));
  list.push(buildMetric('pizza_latency', pizzaLatencyCount ? pizzaLatencyTotalMs / pizzaLatencyCount : 0, 'ms'));
  return list;
}

function resetMetrics() {
  for (const method of Object.keys(requests)) {
    requests[method] = 0;
  }
  totalRequests = 0;
  latencyTotalMs = 0;
  latencyCount = 0;
  authSuccess = 0;
  authFailure = 0;
  pizzasSold = 0;
  pizzaFailures = 0;
  revenue = 0;
  pizzaLatencyTotalMs = 0;
  pizzaLatencyCount = 0;
  // activeUsers is NOT reset: it's a gauge whose entries expire on their own
}

async function sendToGrafana(metrics) {
  const body = { resourceMetrics: [{ scopeMetrics: [{ metrics }] }] };
  const res = await fetch(config.metrics.endpointUrl, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      Authorization: `Bearer ${config.metrics.accountId}:${config.metrics.apiKey}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    console.error('Failed to push metrics to Grafana', res.status, await res.text());
  }
}

function sendMetricsPeriodically(period) {
  return setInterval(async () => {
    try {
      const metrics = collectMetrics(); // 1. snapshot
      resetMetrics(); //                  2. reset immediately
      await sendToGrafana(metrics); //    3. send the snapshot
    } catch (error) {
      console.log('Error sending metrics', error);
    }
  }, period);
}

module.exports = { requestTracker, pizzaPurchase, authAttempt, userSeen, userLoggedOut, sendMetricsPeriodically };
