/**
 * Claude (Anthropic) API 呼び出し。Googleビジネスプロフィールの投稿文を生成します。
 * スクリプトプロパティ ANTHROPIC_API_KEY にAPIキーを設定してください。
 *
 * GAS には公式 Anthropic SDK が無いため UrlFetchApp で REST を直接呼び出します。
 */

/** リール動画の文字起こしから GBP 投稿文を作る（パターンA）。 */
function generatePostFromTranscript(transcript, note) {
  const userText =
    'これはお店のリール動画の文字起こしです。Googleビジネスプロフィールの「最新情報」投稿文に' +
    'まとめてください。\n\n【文字起こし】\n' + transcript +
    (note ? '\n\n【補足メモ】\n' + note : '');
  return callClaude_(userText);
}

/** 写真に添えるメモから GBP 投稿文を作る（パターンB）。 */
function generatePostFromNote(note) {
  if (!note) throw new Error('写真パターンではメモ（D列）に元情報を入力してください。');
  const userText =
    'お店の写真に添えるGoogleビジネスプロフィールの「最新情報」投稿文を作ってください。\n\n' +
    '【伝えたい内容・メモ】\n' + note;
  return callClaude_(userText);
}

/** 共通: Claude Messages API を呼び、本文テキストを返す。 */
function callClaude_(userText) {
  const apiKey = getProp_('ANTHROPIC_API_KEY');

  const system =
    'あなたは店舗のSNS・MEO運用の専門家です。Googleビジネスプロフィールの「最新情報」' +
    '投稿文を、日本語で作成します。要件:\n' +
    '- 全角' + CONFIG.POST_MAX_CHARS + '文字以内。\n' +
    '- 読み手（来店検討中の人）に魅力が伝わる、自然で温かみのある文体。\n' +
    '- 過度な絵文字や誇大表現は避ける。ハッシュタグは付けない。\n' +
    '- 前置きや説明は一切書かず、投稿本文だけを出力する。';

  const payload = {
    model: CONFIG.CLAUDE_MODEL,
    max_tokens: CONFIG.CLAUDE_MAX_TOKENS,
    thinking: { type: 'adaptive' },
    system: system,
    messages: [{ role: 'user', content: userText }]
  };

  const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = res.getResponseCode();
  const body = res.getContentText();
  if (code !== 200) {
    throw new Error('Claude API失敗 (HTTP ' + code + '): ' + body);
  }

  const json = JSON.parse(body);
  // content は複数ブロック（thinking / text）。text ブロックだけ連結する。
  const text = (json.content || [])
    .filter(function (b) { return b.type === 'text'; })
    .map(function (b) { return b.text; })
    .join('')
    .trim();

  if (!text) throw new Error('Claudeの応答に本文が含まれていません: ' + body);
  return text;
}
