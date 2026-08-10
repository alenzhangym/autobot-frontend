const mysql = require('mysql2/promise');
async function main() {
  const conn = await mysql.createConnection({ host:'127.0.0.1',port:3306,user:'yiming',password:'Aa111111',database:'litemall' });
  console.log('=== GOODS (id,name,category_id,brand_id,retail_price,add_time) ===');
  const [goods] = await conn.query(`SELECT id,name,category_id,brand_id,retail_price,add_time FROM litemall_goods ORDER BY category_id`);
  for (const g of goods) console.log(`${g.id}\t${g.name}\tcat=${g.category_id}\tbrand=${g.brand_id}\tp=${g.retail_price}\t${g.add_time}`);
  console.log('\n=== CATEGORY (L1 only, top-level) ===');
  const [cats] = await conn.query(`SELECT id,name,pid,level FROM litemall_category WHERE pid=0 ORDER BY id`);
  for (const c of cats) console.log(`${c.id}\t${c.name}\t${c.level}`);
  console.log('\n=== CATEGORY count by level ===');
  const [lvl] = await conn.query(`SELECT level, COUNT(*) c FROM litemall_category GROUP BY level`);
  console.log(JSON.stringify(lvl));
  await conn.end();
}
main().catch(e=>{console.error('ERR',e);process.exit(1);});