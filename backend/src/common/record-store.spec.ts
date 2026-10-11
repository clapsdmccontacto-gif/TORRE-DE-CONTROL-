import { MemoryRecordStore, WriteQueue } from './record-store.js';

describe('MemoryRecordStore', () => {
  it('guarda copias por colección y las quita', async () => {
    const store = new MemoryRecordStore();
    const value = { n: 1 };
    await store.put('planes', 'a', value);
    value.n = 2;
    await store.put('otra', 'a', { n: 9 });
    expect(await store.list('planes')).toEqual([{ id: 'a', value: { n: 1 } }]);
    await store.remove('planes', 'a');
    expect(await store.list('planes')).toEqual([]);
    expect(await store.list('otra')).toHaveLength(1);
  });
});

describe('WriteQueue', () => {
  it('escribe en orden y sigue después de un error, que informa una vez', async () => {
    const errors: unknown[] = [];
    const queue = new WriteQueue((e) => errors.push(e));
    const order: number[] = [];
    queue.enqueue(async () => {
      await new Promise((r) => setTimeout(r, 5));
      order.push(1);
    });
    queue.enqueue(async () => {
      throw new Error('sin base');
    });
    await expect(queue.flush()).rejects.toThrow('sin base');
    queue.enqueue(async () => {
      order.push(3);
    });
    await queue.flush();
    expect(order).toEqual([1, 3]);
    expect(errors).toHaveLength(1);
  });
});
