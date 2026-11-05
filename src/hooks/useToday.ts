import { useEffect, useState } from 'react';

/**
 * 「今天的日期」——每分钟对一次表，回到前台时立刻对一次。
 * 月视图靠它定位当月、标今天、算第几周；跨过零点不用手动刷新。
 */
export function useToday(): Date {
  const [today, setToday] = useState(() => new Date());

  useEffect(() => {
    const tick = () => setToday(new Date());
    const id = window.setInterval(tick, 60_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', tick);
    };
  }, []);

  return today;
}
