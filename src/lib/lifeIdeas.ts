/**
 * 生活小事库
 *
 * 为什么不是「再加几条写死的话」：固定的句子看两天就腻，而且常常和当天对不上。
 * 这里的每条都带触发条件（时间、星期、有没有空档、多久没做了），
 * 命中了才出；文本仍然写成人话，但选择权在条件上。
 *
 * 配了模型时，可以把命中的那一条交给模型改写措辞（见 life.ts），
 * 但「什么时候该提醒洗衣 / 理发」这类判断留在本地，不联网也能用。
 */

export interface LifeIdeaOption {
  title: string;
  note?: string;
  when?: string;
  timeMin: number;
  effort: 1 | 2 | 3;
  pros: string[];
  cons: string[];
  fallback: string;
  short: string;
  long?: string;
}

export interface LifeIdea {
  id: string;
  topic: string;
  /** 建议放在哪个时段 */
  slot: 'morning' | 'noon' | 'evening';
  priority: 1 | 2 | 3;
  options: LifeIdeaOption[];
}

export interface LifeIdeaInput {
  now: Date;
  /** 今天剩余的空档总分钟数（没有就看 0） */
  freeMinutes: number;
  /** 有课没课由调用方算好传进来 */
  hasCoursesToday: boolean;
}

const HOUR = (d: Date) => d.getHours();
const DOW = (d: Date) => (d.getDay() === 0 ? 7 : d.getDay());

/** 按条件挑一条，挑不到返回 null */
export function pickLifeIdea(input: LifeIdeaInput): LifeIdea | null {
  const hour = HOUR(input.now);
  const dow = DOW(input.now);

  // 周日晚上：收拾一下，别把一周拖到周一
  if (dow === 7 && hour >= 18) {
    return {
      id: 'idea-tidy-sunday',
      topic: '周日晚上收拾一下',
      slot: 'evening',
      priority: 3,
      options: [
        {
          title: '花 20 分钟把桌面和衣服收了',
          note: '宿舍 · 放点音乐就干完了',
          when: '睡前',
          timeMin: 20,
          effort: 2,
          pros: ['周一坐下就能开始'],
          cons: ['少刷 20 分钟手机'],
          fallback: '周一早上找东西又要花十分钟',
          short: '明天开局会顺一点',
        },
        {
          title: '只收明天要用的东西',
          note: '书、卡、充电器',
          when: '睡前',
          timeMin: 5,
          effort: 1,
          pros: ['几乎不占时间'],
          cons: ['桌子还是乱的'],
          fallback: '明早出门前手忙脚乱',
          short: '明早出门不慌',
        },
      ],
    };
  }

  // 周末白天且有空：出去转转 / 洗衣服
  if ((dow === 6 || dow === 7) && hour >= 9 && hour <= 17 && input.freeMinutes >= 60) {
    return {
      id: 'idea-weekend-out',
      topic: '周末出去转转',
      slot: 'noon',
      priority: 2,
      options: [
        {
          title: '去街道口或江汉路走走',
          note: '地铁直达 · 两三个小时',
          when: '今天下午',
          timeMin: 150,
          effort: 2,
          pros: ['换换环境，回来更有劲'],
          cons: ['下午的整块时间就没了'],
          fallback: '两天都待在宿舍，周一容易闷',
          short: '情绪会松一点',
        },
        {
          title: '学校附近走一圈，买点水果',
          note: '桂子山 · 半小时',
          when: '今天下午',
          timeMin: 30,
          effort: 1,
          pros: ['花时间少，也算出门'],
          cons: ['走不远'],
          fallback: '今天又是不出门的一天',
          short: '补点水果，动一动',
        },
      ],
    };
  }

  // 工作日晚上有空档：洗衣 / 洗澡这类家务
  if (hour >= 19 && hour <= 22 && input.freeMinutes >= 30) {
    return {
      id: 'idea-laundry',
      topic: '把衣服洗了',
      slot: 'evening',
      priority: 3,
      options: [
        {
          title: '现在去洗，回来正好晾',
          note: '洗衣房 · 40 分钟左右',
          when: '现在',
          timeMin: 40,
          effort: 1,
          pros: ['明早有干净衣服'],
          cons: ['今晚少 40 分钟自由时间'],
          fallback: '拖到周末，一次洗一大桶',
          short: '明早不用翻衣柜',
        },
        {
          title: '只洗明天要穿的那几件',
          note: '手洗 · 10 分钟',
          when: '睡前',
          timeMin: 10,
          effort: 1,
          pros: ['快，不占洗衣机'],
          cons: ['大件还得等周末'],
          fallback: '明早可能没干',
          short: '至少明天有得穿',
        },
      ],
    };
  }

  // 下午有空档且今天有课：别直接回宿舍躺着
  if (hour >= 15 && hour <= 17 && input.hasCoursesToday && input.freeMinutes >= 40) {
    return {
      id: 'idea-walk-back',
      topic: '下课别急着回宿舍',
      slot: 'evening',
      priority: 3,
      options: [
        {
          title: '在操场走两圈再回去',
          note: '20 分钟 · 不带耳机',
          when: '下课后',
          timeMin: 20,
          effort: 1,
          pros: ['坐了一天，走一走人会清醒'],
          cons: ['晚 20 分钟回宿舍'],
          fallback: '回去一躺，晚上大概率不出门',
          short: '晚上状态会好一点',
        },
        {
          title: '直接回去，早点吃饭',
          note: '也不勉强',
          when: '下课后',
          timeMin: 0,
          effort: 1,
          pros: ['省事'],
          cons: ['今天几乎没动'],
          fallback: '明天再补',
          short: '按自己的节奏来',
        },
      ],
    };
  }

  return null;
}
