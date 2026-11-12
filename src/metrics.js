const config = require('./config');
const os = require('os');

// Cumulative counters must report when counting began (process start).
const START_TIME = `${Date.now()}000000`;

// ---- HTTP request metrics (cumulative since process start) ----
const requests = { GET: 0, POST: 0, PUT: 0, DELETE: 0 };
let latencyTotalMs = 0;
let latencyCount = 0;

function requestTracker(req, res, next) {
  const start = Date.now();

  // Count right away: we know the method the moment the request arrives.
  requests[req.method] = (requests[req.method] || 0) + 1;

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

// ---- Purchase metrics (cumulative since process start) ----
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

// ---- Auth metrics (cumulative since process start) ----
let authSuccess = 0;
let authFailure = 0;

function authAttempt(success) {
  if (success) {
    authSuccess++;
  } else {
    authFailure++;
  }
}

// ---- Active users (gauge; entries expire) ----
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
function buildMetric(name, value, unit, type, attributes = {}) {
  const attrs = [
    { key: 'source', value: { stringValue: config.metrics.source } },
    { key: 'instance', value: { stringValue: os.hostname() } },
  ];
  for (const [key, val] of Object.entries(attributes)) {
    attrs.push({ key, value: { stringValue: val } });
  }
  const dataPoint = { asDouble: Number(value), timeUnixNano: `${Date.now()}000000`, attributes: attrs };

  if (type === 'sum') {
    dataPoint.startTimeUnixNano = START_TIME;
    return {
      name,
      unit,
      sum: { dataPoints: [dataPoint], aggregationTemporality: 'AGGREGATION_TEMPORALITY_CUMULATIVE', isMonotonic: true },
    };
  }
  return { name, unit, gauge: { dataPoints: [dataPoint] } };
}

function collectMetrics() {
  const list = [];
  for (const [method, count] of Object.entries(requests)) {
    list.push(buildMetric('http_requests', count, '1', 'sum', { method }));
  }
  list.push(buildMetric('http_latency_sum', latencyTotalMs, 'ms', 'sum'));
  list.push(buildMetric('http_latency_count', latencyCount, '1', 'sum'));

  list.push(buildMetric('cpu_usage', getCpuUsagePercentage(), '%', 'gauge'));
  list.push(buildMetric('memory_usage', getMemoryUsagePercentage(), '%', 'gauge'));
  list.push(buildMetric('active_users', getActiveUserCount(), '1', 'gauge'));

  list.push(buildMetric('auth_attempts', authSuccess, '1', 'sum', { status: 'success' }));
  list.push(buildMetric('auth_attempts', authFailure, '1', 'sum', { status: 'failure' }));

  list.push(buildMetric('pizzas_sold', pizzasSold, '1', 'sum'));
  list.push(buildMetric('pizza_failures', pizzaFailures, '1', 'sum'));
  list.push(buildMetric('revenue', revenue, '1', 'sum'));
  list.push(buildMetric('pizza_latency_sum', pizzaLatencyTotalMs, 'ms', 'sum'));
  list.push(buildMetric('pizza_latency_count', pizzaLatencyCount, '1', 'sum'));
  return list;
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
      const metrics = collectMetrics();
      await sendToGrafana(metrics);
    } catch (error) {
      console.log('Error sending metrics', error);
    }
  }, period);
}

module.exports = { requestTracker, pizzaPurchase, authAttempt, userSeen, userLoggedOut, sendMetricsPeriodically };
