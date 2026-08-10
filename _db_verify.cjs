const mysql = require('mysql2/promise');
(async () => {
  const c = await mysql.createConnection({ host: '127.0.0.1', port: 3306, user: 'yiming', password: 'Aa111111', database: 'litemall' });
  console.log('--- 品牌分布 ---');
  const [b] = await c.query('SELECT b.name, COUNT(g.id) cnt FROM litemall_brand b LEFT JOIN litemall_goods g ON g.brand_id=b.id GROUP BY b.id,b.name ORDER BY cnt DESC');
  for (const x of b) console.log(x.name, x.cnt);
  console.log('\n--- 分类分布 ---');
  const [g] = await c.query('SELECT ca.name, COUNT(*) cnt FROM litemall_goods g JOIN litemall_category ca ON ca.id=g.category_id GROUP BY ca.id,ca.name');
  for (const x of g) console.log(x.name, x.cnt);
  console.log('\n--- 订单按月统计 ---');
  const [m] = await c.query('SELECT DATE_FORMAT(add_time,"%Y-%m") ym, COUNT(*) c, ROUND(SUM(order_price),2) amt FROM litemall_order GROUP BY ym ORDER BY ym');
  for (const x of m) console.log(x.ym, x.c, '单 ¥' + x.amt);
  console.log('\n--- 订单状态分布 ---');
  const [s] = await c.query('SELECT order_status, COUNT(*) c FROM litemall_order GROUP BY order_status');
  for (const x of s) console.log(x.order_status, x.c);
  await c.end();
})().catch(e => { console.error(e); process.exit(1); });