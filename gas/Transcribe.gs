/**
 * 文字起こしの取得（Notta 連携版）。
 *
 * ⚠️ Notta は「コードから直接叩ける公開API」を提供していません（自動連携は Zapier 経由）。
 *    そのため GAS から Notta を直接呼ぶことはせず、
 *    Notta(+Zapier) が作成した文字起こしテキストを「受け取る」方式にしています。
 *
 * 対応している受け取り方（上から順に判定）:
 *   1. E列（文字起こし）に既にテキストがある        … Notta×Zapierでシートへ直接書き込む運用
 *   2. ファイル参照(C列)が .txt / .vtt / .srt のファイル … Notta×ZapierでDriveに保存する運用
 *
 * @return {string} 文字起こしテキスト
 */
function resolveTranscript_(sheet, row, source, fileRef) {
  // 1. すでに E列 に文字起こしがあればそれを使う
  const existing = (getCell_(sheet, row, CONFIG.COL.TRANSCRIPT) || '').toString().trim();
  if (existing) return existing;

  // 2. ファイル参照がテキスト系ファイルなら読み込む
  if (fileRef && /\.(txt|vtt|srt)$/i.test(fileRef)) {
    const blob = fetchFileBlob_(source, fileRef);
    const text = blob.getDataAsString('UTF-8').trim();
    if (text) return stripCaptionTimestamps_(text);
  }

  throw new Error(
    '文字起こしが見つかりません。Notta(+Zapier)でリールを文字起こしし、' +
    'その結果を E列 に入れるか、Driveの .txt ファイルを C列 に指定してください。'
  );
}

/**
 * VTT/SRT形式のときにタイムスタンプ・番号行を除去して本文だけにする。
 * （プレーンテキストはそのまま返る）
 */
function stripCaptionTimestamps_(text) {
  return text
    .split(/\r?\n/)
    .filter(function (line) {
      var l = line.trim();
      if (l === '' || l === 'WEBVTT') return false;
      if (/^\d+$/.test(l)) return false;                       // SRTの連番
      if (/\d{2}:\d{2}:\d{2}[.,]\d{3}\s*-->/.test(l)) return false; // タイムコード
      return true;
    })
    .join('\n')
    .trim();
}
