/**
 * 校内服务入口（不是新闻，是「现在就要用」的跳板）
 *
 * 三个链接都指向学校对外公开的门户首页，没有编造的深层地址：
 * 具体的挂号 / 预约功能在门户里面的入口里，deep link 随学校改版会失效，
 * 所以只保证「点开能落到正确的系统上」。
 *
 * 演示时可以说明：这些是入口，不是爬下来的业务数据 —— 医疗和借阅都涉及
 * 个人账号，小山不碰账号，只把你送过去。
 */
export type ServiceKind = 'hospital' | 'library' | 'logistics';

export interface ServiceEntry {
  id: string;
  kind: ServiceKind;
  name: string;
  desc: string;
  action: string;
  url: string;
}

export const SERVICE_ENTRIES: ServiceEntry[] = [
  {
    id: 'svc-hospital',
    kind: 'hospital',
    name: '校医院',
    desc: '预约挂号 · 门诊时间 · 体检报告',
    action: '去预约',
    url: 'https://hospital.ccnu.edu.cn/',
  },
  {
    id: 'svc-library',
    kind: 'library',
    name: '图书馆',
    desc: '座位预约 · 借阅查询 · 续借',
    action: '去预约',
    url: 'https://lib.ccnu.edu.cn/',
  },
  {
    id: 'svc-logistics',
    kind: 'logistics',
    name: '后勤报修',
    desc: '水电报修 67861703 · 宿管物业 67868249',
    action: '服务指南',
    url: 'https://houqin.ccnu.edu.cn/fwzn/stfw.htm',
  },
];
