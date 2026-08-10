const mysql = require('mysql2/promise');

// category_id -> [ {name, price}, ... ] 每个叶子分类 6~8 个商品，保证分类分布多样性
const CATALOG = {
  2000002: [['雪纺连衣裙',289],['羊毛针织衫',199],['高腰半身裙',159],['呢子大衣',599],['蕾丝内衣',89],['打底裤',69],['休闲连帽卫衣',129],['纯棉T恤',59]],
  2000003: [['商务休闲裤',199],['牛津纺衬衫',159],['棒球夹克',399],['纯棉平角内裤',49],['速干Polo衫',129],['直筒牛仔裤',219],['轻薄羽绒外套',499]],
  2000004: [['缓震运动鞋',399],['头层牛皮皮鞋',459],['沙滩凉鞋',119],['短筒马丁靴',369],['帆布板鞋',159],['居家棉拖鞋',39]],
  2000005: [['防水双肩包',259],['真皮手提包',699],['短款钱包',159],['万向轮拉杆箱',399],['链条单肩包',329],['薄款卡包',79]],
  2000006: [['925银项链',199],['水晶手链',129],['素圈戒指',89],['珍珠耳环',169],['石英商务手表',499],['翡翠手镯',899]],
  2000007: [['偏光太阳镜',199],['防蓝光近视镜',299],['棒球帽',79],['羊毛围巾',129],['自动扣皮带',99],['商务领带',69]],
  2000009: [['水洗棉四件套',299],['大豆纤维被',259],['乳胶枕',169],['纯棉床单',129],['遮光窗帘',219],['纯棉毛巾',29]],
  2000010: [['不粘炒锅',199],['不锈钢汤锅',159],['厨房刀具套装',219],['实木砧板',79],['骨瓷碗碟套装',169],['不锈钢保温杯',89]],
  2000011: [['北欧布艺沙发',2599],['乳胶床垫',1999],['升降书桌',699],['实木衣柜',1599],['折叠餐桌',899],['实木书架',459]],
  2000012: [['塑料收纳箱',59],['旋转拖把',89],['手持吸尘器',399],['不锈钢落地衣架',119],['多层储物柜',199],['带盖垃圾桶',39]],
  2000013: [['氨基酸洗面奶',79],['保湿面霜',159],['丝绒口红',99],['无硅油洗发水',69],['补水面膜',49],['淡香水',299]],
  2000014: [['全价猫粮5kg',129],['成犬狗粮10kg',159],['豆腐猫砂',49],['宠物窝垫',89],['伸缩牵引绳',59],['逗猫玩具',29]],
  2000016: [['5G智能手机',3999],['液态硅胶手机壳',39],['快充充电器',69],['编织数据线',29],['蓝牙耳机',199],['20000mAh充电宝',129],['车载手机支架',49],['高清钢化膜',19]],
  2000017: [['轻薄笔记本',4999],['27寸显示器',1299],['机械键盘',399],['无线鼠标',99],['激光打印机',799],['千兆路由器',299],['64G U盘',49],['人体工学办公椅',899]],
  2000018: [['智能蓝牙音箱',299],['头戴降噪耳机',599],['电容麦克风',899],['智能投影仪',1999],['网络机顶盒',199],['无线游戏手柄',259]],
  2000019: [['对开门冰箱',2999],['滚筒洗衣机',2499],['变频空调',2699],['55寸智能电视',2199],['电热水器',899],['侧吸油烟机',1599]],
  2000020: [['智能电饭煲',299],['微波炉',399],['电热水壶',99],['负离子吹风机',129],['空气净化器',999],['扫地机器人',1999],['超声波加湿器',159],['落地电风扇',229]],
  2000022: [['每日坚果礼盒',89],['曲奇饼干',39],['原味薯片',19],['黑巧克力',49],['软糖礼包',29],['海苔脆片',25]],
  2000023: [['精酿啤酒',59],['酱香白酒',399],['干红葡萄酒',159],['鲜榨果汁',29],['天然矿泉水',19],['挂耳咖啡',69]],
  2000024: [['红富士苹果',39],['香蕉',25],['赣南脐橙',49],['有机草莓',59],['智利车厘子',129],['巨峰葡萄',45],['海南蜜瓜',69],['妃子笑荔枝',79]],
  2000025: [['五常大米',99],['高筋面粉',39],['花生油',109],['生抽酱油',25],['陈醋',19],['海盐',15]],
  2000026: [['复合维生素片',129],['乳清蛋白粉',299],['深海鱼油',159],['碳酸钙片',89],['益生菌粉',199],['土蜂蜜',109]],
  2000028: [['婴儿纸尿裤',129],['婴儿配方奶粉',399],['婴儿湿巾',49],['防胀气奶瓶',89],['折叠婴儿车',999],['儿童软毛牙刷',29]],
  2000029: [['儿童印花T恤',59],['儿童运动裤',89],['儿童休闲鞋',129],['儿童羽绒外套',259],['校服套装',159],['儿童纯棉袜',29]],
  2000030: [['大颗粒积木',199],['立体拼图',79],['遥控越野车',299],['毛绒玩偶',69],['国际象棋',59],['磁性画板',49]],
  2000031: [['孕妇连衣裙',159],['多功能孕妇枕',199],['双边吸奶器',399],['产妇待产包',129],['妊娠纹霜',169],['家用胎心仪',299]],
  2000033: [['速干运动T恤',69],['防滑瑜伽垫',79],['可调节哑铃',129],['家用跑步机',1599],['竞速跳绳',39],['弹力运动裤',99]],
  2000034: [['防风帐篷',299],['加厚睡袋',159],['登山杖',89],['折叠露营椅',79],['户外头灯',69],['户外保温壶',99]],
  2000035: [['行车记录仪',399],['四季通用座椅套',299],['车载净化器',199],['浓缩洗车液',39],['固体车蜡',89],['全包围汽车脚垫',169]],
  2000036: [['骑行头盔',199],['专业骑行服',299],['骑行手套',79],['LED车灯',59],['骑行水壶架',39],['便携打气筒',49]],
};

// 真实品牌轮换：新商品按序分配品牌，其余留 brand_id=0（未分类）
const BRAND_IDS = [1046005,1046006,1046007,1046008,1046009,1046010,1046011,1046012,1046013,1046014,1046015,1046016];

const STATUS = [101, 201, 301, 401, 401, 401, 401, 402];
const CONSIGNEES = ['张伟','王芳','李娜','刘洋','陈静','杨帆','赵敏','黄磊','周杰','吴倩','徐强','孙丽','马超','朱婷','胡军','郭涛','林峰','何薇','高翔','罗浩','郑爽','冯军','蒋欣','韩雪','秦岚','顾明','边际','沈梦','周全','欧阳峰'];
const ADDRESSES = ['北京市朝阳区建国路88号','上海市浦东新区张江高科技园','广州市天河区珠江新城','深圳市南山区科技园','杭州市西湖区文三路','成都市高新区天府三街','南京市鼓楼区中山路','武汉市洪山区光谷大道','西安市雁塔区高新路','重庆市渝北区金开大道','苏州市工业园区星湖街','长沙市岳麓区梅溪湖','天津市和平区南京路','青岛市市南区香港中路','郑州市金水区花园路'];

let seq = 1;
function rand(mn, mx) { return mn + Math.floor(Math.random() * (mx - mn + 1)); }
function pad(n, w) { return String(n).padStart(w, '0'); }

(async () => {
  const c = await mysql.createConnection({ host: '127.0.0.1', port: 3306, user: 'yiming', password: 'Aa111111', database: 'litemall', multipleStatements: true });

  // ===== 1) 插入更多商品 =====
  const [maxR] = await c.query('SELECT MAX(id) m FROM litemall_goods');
  let nextId = maxR[0].m + 1;
  const catalog = Object.entries(CATALOG); // [catId, items[]]
  const goodsList = []; // {id, name, price}
  let brandIdx = 0;

  for (const [catId, items] of catalog) {
    // 每个分类内错开分配品牌，约 2/3 有品牌
    for (const [name, price] of items) {
      let brandId = 0;
      if (brandIdx % 3 !== 2) brandId = BRAND_IDS[brandIdx % BRAND_IDS.length];
      brandIdx++;
      const sn = 'G2_' + nextId;
      const t = new Date(2025, 2, rand(1, 28), rand(9, 20), rand(0, 59), 0);
      await c.query(
        `INSERT INTO litemall_goods
         (id, goods_sn, name, category_id, brand_id, gallery, keywords, brief, is_on_sale, sort_order,
          pic_url, share_url, is_new, is_hot, unit, counter_price, retail_price, detail, add_time, update_time, deleted)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [nextId, sn, name, Number(catId), brandId, `["https://dummyimage.com/200x200/1A1A1A/fff&text=${encodeURIComponent(name)}"]`,
         '', '品质好物，值得拥有', 1, 100,
         `https://dummyimage.com/200x200/1A1A1A/fff&text=${encodeURIComponent(name)}`, '',
         rand(0,1), rand(0,1), '件', Math.round(price * 1.2), price, `<p>${name}，精选优质材料，工艺精湛。</p>`, t, t, 0]
      );
      goodsList.push({ id: nextId, name, price });
      nextId++;
    }
  }

  // ===== 2) 插入更多订单 =====
  const goodIds = goodsList.map(g => g.id);
  const goodMap = new Map(goodsList.map(g => [g.id, g]));
  const startMonth = new Date(2025, 7, 1); // 2025-08
  const now = new Date();
  // 每月 60~120 单，促销月更高
  for (let m = 0; m < 12; m++) {
    const monthBase = new Date(startMonth.getFullYear(), startMonth.getMonth() + m, 1);
    const seasonBoost = (m === 0 || m === 10) ? 50 : ((m === 11) ? 30 : 0);
    const ordersThisMonth = rand(60, 120) + seasonBoost;
    for (let o = 0; o < ordersThisMonth; o++) {
      const day = rand(1, 28);
      const addTime = new Date(monthBase.getFullYear(), monthBase.getMonth(), day, rand(9, 21), rand(0, 59), rand(0, 59));
      if (addTime > now) continue;

      const status = STATUS[rand(0, STATUS.length - 1)];
      let payTime = null, shipTime = null, confirmTime = null, endTime = null;
      if (status >= 201) payTime = new Date(addTime.getTime() + rand(5, 120) * 60000);
      if (status >= 301) shipTime = new Date(payTime.getTime() + rand(1, 3) * 86400000);
      if (status >= 401) { confirmTime = new Date(shipTime.getTime() + rand(3, 7) * 86400000); endTime = confirmTime; }

      const orderSn = '2026' + addTime.getFullYear() + pad(addTime.getMonth() + 1, 2) + pad(addTime.getDate(), 2) + pad(seq++, 6);
      const consignee = CONSIGNEES[rand(0, CONSIGNEES.length - 1)];
      const address = ADDRESSES[rand(0, ADDRESSES.length - 1)];
      const mobile = '13' + rand(100000000, 999999999);

      const nItems = rand(1, 4);
      let goodsPrice = 0;
      const items = [];
      for (let i = 0; i < nItems; i++) {
        const g = goodMap.get(goodIds[rand(0, goodIds.length - 1)]);
        const price = g.price;
        const num = rand(1, 3);
        goodsPrice += price * num;
        items.push({ gid: g.id, name: g.name, num, price });
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
        [rand(1, 20), orderSn, status, 0, consignee, mobile, address, '',
         goodsPrice, freight, coupon, 0, 0, orderPrice, actualPrice,
         status >= 201 ? 'wx' + Math.random().toString(36).slice(2, 12) : null, payTime,
         status >= 301 ? 'SF' + Math.random().toString(36).slice(2, 12).toUpperCase() : null, '顺丰速运', shipTime,
         confirmTime, 0, endTime, addTime, addTime]
      );
      const orderId = ir.insertId;

      for (const it of items) {
        await c.query(
          `INSERT INTO litemall_order_goods (order_id, goods_id, goods_name, goods_sn, product_id, number, price, specifications, pic_url, comment, add_time, update_time)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          [orderId, it.gid, it.name, 'G' + it.gid, it.gid, it.num, it.price, '[]', '', 0, addTime, addTime]
        );
      }
    }
  }

  const [g] = await c.query('SELECT COUNT(*) c FROM litemall_goods');
  const [o] = await c.query('SELECT COUNT(*) c FROM litemall_order');
  const [og] = await c.query('SELECT COUNT(*) c FROM litemall_order_goods');
  const [cat] = await c.query('SELECT category_id, COUNT(*) c FROM litemall_goods GROUP BY category_id ORDER BY c DESC');
  console.log(`\n=== 完成 ===\ngoods=${g[0].c}, order=${o[0].c}, order_goods=${og[0].c}`);
  console.log('分类商品数分布:', cat.map(x => `${x.category_id}:${x.c}`).join(' '));
  await c.end();
})().catch(e => { console.error('ERR', e); process.exit(1); });