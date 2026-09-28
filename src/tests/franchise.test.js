const request = require('supertest');
const app = require('../service');
const { randomName, loginAsNewAdmin } = require('./testUtils.js');

const franchisee = { name: 'pizza franchisee', email: 'f@test.com', password: 'a' };
let franchiseeAuthToken;
let adminAuthToken;

beforeAll(async () => {
  franchisee.email = randomName() + '@test.com';
  const registerRes = await request(app).post('/api/auth').send(franchisee);
  franchiseeAuthToken = registerRes.body.token;
  franchisee.id = registerRes.body.user.id;

  adminAuthToken = await loginAsNewAdmin();
});

test('open a franchise', async () => {
  const franchise = { name: randomName(), admins: [{ email: franchisee.email }] };
  const createRes = await request(app).post('/api/franchise').set('Authorization', `Bearer ${adminAuthToken}`).send(franchise);
  expect(createRes.status).toBe(200);
  expect(createRes.body).toMatchObject({ name: franchise.name, admins: [{ id: franchisee.id, email: franchisee.email, name: franchisee.name }] });

  // The franchisee can see the new franchise
  const userFranchisesRes = await request(app).get(`/api/franchise/${franchisee.id}`).set('Authorization', `Bearer ${franchiseeAuthToken}`);
  expect(userFranchisesRes.status).toBe(200);
  expect(userFranchisesRes.body).toEqual(expect.arrayContaining([expect.objectContaining({ id: createRes.body.id, name: franchise.name })]));
});

test('close a franchise', async () => {
  const franchise = await createFranchise();

  const deleteRes = await request(app).delete(`/api/franchise/${franchise.id}`).set('Authorization', `Bearer ${adminAuthToken}`);
  expect(deleteRes.status).toBe(200);
  expect(deleteRes.body).toEqual({ message: 'franchise deleted' });

  // The franchise is gone
  const listRes = await request(app).get(`/api/franchise?name=${franchise.name}`);
  expect(listRes.status).toBe(200);
  expect(listRes.body.franchises).toEqual([]);
});

test('only an admin can open a franchise', async () => {
  const franchise = { name: randomName(), admins: [{ email: franchisee.email }] };
  const createRes = await request(app).post('/api/franchise').set('Authorization', `Bearer ${franchiseeAuthToken}`).send(franchise);
  expect(createRes.status).toBe(403);
});

async function createFranchise() {
  const franchise = { name: randomName(), admins: [{ email: franchisee.email }] };
  const createRes = await request(app).post('/api/franchise').set('Authorization', `Bearer ${adminAuthToken}`).send(franchise);
  return createRes.body;
}
