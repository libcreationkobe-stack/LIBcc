/**
 * メイン処理。
 * 「投稿管理」シートの未処理行を走査し、種別ごとに下書きを作成します。
 */

/** 未処理（ステータスが空 or 「未処理」）の行をすべて処理する。 */
function processPendingRows() {
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  let processed = 0;
  let errors = 0;

  for (let row = 2; row <= lastRow; row++) {
    const status = getCell_(sheet, row, CONFIG.COL.STATUS);
    if (status && status !== CONFIG.STATUS.TODO) continue; // 既に処理済みはスキップ
    if (isRowEmpty_(sheet, row)) continue;

    try {
      processRow(row);
      processed++;
    } catch (e) {
      errors++;
      setCell_(sheet, row, CONFIG.COL.STATUS, CONFIG.STATUS.ERROR);
      setCell_(sheet, row, CONFIG.COL.DRAFT, 'エラー: ' + e.message);
      stampUpdatedAt_(sheet, row);
      console.error('行 ' + row + ' でエラー: ' + e.stack);
    }
  }
  return { processed: processed, errors: errors };
}

/** 1行を処理する。 */
function processRow(row) {
  const sheet = getSheet_();
  const type = (getCell_(sheet, row, CONFIG.COL.TYPE) || '').trim();
  const source = (getCell_(sheet, row, CONFIG.COL.SOURCE) || '').trim().toLowerCase();
  const fileRef = (getCell_(sheet, row, CONFIG.COL.FILE_REF) || '').trim();
  const note = (getCell_(sheet, row, CONFIG.COL.NOTE) || '').trim();

  let draft;

  if (type === '動画') {
    // パターンA: リール動画 → (Notta×Zapierの)文字起こしを受け取る → 要約
    const transcript = resolveTranscript_(sheet, row, source, fileRef);
    setCell_(sheet, row, CONFIG.COL.TRANSCRIPT, transcript);
    draft = generatePostFromTranscript(transcript, note);

  } else if (type === '写真') {
    // パターンB: 写真 + メモ → 投稿文
    if (fileRef) {
      const blob = fetchFileBlob_(source, fileRef);
      moveToReadyFolder_(blob, 'row' + row + '_' + (blob.getName() || 'photo'));
    }
    draft = generatePostFromNote(note);

  } else {
    throw new Error('種別（A列）は "動画" または "写真" にしてください。現在: "' + type + '"');
  }

  setCell_(sheet, row, CONFIG.COL.DRAFT, draft);
  setCell_(sheet, row, CONFIG.COL.STATUS, CONFIG.STATUS.DONE_DRAFT);
  stampUpdatedAt_(sheet, row);
}
