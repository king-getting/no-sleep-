const THEME_KEY = 'xiaoshan:theme';

export type ThemeChoice = 'system' | 'light' | 'dark';

/**
 * 暗色模式（dev-tasks B9）
 * index.css 里已经用 `.dark` 定义了整套变量（shadcn 默认），这里只负责在 <html> 上挂 class。
 * 默认跟随系统；设置页可显式覆盖。
 */

export function getThemeChoice(): ThemeChoice {
  const v = localStorage.getItem(THEME_KEY);
  return v === 'light' || v === 'dark' ? v : 'system';
}

function effective(choice: ThemeChoice): 'light' | 'dark' {
  if (choice !== 'system') return choice;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(choice: ThemeChoice = getThemeChoice()): void {
  const root = document.documentElement;
  root.classList.toggle('dark', effective(choice) === 'dark');
  root.style.colorScheme = effective(choice);
}

export function setTheme(choice: ThemeChoice): void {
  localStorage.setItem(THEME_KEY, choice);
  applyTheme(choice);
}

/** 在 main.tsx 启动时调用一次：挂上级联，之后系统切主题会自动跟随 */
export function initTheme(): void {
  applyTheme();
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => {
    if (getThemeChoice() === 'system') applyTheme('system');
  };
  // Safari < 14 用 addListener，现代浏览器走 addEventListener
  if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange);
  else mq.addListener(onChange);
}
