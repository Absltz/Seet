const BATCH_CHARACTERS = 24000, MAX_BATCHES = 12;

// Every accepted message is read in full. Refuse an oversized report before
// model calls rather than silently sampling away earlier or middle concerns.
export function questionBatches(questions) {
  const messages = questions.map((text, index) => ({ id: `u${index + 1}`, text }));
  const batches = [];
  let batch = [], length = 0;
  for (const message of messages) {
    if (batch.length && length + message.text.length > BATCH_CHARACTERS) {
      batches.push(batch); batch = []; length = 0;
    }
    batch.push(message); length += message.text.length;
  }
  if (batch.length) batches.push(batch);
  if (batches.length > MAX_BATCHES || messages.length > 2000)
    throw Object.assign(new Error('此份数据的用户消息过长，超出一次报告可完整归纳的范围。请按分析主题拆分后生成；全部历史与数据已保留，本次未省略消息生成报告。'), { code: 'history_too_long' });
  const characters = questions.reduce((sum, text) => sum + text.length, 0);
  return { batches, coverage: {
    totalMessages: messages.length, processedMessages: messages.length,
    totalCharacters: characters, processedCharacters: characters, truncated: false,
    note: `已归纳此份数据下全部 ${messages.length} 条用户输入；导入提示和闲聊由 AI 辨别，相关关注点合并分析。`,
  } };
}
