const labels = {
  received: '收到',
  like: '赞',
  thanks: '谢谢',
  cheer: '加油',
  thinking: '让我想想',
  laugh: '哈哈哈',
  wow: '太厉害了',
  celebrate: '撒花',
  agree: '同意',
  coffee: '辛苦了',
  question: '求指教',
  done: '搞定',
};

const stickers = Object.entries(labels).map(([id, label]) => ({
  id,
  label,
  src: `/assets/stickers/${id}.svg`,
}));

function commentBody(text, picked) {
  if (!picked.length) return text;
  const images = picked.map(({ id, label }) => `![${label}](/stickers/${id}.svg)`).join('\n');
  return [text.trim(), images].filter(Boolean).join('\n\n');
}

module.exports = { stickers, commentBody };
