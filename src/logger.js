const { AsyncLocalStorage } = require('async_hooks');
const PizzaLogger = require('pizza-logger');
const config = require('./config');

// Remembers which request is being served, so DB/factory/error logs can include the user.
const requestContext = new AsyncLocalStorage();

// pizza-logger provides log(), statusToLogLevel(), nowString() and sendLogToGrafana().
// The methods below add the user to every log and hide more confidential fields.
class Logger extends PizzaLogger {
  httpLogger = (req, res, next) => {
    let send = res.send;
    res.send = (resBody) => {
      const logData = {
        authorized: !!req.headers.authorization,
        path: req.originalUrl,
        method: req.method,
        statusCode: res.statusCode,
        user: this.currentUser(),
        reqBody: JSON.stringify(req.body),
        // res.json() hands send() an already-stringified body; don't stringify it twice.
        resBody: typeof resBody === 'string' ? resBody : JSON.stringify(resBody),
      };
      const level = this.statusToLogLevel(res.statusCode);
      this.log(level, 'http', logData);
      res.send = send;
      return res.send(resBody);
    };
    requestContext.run({ req }, next);
  };

  dbLogger(sql) {
    this.log('info', 'db', { sql, user: this.currentUser() });
  }

  factoryLogger(factoryData) {
    const level = this.statusToLogLevel(factoryData.statusCode);
    this.log(level, 'factory', { ...factoryData, user: this.currentUser() });
  }

  unhandledErrorLogger(err) {
    this.log('error', 'unhandledError', { message: err.message, statusCode: err.statusCode ?? 500, stack: err.stack, user: this.currentUser() });
  }

  currentUser() {
    const user = requestContext.getStore()?.req?.user;
    return user ? { id: user.id, name: user.name, email: user.email } : null;
  }

  sanitize(logData) {
    logData = JSON.stringify(logData);
    // Hide secret fields, whether they are plain ("token":"x") or inside a stringified body (\"token\":\"x\").
    logData = logData.replace(/(\\?"(?:password|token|jwt|apiKey|authorization)\\?":\s*\\?")[^"\\]*(\\?")/gi, '$1*****$2');
    logData = logData.replace(/Bearer\s+[\w.-]+/gi, 'Bearer *****');
    // Backup: hide anything shaped like a JWT, wherever it appears.
    return logData.replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '*****');
  }

  // Replaces pizza-logger's version so logs go only to Grafana, not to the factory.
  sendLogToGrafana(event) {
    // Don't push test-run logs into the real Grafana stream.
    if (process.env.NODE_ENV === 'test') return;

    const body = JSON.stringify(event);
    fetch(`${config.logging.url}`, {
      method: 'post',
      body: body,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.logging.userId}:${config.logging.apiKey}`,
      },
    }).then((res) => {
      if (!res.ok) console.log('Failed to send log to Grafana');
    }).catch((err) => {
      console.log('Error sending log to Grafana:', err.message);
    });
  }
}
module.exports = new Logger(config);
