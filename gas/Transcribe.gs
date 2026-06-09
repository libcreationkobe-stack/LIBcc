/**
 * 音声認識（文字起こし）。
 *
 * ⚠️ Claude などのテキスト生成AIは「音声・動画から文字起こし」はできません。
 *    ここは音声認識（Speech-to-Text）専用のサービスを呼び出します。
 *    既定では OpenAI Whisper API を使う実装にしています（差し替え可）。
 *    別サービス（Google Cloud Speech-to-Text 等）を使う場合はこの関数を書き換えてください。
 *
 * スクリプトプロパティ TRANSCRIBE_API_KEY に Whisper(OpenAI) のAPIキーを設定。
 *
 * 注意: Whisper API はファイル25MBまで。長尺・大容量のリールは事前に圧縮するか、
 *       音声だけ抜き出して渡す運用を推奨します（GAS単体では音声抽出はできません）。
 *
 * @param {Blob} mediaBlob 動画または音声の Blob
 * @return {string} 文字起こしテキスト
 */
function transcribeAudio(mediaBlob) {
  const apiKey = getProp_('TRANSCRIBE_API_KEY');

  const res = UrlFetchApp.fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'post',
    headers: { 'Authorization': 'Bearer ' + apiKey },
    payload: {
      file: mediaBlob,
      model: 'whisper-1',
      language: 'ja',
      response_format: 'text'
    },
    muteHttpExceptions: true
  });

  const code = res.getResponseCode();
  const body = res.getContentText();
  if (code !== 200) {
    throw new Error('文字起こし失敗 (HTTP ' + code + '): ' + body);
  }
  return body.trim();
}
