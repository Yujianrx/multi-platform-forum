export const HONOR_CATEGORIES = { case: '案例', resource: '资源', answer: '答疑' } as const;
export const HONOR_LEVELS = [
  { name: '共创新人', points: 0 },
  { name: '实践新秀', points: 60 },
  { name: '分享达人', points: 180 },
  { name: '共创骨干', points: 420 },
  { name: '共创先锋', points: 900 },
  { name: '共创领航者', points: 1800 },
];
export function honorLevel(points: number) {
  const index = HONOR_LEVELS.reduce((found, l, i) => (points >= l.points ? i : found), 0);
  const level = HONOR_LEVELS[index],
    next = HONOR_LEVELS[index + 1] || null;
  return {
    ...level,
    number: index + 1,
    total: points,
    next,
    remaining: next ? next.points - points : 0,
    progress: next
      ? Math.max(0, Math.min(100, ((points - level.points) / (next.points - level.points)) * 100))
      : 100,
  };
}
export const WEEK_MS = 7 * 86400000;
export function honorWeek(at: Date | string = new Date()) {
  const date = new Date(new Date(at).getTime() + 8 * 3600000);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}
export function nextHonorWeek(week: string) {
  return new Date(Date.parse(week + 'T00:00:00Z') + WEEK_MS).toISOString().slice(0, 10);
}
export function validWeek(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !isNaN(Date.parse(value)) &&
    honorWeek(value + 'T00:00:00+08:00') === value
  );
}
