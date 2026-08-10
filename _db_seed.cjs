const mysql = require('mysql2/promise');

// ============ 品牌 seed（新增多样化品牌，模拟真实电商品牌分布）============
// key: brandName -> {pic, floor}
const BRANDS = [
  { name: '华为', floor: 1999.00, pic: 'https://dummyimage.com/200x200/1A1A1A/fff&text=Huawei' },
  { name: '小米', floor: 99.00,  pic: 'https://dummyimage.com/200x200/FF6900/fff&text=MI' },
  { name: '海尔', floor: 1299.00, pic: 'https://dummyimage.com/200x200/0057B8/fff&text=Haier' },
  { name: '方太', floor: 899.00,  pic: 'https://dummyimage.com/200x200/333333/fff&text=Fotile' },
  { name: '耐克', floor: 299.00,  pic: 'https://dummyimage.com/200x200/E70000/fff&text=Nike' },
  { name: '斯凯奇', floor: 199.00, pic: 'https://dummyimage.com/200x200/000000/fff&text=Skechers' },
  { name: '优衣库', floor: 99.00,  pic: 'https://dummyimage.com/200x200/FF0000/fff&text=UNIQLO' },
  { name: '欧莱雅', floor: 129.00, pic: 'https://dummyimage.com/200x200/000000/fff&text=LOREAL' },
  { name: '三只松鼠', floor: 49.00, pic: 'https://dummyimage.com/200x200/F36F21/fff&text=3Squirrels' },
  { name: '飞利浦', floor: 199.00, pic: 'https://dummyimage.com/200x200/231F20/fff&text=Philips' },
  { name: '戴森', floor: 1999.00, pic: 'https://dummyimage.com/200x200/000000/fff&text=Dyson' },
  { name: '无印良品', floor: 59.00, pic: 'https://dummyimage.com/200x200/7A0026/fff&text=MUJI' },
];

// goodsId -> brandName（将所有 brand_id=0 的商品分配到品牌）
const GOODS_BRAND = {
  3000001: '华为', 3000002: '小米', 3000003: '小米', 3000004: '小米',
  3000005: '优衣库', 3000006: '优衣库', 3000007: '耐克', 3000008: '无印良品',
  3000009: '飞利浦', 3000010: '无印良品', 3000011: '无印良品', 3000012: '方太',
  3000013: '无印良品', 3000014: '无印良品', 3000015: '欧莱雅', 3000016: '小米',
  3000017: '华为', 3000018: '海尔', 3000019: '三只松鼠', 3000020: '三只松鼠',
  3000021: '三只松鼠', 3000022: '无印良品', 3000023: '欧莱雅', 3000024: '无印良品',
  3000025: '斯凯奇', 3000026: '小米', 3000027: '无印良品', 3000028: '耐克',
  3000029: '飞利浦', 3000030: '斯凯奇',
};

// goodsId -> 该商品的实际单价（用于订单金额计算）
const GOODS_PRICE = {
  3000001: 3999, 3000002: 199, 3000003: 99, 3000004: 129,
  3000005: 599, 3000006: 299, 3000007: 399, 3000008: 899,
  3000009: 1299, 3000010: 199, 3000011: 499, 3000012: 259,
  3000013: 1999, 3000014: 159, 3000015: 299, 3000016: 999,
  3000017: 5999, 3000018: 2499, 3000019: 128, 3000020: 59,
  3000021: 49, 3000022: 198, 3000023: 168, 3000024: 39,
  3000025: 129, 3000026: 199, 3000027: 159, 3000028: 399,
  3000029: 299, 3000030: 189,
};

const GOODS_NAME = {
  3000001: 'Litemall Pro 手机', 3000002: 'Litemall Mini 音箱', 3000003: '智能运动手环', 3000004: '智能体脂秤',
  3000005: '优雅丝绸连衣裙', 3000006: '商务休闲衬衫', 3000007: '舒适透气跑步鞋', 3000008: '真皮通勤公文包',
  3000009: '经典石英腕表', 3000010: '防蓝光眼镜', 3000011: '纯棉四件套', 3000012: '不粘锅炒锅',
  3000013: '北欧风布艺沙发', 3000014: '多层收纳柜', 3000015: '电动牙刷', 3000016: '全自动猫砂盆',
  3000017: '超薄笔记本电脑', 3000018: '变频滚筒洗衣机', 3000019: '每日坚果礼盒', 3000020: '精酿啤酒6罐装',
  3000021: '当季新鲜苹果', 3000022: '特级初榨橄榄油', 3000023: '综合维生素片', 3000024: '婴儿纯棉湿巾',
  3000025: '儿童运动卫衣', 3000026: '积木拼装玩具', 3000027: '多功能孕妇枕', 3000028: '双人自动帐篷',
  3000029: '车载空气净化器', 3000030: '专业骑行头盔',
};

// 订单状态：101 待付款 / 201 待发货 / 301 待收货 / 401 已完成 / 402 已取消
const STATUS = [101, 201, 301, 401, 401, 401, 401, 402];
const CONSIGNEES = ['张伟', '王芳', '李娜', '刘洋', '陈静', '杨帆', '赵敏', '黄磊', '周杰', '吴倩', '徐强', '孙丽', '马超', '朱婷', '胡军', '郭涛', '林峰', '何薇', '高翔', '罗浩'];
const ADDRESSES = ['北京市朝阳区建国路88号', '上海市浦东新区张江高科技园', '广州市天河区珠江新城', '深圳市南山区科技园', '杭州市西湖区文三路', '成都市高新区天府三街', '南京市鼓楼区中山路', '武汉市洪山区光谷大道', '西安市雁塔区高新路', '重庆市渝北区金开大道', '苏州市工业园区星湖街', '长沙市岳麓区梅溪湖'];

let seq = 1;
function snfy() {
  const ts = Date.now().toString().slice(-6);
  const n = String(seq++).padStart(4, '0');
  return '2026' + ts + n;
}

function rand(mn, mx) { return mn + Math.floor(Math.random() * (mx - mn + 1)); }

async function main() {
  const c = await mysql.createConnection({ host: '127.0.0.1', port: 3306, user: 'yiming', password: 'Aa111111', database: 'litemall', multipleStatements: true });

  // 1) 插入品牌（若不存在）
  const brandMap = {};
  const [existingBrands] = await c.query('SELECT id,name FROM litemall_brand');
  for (const b of existingBrands) brandMap[b.name] = b.id;
  for (const b of BRANDS) {
    if (!brandMap[b.name]) {
      const [r] = await c.query(
        'INSERT INTO litemall_brand (name, `desc`, pic_url, floor_price, add_time, update_time) VALUES (?,?,?,?,?,?)',
        [b.name, '官方自营旗舰店', b.pic, b.floor, new Date(), new Date()]
      );
      brandMap[b.name] = r.insertId;
    }
  }
  console.log('品牌准备完成:', Object.keys(brandMap).join(', '));

  // 2) 为商品分配品牌
  for (const [goodsId, brandName] of Object.entries(GOODS_BRAND)) {
    await c.query('UPDATE litemall_goods SET brand_id=? WHERE id=? AND (brand_id=0 OR brand_id IS NULL)', [brandMap[brandName], goodsId]);
  }
  console.log('商品品牌分配完成');

  // 3) 生成跨 12 个月的订单（2025-08 ~ 2026-07）
  const orderIds = [];
  const goodIds = Object.keys(GOODS_PRICE).map(Number);
  const startMonth = new Date(2025, 7, 1); // 2025-08
  const now = new Date();

  for (let m = 0; m < 12; m++) {
    const monthBase = new Date(startMonth.getFullYear(), startMonth.getMonth() + m, 1);
    // 每月订单量逐渐增长，最后几个月是促销季
    const monthIdx = m; // 0=8月 ... 11=次年7月
    const seasonBoost = (monthIdx % 12 === 0 || monthIdx % 12 === 10) ? 30 : 0; // 去年8月/今年6月618促销
    const ordersThisMonth = rand(25, 45) + seasonBoost;

    for (let o = 0; o < ordersThisMonth; o++) {
      const day = rand(1, 28);
      const addTime = new Date(monthBase.getFullYear(), monthBase.getMonth(), day, rand(9, 21), rand(0, 59), rand(0, 59));
      if (addTime > now) continue;

      const status = STATUS[rand(0, STATUS.length - 1)];
      let payTime = null, shipTime = null, confirmTime = null, endTime = null;
      if (status >= 201) { payTime = new Date(addTime.getTime() + rand(5, 120) * 60000); }
      if (status >= 301) { shipTime = new Date(payTime.getTime() + rand(1, 3) * 86400000); }
      if (status >= 401) { confirmTime = new Date(shipTime.getTime() + rand(3, 7) * 86400000); endTime = confirmTime; }

      const consignee = CONSIGNEES[rand(0, CONSIGNEES.length - 1)];
      const address = ADDRESSES[rand(0, ADDRESSES.length - 1)];
      const mobile = '13' + rand(100000000, 999999999);

      const orderSn = '2026' + addTime.getFullYear() + String(addTime.getMonth() + 1).padStart(2, '0') + String(addTime.getDate()).padStart(2, '0') + String(seq++).padStart(6, '0');

      // 每单 1~3 个商品
      const nItems = rand(1, 3);
      let goodsPrice = 0;
      const items = [];
      for (let i = 0; i < nItems; i++) {
        const gid = goodIds[rand(0, goodIds.length - 1)];
        const num = rand(1, 3);
        const price = GOODS_PRICE[gid];
        goodsPrice += price * num;
        items.push({ gid, num, price });
      }
      const freight = goodsPrice >= 99 ? 0 : 10;
      const coupon = status === 102 ? 0 : (Math.random() < 0.3 ? Math.min(20, Math.round(goodsPrice * 0.05)) : 0);
      const orderPrice = goodsPrice + freight;
      const actualPrice = orderPrice - coupon;

      const [ir] = await c.query(
        `INSERT INTO litemall_order
         (user_id, order_sn, order_status, aftersale_status, consignee, mobile, address, message,
          goods_price, freight_price, coupon_price, integral_price, groupon_price, order_price, actual_price,
          pay_id, pay_time, ship_sn, ship_channel, ship_time, confirm_time, comments, end_time, add_time, update_time)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [3, orderSn, status, 0, consignee, mobile, address, '',
         goodsPrice, freight, coupon, 0, 0, orderPrice, actualPrice,
         status >= 201 ? 'wx' + Math.random().toString(36).slice(2, 12) : null, payTime,
         status >= 301 ? 'SF' + Math.random().toString(36).slice(2, 12).toUpperCase() : null, '顺丰速运', shipTime,
         confirmTime, 0, endTime, addTime, addTime]
      );
      const orderId = ir.insertId;
      orderIds.push(orderId);

      for (const it of items) {
        await c.query(
          `INSERT INTO litemall_order_goods (order_id, goods_id, goods_name, goods_sn, product_id, number, price, specifications, pic_url, comment, add_time, update_time)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          [orderId, it.gid, GOODS_NAME[it.gid], 'G' + it.gid, it.gid, it.num, it.price, '[]', '', 0, addTime, addTime]
        );
      }
    }
  }

  const [oc] = await c.query('SELECT COUNT(*) c FROM litemall_order');
  const [ogc] = await c.query('SELECT COUNT(*) c FROM litemall_order_goods');
  const [bc] = await c.query('SELECT COUNT(*) c FROM litemall_brand');
  const [gB] = await c.query('SELECT COUNT(DISTINCT brand_id) c FROM litemall_goods WHERE brand_id>0');
  console.log(`\n=== 完成 ===\norder=${oc[0].c}, order_goods=${ogc[0].c}, brand=${bc[0].c}, 有品牌商品数DISTINCT=${gB[0].c}`);
  await c.end();
}

main().catch(e => { console.error('ERR', e); process.exit(1); });