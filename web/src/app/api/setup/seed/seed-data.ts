/**
 * seed-data.ts — 种子数据定义：部门、员工、活跃度权重
 */

// 管理员 feishu_id
export const ADMIN_IDS = [
  "ou_f2e284bb6701647e664c938806b08627", // 何广明
  "ou_0d5004133227007a479e05d54d5c4b50", // 陈四华
];

// 部门成员类型
export interface DeptMember {
  name: string;
  fid: string;
  quota?: number;
}

// 部门数据类型
export interface DeptData {
  dept: string;
  deptId: string;
  members: DeptMember[];
}

// 部门定义 + 全员名单（153人，使用清理后的部门名）
export const DEPT_DATA: DeptData[] = [
  // ── 运营部（40人，最大部门） ──
  { dept: "运营部", deptId: "dept_yunying", members: [
    { name: "宋佳", fid: "ou_a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6", quota: 280 },
    { name: "陆凤丹", fid: "ou_b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7", quota: 250 },
    { name: "张锐", fid: "ou_c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8", quota: 220 },
    { name: "陈焕杰", fid: "ou_d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9", quota: 200 },
    { name: "赖洁妮", fid: "ou_e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0", quota: 200 },
    { name: "叶颖琪", fid: "ou_f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1", quota: 180 },
    { name: "杨慧", fid: "ou_1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c00", quota: 260 },
    { name: "谢佳敏", fid: "ou_2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d00", quota: 230 },
    { name: "房伟", fid: "ou_3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e00", quota: 200 },
    { name: "刘婷", fid: "ou_yy01", quota: 200 },
    { name: "黄丽华", fid: "ou_yy02", quota: 180 },
    { name: "周明", fid: "ou_yy03", quota: 190 },
    { name: "吴丽萍", fid: "ou_yy04", quota: 170 },
    { name: "李健", fid: "ou_yy05", quota: 210 },
    { name: "赵小芳", fid: "ou_yy06", quota: 160 },
    { name: "陈丽娟", fid: "ou_yy07", quota: 180 },
    { name: "杨秀英", fid: "ou_yy08", quota: 170 },
    { name: "黄敏", fid: "ou_yy09", quota: 190 },
    { name: "周丽", fid: "ou_yy10", quota: 160 },
    { name: "吴静", fid: "ou_yy11", quota: 180 },
    { name: "徐丹", fid: "ou_yy12", quota: 170 },
    { name: "孙明华", fid: "ou_yy13", quota: 200 },
    { name: "胡小红", fid: "ou_yy14", quota: 160 },
    { name: "朱丽丽", fid: "ou_yy15", quota: 170 },
    { name: "高志强", fid: "ou_yy16", quota: 190 },
    { name: "林淑珍", fid: "ou_yy17", quota: 160 },
    { name: "何美玲", fid: "ou_yy18", quota: 180 },
    { name: "郭志伟", fid: "ou_yy19", quota: 200 },
    { name: "马秀兰", fid: "ou_yy20", quota: 150 },
    { name: "罗建", fid: "ou_yy21", quota: 180 },
    { name: "梁小红", fid: "ou_yy22", quota: 160 },
    { name: "宋丽华", fid: "ou_yy23", quota: 170 },
    { name: "郑小明", fid: "ou_yy24", quota: 190 },
    { name: "谢小红", fid: "ou_yy25", quota: 160 },
    { name: "韩志强", fid: "ou_yy26", quota: 180 },
    { name: "唐敏", fid: "ou_yy27", quota: 170 },
    { name: "冯丽萍", fid: "ou_yy28", quota: 160 },
    { name: "于建明", fid: "ou_yy29", quota: 190 },
    { name: "董小红", fid: "ou_yy30", quota: 170 },
    { name: "程志伟", fid: "ou_yy31", quota: 200 },
    { name: "曹丽华", fid: "ou_yy32", quota: 170 },
    { name: "袁志明", fid: "ou_yy33", quota: 190 },
    { name: "邓小芳", fid: "ou_yy34", quota: 160 },
    { name: "许建平", fid: "ou_yy35", quota: 180 },
    { name: "傅小红", fid: "ou_yy36", quota: 170 },
  ]},
  // ── 经管部（12人） ──
  { dept: "经管部", deptId: "dept_jingguan", members: [
    { name: "雷佳", fid: "ou_69c6464bcbd2fec0b33bd256ba4a12fd", quota: 400 },
    { name: "冷金平", fid: "ou_60fe25e8da2f2926c4e690b47eeb30e5", quota: 350 },
    { name: "王宇翔", fid: "ou_14927a9e97b91943ca28195ca1a443d9", quota: 300 },
    { name: "欧阳克训", fid: "ou_efb1bf6de13b4096cd435f4fe12afff9", quota: 250 },
    { name: "钟冬生", fid: "ou_cab74bb294430fb197ffbc80dc9e9244", quota: 200 },
    { name: "曾倩文", fid: "ou_32fd271c8c892a8aa865a1814c8fec99", quota: 200 },
    { name: "何广明", fid: "ou_f2e284bb6701647e664c938806b08627", quota: 500 },
    { name: "李慧文", fid: "ou_6985f7e10a3938661986ace2d0d38cb0", quota: 250 },
    { name: "张郁泉", fid: "ou_4fe4377b0f144d1e2217e50d83659894", quota: 200 },
    { name: "刘小明", fid: "ou_jg01", quota: 180 },
    { name: "陈志华", fid: "ou_jg02", quota: 200 },
    { name: "赵美玲", fid: "ou_jg03", quota: 170 },
  ]},
  // ── IT部（15人） ──
  { dept: "IT部", deptId: "dept_it", members: [
    { name: "王洪领", fid: "ou_17ac12117a2a8c6c7532b32bbc603026", quota: 350 },
    { name: "刘虹", fid: "ou_1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d", quota: 300 },
    { name: "吴文德", fid: "ou_2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e", quota: 280 },
    { name: "郭建武", fid: "ou_3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f", quota: 250 },
    { name: "黄坤涛", fid: "ou_4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a", quota: 220 },
    { name: "谢良璋", fid: "ou_5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b", quota: 200 },
    { name: "陈涛", fid: "ou_6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c", quota: 200 },
    { name: "王世鑫", fid: "ou_7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d", quota: 180 },
    { name: "刘威", fid: "ou_8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e", quota: 180 },
    { name: "陈四华", fid: "ou_0d5004133227007a479e05d54d5c4b50", quota: 400 },
    { name: "周建华", fid: "ou_it01", quota: 250 },
    { name: "李志强", fid: "ou_it02", quota: 220 },
    { name: "张伟明", fid: "ou_it03", quota: 200 },
    { name: "黄小龙", fid: "ou_it04", quota: 180 },
    { name: "吴建平", fid: "ou_it05", quota: 190 },
  ]},
  // ── 产品部（18人） ──
  { dept: "产品部", deptId: "dept_product", members: [
    { name: "郑卓晟", fid: "ou_6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f00", quota: 250 },
    { name: "晏佳豪", fid: "ou_7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a00", quota: 230 },
    { name: "王建国", fid: "ou_cp01", quota: 240 },
    { name: "李志明", fid: "ou_cp02", quota: 220 },
    { name: "张小红", fid: "ou_cp03", quota: 200 },
    { name: "刘美玲", fid: "ou_cp04", quota: 190 },
    { name: "陈志伟", fid: "ou_cp05", quota: 210 },
    { name: "杨建华", fid: "ou_cp06", quota: 200 },
    { name: "赵丽华", fid: "ou_cp07", quota: 180 },
    { name: "黄小明", fid: "ou_cp08", quota: 190 },
    { name: "周志强", fid: "ou_cp09", quota: 220 },
    { name: "吴丽娟", fid: "ou_cp10", quota: 170 },
    { name: "徐建明", fid: "ou_cp11", quota: 200 },
    { name: "孙小红", fid: "ou_cp12", quota: 180 },
    { name: "胡志华", fid: "ou_cp13", quota: 190 },
    { name: "朱美英", fid: "ou_cp14", quota: 170 },
    { name: "高建军", fid: "ou_cp15", quota: 210 },
    { name: "林志明", fid: "ou_cp16", quota: 200 },
  ]},
  // ── 仓储物流部（12人） ──
  { dept: "仓储物流部", deptId: "dept_cangchu", members: [
    { name: "周立军", fid: "ou_4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d00", quota: 200 },
    { name: "胡露", fid: "ou_5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e00", quota: 180 },
    { name: "王大明", fid: "ou_cc01", quota: 180 },
    { name: "李秀英", fid: "ou_cc02", quota: 160 },
    { name: "张志华", fid: "ou_cc03", quota: 170 },
    { name: "刘建军", fid: "ou_cc04", quota: 190 },
    { name: "陈小红", fid: "ou_cc05", quota: 160 },
    { name: "杨志明", fid: "ou_cc06", quota: 180 },
    { name: "赵建平", fid: "ou_cc07", quota: 170 },
    { name: "黄丽华", fid: "ou_cc08", quota: 150 },
    { name: "周美玲", fid: "ou_cc09", quota: 160 },
    { name: "吴志强", fid: "ou_cc10", quota: 180 },
  ]},
  // ── 设计部（6人） ──
  { dept: "设计部", deptId: "dept_sheji", members: [
    { name: "沈家豪", fid: "ou_4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f00", quota: 240 },
    { name: "陈阳波", fid: "ou_5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a00", quota: 220 },
    { name: "徐曼桂", fid: "ou_6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b00", quota: 200 },
    { name: "刘小丽", fid: "ou_sj01", quota: 180 },
    { name: "黄志明", fid: "ou_sj02", quota: 190 },
    { name: "张美华", fid: "ou_sj03", quota: 170 },
  ]},
  // ── 品质部（8人） ──
  { dept: "品质部", deptId: "dept_pinzhi", members: [
    { name: "曾雪丽", fid: "ou_9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e00", quota: 200 },
    { name: "冷翔宇", fid: "ou_0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f00", quota: 180 },
    { name: "王建军", fid: "ou_pz01", quota: 190 },
    { name: "李秀兰", fid: "ou_pz02", quota: 170 },
    { name: "张志伟", fid: "ou_pz03", quota: 180 },
    { name: "刘美华", fid: "ou_pz04", quota: 160 },
    { name: "陈建华", fid: "ou_pz05", quota: 190 },
    { name: "杨小芳", fid: "ou_pz06", quota: 170 },
  ]},
  // ── 品牌营销部（7人） ──
  { dept: "品牌营销部", deptId: "dept_pinpai", members: [
    { name: "胡茜", fid: "ou_7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c00", quota: 260 },
    { name: "曾惠月", fid: "ou_8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d00", quota: 220 },
    { name: "赵志明", fid: "ou_pp01", quota: 200 },
    { name: "黄丽娟", fid: "ou_pp02", quota: 180 },
    { name: "周小华", fid: "ou_pp03", quota: 190 },
    { name: "吴美玲", fid: "ou_pp04", quota: 170 },
    { name: "刘建明", fid: "ou_pp05", quota: 200 },
  ]},
  // ── 财务部（6人） ──
  { dept: "财务部", deptId: "dept_caiwu", members: [
    { name: "尹璐洁", fid: "ou_1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a00", quota: 200 },
    { name: "左小美", fid: "ou_2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b00", quota: 180 },
    { name: "王秀英", fid: "ou_cw01", quota: 170 },
    { name: "李美华", fid: "ou_cw02", quota: 160 },
    { name: "张丽萍", fid: "ou_cw03", quota: 170 },
    { name: "陈小红", fid: "ou_cw04", quota: 160 },
  ]},
  // ── 人力行政部（5人） ──
  { dept: "人力行政部", deptId: "dept_hr", members: [
    { name: "张颖", fid: "ou_3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c00", quota: 200 },
    { name: "刘建华", fid: "ou_hr01", quota: 180 },
    { name: "陈美玲", fid: "ou_hr02", quota: 170 },
    { name: "杨志华", fid: "ou_hr03", quota: 160 },
    { name: "赵小丽", fid: "ou_hr04", quota: 170 },
  ]},
  // ── 采购跟单部（8人） ──
  { dept: "采购跟单部", deptId: "dept_caigougd", members: [
    { name: "蒙朝侣", fid: "ou_8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b00", quota: 180 },
    { name: "王志明", fid: "ou_cg01", quota: 190 },
    { name: "李小红", fid: "ou_cg02", quota: 170 },
    { name: "张建军", fid: "ou_cg03", quota: 180 },
    { name: "刘美华", fid: "ou_cg04", quota: 160 },
    { name: "陈建华", fid: "ou_cg05", quota: 180 },
    { name: "杨秀兰", fid: "ou_cg06", quota: 170 },
    { name: "黄小明", fid: "ou_cg07", quota: 190 },
  ]},
  // ── 采购寻源部（6人） ──
  { dept: "采购寻源部", deptId: "dept_caigouxy", members: [
    { name: "周志强", fid: "ou_xy01", quota: 200 },
    { name: "吴丽华", fid: "ou_xy02", quota: 180 },
    { name: "徐建明", fid: "ou_xy03", quota: 190 },
    { name: "孙小红", fid: "ou_xy04", quota: 170 },
    { name: "胡志伟", fid: "ou_xy05", quota: 180 },
    { name: "朱美玲", fid: "ou_xy06", quota: 160 },
  ]},
  // ── 计划部（5人） ──
  { dept: "计划部", deptId: "dept_jihua", members: [
    { name: "高志明", fid: "ou_jh01", quota: 200 },
    { name: "林秀华", fid: "ou_jh02", quota: 180 },
    { name: "何建军", fid: "ou_jh03", quota: 190 },
    { name: "郭小红", fid: "ou_jh04", quota: 170 },
    { name: "马美英", fid: "ou_jh05", quota: 160 },
  ]},
];

// 不同部门活跃度权重
export const DEPT_ACTIVITY: Record<string, number> = {
  "IT部": 2.0, "产品部": 1.6, "运营部": 1.4, "经管部": 1.0,
  "设计部": 1.0, "品牌营销部": 1.1, "品质部": 0.6, "财务部": 0.5,
  "人力行政部": 0.4, "仓储物流部": 0.5, "采购跟单部": 0.6,
  "采购寻源部": 0.5, "计划部": 0.4,
};
