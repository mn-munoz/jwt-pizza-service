const request = require('supertest');
const app = require('../service');
const { randomName, loginAsNewAdmin } = require('./testUtils.js');

const diner = { name: 'pizza diner', email: 'd@test.com', password: 'a' };
let dinerAuthToken;
let menuItem;
let franchise;
let store;

beforeAll(async () => {
  diner.email = randomName() + '@test.com';
  const registerRes = await request(app).post('/api/auth').send(diner);
  dinerAuthToken = registerRes.body.token;

  // The test database starts empty, so set up a menu item, franchise, and store as an admin.
  const adminAuthToken = await loginAsNewAdmin();

  const newMenuItem = { title: randomName(), description: 'A test pizza', image: 'pizza1.png', price: 0.05 };
  const menuRes = await request(app).put('/api/order/menu').set('Authorization', `Bearer ${adminAuthToken}`).send(newMenuItem);
  menuItem = menuRes.body.find((item) => item.title === newMenuItem.title);

  const franchiseRes = await request(app).post('/api/franchise').set('Authorization', `Bearer ${adminAuthToken}`).send({ name: randomName(), admins: [] });
  franchise = franchiseRes.body;

  const storeRes = await request(app).post(`/api/franchise/${franchise.id}/store`).set('Authorization', `Bearer ${adminAuthToken}`).send({ name: 'SLC' });
  store = storeRes.body;
});

afterEach(() => {
  jest.restoreAllMocks();
});

function newOrder() {
  return { franchiseId: franchise.id, storeId: store.id, items: [{ menuId: menuItem.id, description: menuItem.title, price: menuItem.price }] };
}

// Stand in for the pizza factory so tests don't send real orders to it.
function mockFactory(ok, body) {
  jest.spyOn(global, 'fetch').mockResolvedValue({ ok, json: async () => body });
}

test('create an order', async () => {
  mockFactory(true, { reportUrl: 'http://factory/report', jwt: 'factory.jwt.token' });
  const order = newOrder();

  const orderRes = await request(app).post('/api/order').set('Authorization', `Bearer ${dinerAuthToken}`).send(order);
  expect(orderRes.status).toBe(200);
  expect(orderRes.body).toMatchObject({ order, followLinkToEndChaos: 'http://factory/report', jwt: 'factory.jwt.token' });
  expect(orderRes.body.order.id).toEqual(expect.any(Number));

  // The order is saved for the diner
  const ordersRes = await request(app).get('/api/order').set('Authorization', `Bearer ${dinerAuthToken}`);
  expect(ordersRes.status).toBe(200);
  expect(ordersRes.body.orders).toEqual(expect.arrayContaining([expect.objectContaining({ id: orderRes.body.order.id, franchiseId: franchise.id, storeId: store.id, items: [expect.objectContaining(order.items[0])] })]));
});

test('create an order when the factory fails', async () => {
  mockFactory(false, { reportUrl: 'http://factory/report' });

  const orderRes = await request(app).post('/api/order').set('Authorization', `Bearer ${dinerAuthToken}`).send(newOrder());
  expect(orderRes.status).toBe(500);
  expect(orderRes.body).toEqual({ message: 'Failed to fulfill order at factory', followLinkToEndChaos: 'http://factory/report' });
});

test('create an order without logging in', async () => {
  const orderRes = await request(app).post('/api/order').send(newOrder());
  expect(orderRes.status).toBe(401);
});
