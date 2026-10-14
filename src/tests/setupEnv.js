// Tests create, update, and delete users, so they must never run against the local dev database.
// Locally, use `npm run test:docker` (sets DB_PORT to the throwaway container). CI provides its own database.
if (!process.env.CI && !process.env.DB_PORT) {
  throw new Error('Refusing to run tests against the dev database. Use `npm run test:docker` instead.');
}
