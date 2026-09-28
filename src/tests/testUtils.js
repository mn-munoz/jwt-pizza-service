const request = require('supertest');
const app = require('../service');
const { Role, DB } = require('../database/database.js');

function randomName() {
  return Math.random().toString(36).substring(2, 12);
}

async function loginAsNewAdmin() {
  const admin = { name: 'pizza admin', email: randomName() + '@admin.com', password: 'toomanysecrets', roles: [{ role: Role.Admin }] };
  await DB.addUser(admin);
  const loginRes = await request(app).put('/api/auth').send({ email: admin.email, password: admin.password });
  return loginRes.body.token;
}

module.exports = { randomName, loginAsNewAdmin };
