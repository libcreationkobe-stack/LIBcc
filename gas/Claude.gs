/**
 * Claude (Anthropic) API 呼び出し。
 *   - Googleビジネスプロフィールの投稿文の生成
 *   - リール等の台本（構成）の生成
 * スクリプトプロパティ ANTHROPIC_API_KEY にAPIキーを設定してください。
 *
 * GAS には公式 Anthropic SDK が無いため UrlFetchApp で REST を直接呼び出します。
 */

/** GBP投稿文用のシステムプロンプト。 */
function gbpSystemPrompt_() {
  return 'あなたは店舗のSNS・MEO運用の専門家です。Googleビジネスプロフィールの「最新情報」' +
    '投稿文を、日本語で作成します。要件:\n' +
    '- 全角' + CONFIG.POST_MAX_CHARS + '文字以内。\n' +
    '- 読み手（来店検討中の人）に魅力が伝わる、自然で温かみのある文体。\n' +
    '- 過度な絵文字や誇大表現は避ける。ハッシュタグは付けない。\n' +
    '- 前置きや説明は一切書かず、投稿本文だけを出力する。';
}

/** リール動画の文字起こしから GBP 投稿文を作る（パターンA）。 */
function generatePostFromTranscript(transcript, note) {
  const userText =
    'これはお店のリール動画の文字起こしです。Googleビジネスプロフィールの「最新情報」投稿文に' +
    'まとめてください。\n\n【文字起こし】\n' + transcript +
    (note ? '\n\n【補足メモ】\n' + note : '');
  return callClaude_(gbpSystemPrompt_(), userText);
}

/** 写真に添えるメモから GBP 投稿文を作る（パターンB）。 */
function generatePostFromNote(note) {
  if (!note) throw new Error('写真パターンではメモ（D列）に元情報を入力してください。');
  const userText =
    'お店の写真に添えるGoogleビジネスプロフィールの「最新情報」投稿文を作ってください。\n\n' +
    '【伝えたい内容・メモ】\n' + note;
  return callClaude_(gbpSystemPrompt_(), userText);
}

/**
 * 台本（ショート動画の構成）を生成し、構造化データ（オブジェクト）で返す。
 * @param {{theme:string, note:string, lengthSec:number, media:string}} input
 */
function generateScenario(input) {
  const lengthSec = input.lengthSec || CONFIG.SCENARIO.DEFAULT_LENGTH_SEC;
  const media = input.media || CONFIG.SCENARIO.DEFAULT_MEDIA;

  const system =
    'あなたは日本の店舗・中小企業のショート動画（' + media + '）の構成作家です。' +
    '視聴維持率と来店・問い合わせにつながる台本を作ります。要件:\n' +
    '- 冒頭2秒で離脱させないフックを必ず作る。\n' +
    '- セリフは実際に声に出して読める自然な話し言葉にする。\n' +
    '- テロップは短く、画面で読み切れる長さにする。\n' +
    '- 誇大表現・医療的な効果の断定・根拠のない数字は書かない。\n' +
    '- 出力は指定のJSONのみ。前置き・説明・コードフェンスは一切付けない。';

  const userText =
    '次の企画で、' + lengthSec + '秒の' + media + '用の台本を作ってください。\n\n' +
    '【企画・テーマ】\n' + input.theme + '\n\n' +
    (input.note ? '【メモ・話したい素材】\n' + input.note + '\n\n' : '') +
    '以下のJSON形式のみで出力してください:\n' +
    '{\n' +
    '  "title_ideas": ["タイトル案を3つ"],\n' +
    '  "hook": "冒頭2秒のセリフ",\n' +
    '  "cuts": [\n' +
    '    {"time":"0:00-0:03","visual":"映像・カットの指示","line":"セリフ","caption":"テロップ"}\n' +
    '  ],\n' +
    '  "closing": "締めのセリフ・CTA",\n' +
    '  "hashtags": ["ハッシュタグを5〜8個（#付き）"],\n' +
    '  "shooting_notes": ["撮影時の注意点を2〜4個"]\n' +
    '}\n' +
    'cuts は合計が約' + lengthSec + '秒になるように区切ってください。';

  const text = callClaude_(system, userText, 4000);
  return parseJsonResponse_(text);
}

/** Claudeの応答テキストからJSONを取り出してパースする。 */
function parseJsonResponse_(text) {
  let t = String(text).trim();
  // 念のためコードフェンスを除去
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  // 前後に説明が付いた場合に備え、最初の { から最後の } までを取る
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1) {
    throw new Error('Claudeの応答からJSONを取り出せませんでした: ' + t.slice(0, 200));
  }
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch (e) {
    throw new Error('ClaudeのJSON応答を解析できませんでした: ' + e.message);
  }
}

/** 共通: Claude Messages API を呼び、本文テキストを返す。 */
function callClaude_(system, userText, maxTokens) {
  const apiKey = getProp_('ANTHROPIC_API_KEY');

  const payload = {
    model: CONFIG.CLAUDE_MODEL,
    max_tokens: maxTokens || CONFIG.CLAUDE_MAX_TOKENS,
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
