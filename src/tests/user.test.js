const request = require('supertest');
const app = require('../service');
const { randomName, loginAsNewAdmin } = require('./testUtils.js');

test('list users unauthorized', async () => {
  const listUsersRes = await request(app).get('/api/user');
  expect(listUsersRes.status).toBe(401);
});

test('list users forbidden for non-admin', async () => {
  const [, dinerToken] = await registerDiner();
  const listUsersRes = await request(app)
    .get('/api/user')
    .set('Authorization', 'Bearer ' + dinerToken);
  expect(listUsersRes.status).toBe(403);
});

test('list users', async () => {
  const adminToken = await loginAsNewAdmin();
  const listUsersRes = await request(app)
    .get('/api/user')
    .set('Authorization', 'Bearer ' + adminToken);
  expect(listUsersRes.status).toBe(200);
  expect(listUsersRes.body).toEqual({
    users: expect.any(Array),
    more: expect.any(Boolean),
  });
  expect(listUsersRes.body.users.length).toBeGreaterThan(0);
  for (const user of listUsersRes.body.users) {
    expect(user).toEqual({
      id: expect.any(Number),
      name: expect.any(String),
      email: expect.any(String),
      roles: expect.arrayContaining([{ role: expect.any(String) }]),
    });
  }
});


test('get user unauthorized', async () => {
  const [diner] = await registerDiner();
  const getRes = await request(app).get(`/api/user/${diner.id}`);
  expect(getRes.status).toBe(401);
});

test('get self', async () => {
  const [diner, dinerToken] = await registerDiner();
  const getRes = await request(app)
    .get(`/api/user/${diner.id}`)
    .set('Authorization', 'Bearer ' + dinerToken);
  expect(getRes.status).toBe(200);
  expect(getRes.body).toEqual({ id: diner.id, name: diner.name, email: diner.email, roles: [{ role: 'diner' }] });
});

test('get other user forbidden for non-admin', async () => {
  const [, dinerToken] = await registerDiner();
  const [otherDiner] = await registerDiner();
  const getRes = await request(app)
    .get(`/api/user/${otherDiner.id}`)
    .set('Authorization', 'Bearer ' + dinerToken);
  expect(getRes.status).toBe(403);
});

test('admin gets other user', async () => {
  const adminToken = await loginAsNewAdmin();
  const [diner] = await registerDiner();
  const getRes = await request(app)
    .get(`/api/user/${diner.id}`)
    .set('Authorization', 'Bearer ' + adminToken);
  expect(getRes.status).toBe(200);
  expect(getRes.body).toMatchObject({ id: diner.id, name: diner.name, email: diner.email });
});

test('get nonexistent user', async () => {
  const adminToken = await loginAsNewAdmin();
  const getRes = await request(app)
    .get('/api/user/999999999')
    .set('Authorization', 'Bearer ' + adminToken);
  expect(getRes.status).toBe(404);
});

test('update user unauthorized', async () => {
  const [diner] = await registerDiner();
  const updateRes = await request(app).put(`/api/user/${diner.id}`).send({ name: 'new name' });
  expect(updateRes.status).toBe(401);
});

test('update self', async () => {
  const [diner, dinerToken] = await registerDiner();
  const updates = { name: 'updated diner', email: randomName() + '@test.com', password: 'b' };
  const updateRes = await request(app)
    .put(`/api/user/${diner.id}`)
    .set('Authorization', 'Bearer ' + dinerToken)
    .send(updates);
  expect(updateRes.status).toBe(200);
  expect(updateRes.body.user).toMatchObject({ id: diner.id, name: updates.name, email: updates.email });
  expect(updateRes.body.user.password).toBeUndefined();
  expect(updateRes.body.token).toEqual(expect.any(String));

  const loginRes = await request(app).put('/api/auth').send({ email: updates.email, password: updates.password });
  expect(loginRes.status).toBe(200);
});

test('update self name only', async () => {
  const [diner, dinerToken] = await registerDiner();
  const updateRes = await request(app)
    .put(`/api/user/${diner.id}`)
    .set('Authorization', 'Bearer ' + dinerToken)
    .send({ name: 'renamed diner' });
  expect(updateRes.status).toBe(200);
  expect(updateRes.body.user).toMatchObject({ id: diner.id, name: 'renamed diner', email: diner.email });
});

test('update name with apostrophe', async () => {
  const [diner, dinerToken] = await registerDiner();
  const updateRes = await request(app)
    .put(`/api/user/${diner.id}`)
    .set('Authorization', 'Bearer ' + dinerToken)
    .send({ name: "Pat O'Brien" });
  expect(updateRes.status).toBe(200);
  expect(updateRes.body.user.name).toBe("Pat O'Brien");
});

test('update nonexistent user', async () => {
  const adminToken = await loginAsNewAdmin();
  const updateRes = await request(app)
    .put('/api/user/999999999')
    .set('Authorization', 'Bearer ' + adminToken)
    .send({ name: 'nobody' });
  expect(updateRes.status).toBe(404);
});

test('update other user forbidden for non-admin', async () => {
  const [, dinerToken] = await registerDiner();
  const [otherDiner] = await registerDiner();
  const updateRes = await request(app)
    .put(`/api/user/${otherDiner.id}`)
    .set('Authorization', 'Bearer ' + dinerToken)
    .send({ name: 'hacked' });
  expect(updateRes.status).toBe(403);
});

test('admin updates other user', async () => {
  const adminToken = await loginAsNewAdmin();
  const [diner] = await registerDiner();
  const updates = { name: 'admin renamed', email: randomName() + '@test.com', password: 'c' };
  const updateRes = await request(app)
    .put(`/api/user/${diner.id}`)
    .set('Authorization', 'Bearer ' + adminToken)
    .send(updates);
  expect(updateRes.status).toBe(200);
  expect(updateRes.body.user).toMatchObject({ id: diner.id, name: updates.name, email: updates.email });
});

test('delete user unauthorized', async () => {
  const [diner] = await registerDiner();
  const deleteRes = await request(app).delete(`/api/user/${diner.id}`);
  expect(deleteRes.status).toBe(401);
});

test('delete self', async () => {
  const [diner, dinerToken] = await registerDiner();
  const deleteRes = await request(app)
    .delete(`/api/user/${diner.id}`)
    .set('Authorization', 'Bearer ' + dinerToken);
  expect(deleteRes.status).toBe(200);
  expect(deleteRes.body).toEqual({ deleted: true });

  const loginRes = await request(app).put('/api/auth').send({ email: diner.email, password: diner.password });
  expect(loginRes.status).toBe(404);
});

test('delete other user forbidden for non-admin', async () => {
  const [, dinerToken] = await registerDiner();
  const [otherDiner] = await registerDiner();
  const deleteRes = await request(app)
    .delete(`/api/user/${otherDiner.id}`)
    .set('Authorization', 'Bearer ' + dinerToken);
  expect(deleteRes.status).toBe(403);
});

test('admin deletes other user', async () => {
  const adminToken = await loginAsNewAdmin();
  const [diner] = await registerDiner();
  const deleteRes = await request(app)
    .delete(`/api/user/${diner.id}`)
    .set('Authorization', 'Bearer ' + adminToken);
  expect(deleteRes.status).toBe(200);
  expect(deleteRes.body).toEqual({ deleted: true });

  const loginRes = await request(app).put('/api/auth').send({ email: diner.email, password: diner.password });
  expect(loginRes.status).toBe(404);
});

async function registerDiner() {
  const diner = { name: 'pizza diner', email: randomName() + '@test.com', password: 'a' };
  const registerRes = await request(app).post('/api/auth').send(diner);
  return [{ ...registerRes.body.user, password: diner.password }, registerRes.body.token];
}
