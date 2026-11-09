import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import pg from 'pg';
import { createClient } from 'redis';

if (!process.env.DATABASE_URL || !process.env.REDIS_URL) throw new Error('Set a fresh benchmark database and Redis URL');
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 16 });
const redis = createClient({ url: process.env.REDIS_URL });
const key = 'fastlogistics:benchmark:geo:' + randomUUID();
const radius = 5000;
const points = 25000;
const riders = 128;

await redis.connect();
try {
  await db.query(`
    CREATE EXTENSION IF NOT EXISTS postgis;
    CREATE TABLE benchmark_pickups (id integer PRIMARY KEY, pickup geography(Point,4326), expires_at timestamptz);
    CREATE INDEX ON benchmark_pickups USING gist(pickup);
    CREATE TABLE benchmark_riders (id integer PRIMARY KEY, location geography(Point,4326));
    SELECT setseed(0.62);
    INSERT INTO benchmark_pickups
      SELECT n, ST_SetSRID(ST_MakePoint(6.61+random()*.8,4.41+random()*.8),4326)::geography,
        now()+make_interval(secs=>n::float/1000) FROM generate_series(1,${points}) n;
    INSERT INTO benchmark_riders
      SELECT n, ST_SetSRID(ST_MakePoint(6.71+random()*.6,4.51+random()*.6),4326)::geography
      FROM generate_series(1,${riders}) n;
    ANALYZE benchmark_pickups;
    ANALYZE benchmark_riders;
  `);
  const { rows: pickups } = await db.query('SELECT id, ST_X(pickup::geometry) AS lng, ST_Y(pickup::geometry) AS lat FROM benchmark_pickups');
  for (let start = 0; start < pickups.length; start += 1000) {
    const args = pickups.slice(start, start + 1000).flatMap(({ id, lng, lat }) => [String(lng), String(lat), String(id)]);
    await redis.sendCommand(['GEOADD', key, ...args]);
    await redis.expire(key, 600);
  }
  const { rows: origins } = await db.query('SELECT id,ST_X(location::geometry) AS lng,ST_Y(location::geometry) AS lat FROM benchmark_riders ORDER BY id');

  const select = `SELECT o.id,round(ST_Distance(o.pickup,r.location)) AS meters
    FROM benchmark_riders r JOIN benchmark_pickups o ON ST_DWithin(o.pickup,r.location,${radius})
    WHERE r.id=$1`;
  const order = ' ORDER BY o.expires_at,o.id LIMIT 50';
  const postgis = async (id: number) => (await db.query(select + order, [id])).rows;
  const geo = (lng: number, lat: number) => redis.sendCommand<string[]>([
    'GEOSEARCH', key, 'FROMLONLAT', String(lng), String(lat), 'BYRADIUS', '5050', 'm',
  ]);
  const hybrid = async (id: number) => {
    const { rows: [origin] } = await db.query(
      'SELECT ST_X(location::geometry) AS lng,ST_Y(location::geometry) AS lat FROM benchmark_riders WHERE id=$1', [id],
    );
    const candidates = await geo(origin.lng, origin.lat);
    return (await db.query(select + ' AND o.id=ANY($2::int[])' + order, [id, candidates])).rows;
  };

  for (const { id } of origins) assert.deepEqual(await hybrid(id), await postgis(id));
  console.log(`Verified equivalent ranked results for ${riders} origins against ${points} pickups`);

  const operations = [
    ['PostGIS', (index: number) => postgis(origins[index % riders].id)],
    ['Redis GEO only', (index: number) => {
      const { lng, lat } = origins[index % riders];
      return geo(lng, lat);
    }],
    ['Redis + PostGIS validation', (index: number) => hybrid(origins[index % riders].id)],
  ] as const;
  for (const concurrency of [1, 16, 64]) {
    for (const [name, run] of operations) {
      const reads = concurrency === 1 ? 160 : 640;
      let index = 0;
      const samples: number[] = [];
      const started = performance.now();
      await Promise.all(Array.from({ length: concurrency }, async () => {
        while (index < reads) {
          const next = index++;
          const start = performance.now();
          await run(next);
          samples.push(performance.now() - start);
        }
      }));
      const rate = Math.round(reads * 1000 / (performance.now() - started));
      samples.sort((a, b) => a - b);
      const percentile = (p: number) => samples[Math.ceil(samples.length * p) - 1].toFixed(2);
      console.log(`${concurrency} concurrent | ${name} | ${rate} reads/s | p50 ${percentile(.5)} ms | p95 ${percentile(.95)} ms`);
    }
  }
} finally {
  await redis.del(key);
  await redis.close();
  await db.end();
}
