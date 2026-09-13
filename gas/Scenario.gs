/**
 * 台本（ショート動画の構成）の自動作成。
 *
 * 「台本」シートにテーマとメモを入れて実行すると、
 * Claudeが構成を作り、毎回同じフォーマットのGoogleドキュメントを自動生成します。
 */

/** 「台本」シートを取得（無ければエラー）。 */
function getScenarioSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SCENARIO.SHEET_NAME);
  if (!sheet) {
    throw new Error('シート "' + CONFIG.SCENARIO.SHEET_NAME +
      '" が見つかりません。メニュー［台本］→［シートを準備］を実行してください。');
  }
  return sheet;
}

/** 「台本」シートを見出し付きで用意する（既にあれば何もしない）。 */
function setupScenarioSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.SCENARIO.SHEET_NAME);
  if (sheet) return sheet;

  sheet = ss.insertSheet(CONFIG.SCENARIO.SHEET_NAME);
  const headers = ['企画・テーマ', 'メモ・話したい素材', '尺（秒）', '媒体',
                   'ステータス', 'ドキュメント', '更新日時'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground('#f1f3f4');
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(CONFIG.SCENARIO.COL.THEME, 220);
  sheet.setColumnWidth(CONFIG.SCENARIO.COL.NOTE, 360);

  // 記入例
  sheet.getRange(2, 1, 1, headers.length).setValues([[
    '初めてのお客様が不安に思うことTOP3',
    '「どんな人が来てる？」「時間はどれくらい？」「料金は追加でかかる？」をやさしく解説したい',
    45, 'リール', '', '', ''
  ]]);
  sheet.getRange(2, CONFIG.SCENARIO.COL.NOTE).setWrap(true);
  return sheet;
}

/** 未処理の台本行をまとめて処理する。 */
function processPendingScenarios() {
  const sheet = getScenarioSheet_();
  const c = CONFIG.SCENARIO.COL;
  const lastRow = sheet.getLastRow();
  let processed = 0;
  let errors = 0;

  for (let row = 2; row <= lastRow; row++) {
    const status = getCell_(sheet, row, c.STATUS);
    if (status && status !== CONFIG.STATUS.TODO) continue;
    if (!getCell_(sheet, row, c.THEME)) continue;

    try {
      createScenarioForRow(row);
      processed++;
    } catch (e) {
      errors++;
      setCell_(sheet, row, c.STATUS, CONFIG.STATUS.ERROR);
      setCell_(sheet, row, c.UPDATED_AT, nowStamp_());
      sheet.getRange(row, c.STATUS).setNote('エラー: ' + e.message);
      console.error('台本 行 ' + row + ' でエラー: ' + e.stack);
    }
  }
  return { processed: processed, errors: errors };
}

/** 1行から台本ドキュメントを作成する。 */
function createScenarioForRow(row) {
  const sheet = getScenarioSheet_();
  const c = CONFIG.SCENARIO.COL;

  const theme = String(getCell_(sheet, row, c.THEME) || '').trim();
  if (!theme) throw new Error('企画・テーマ（A列）が空です。');

  const note = String(getCell_(sheet, row, c.NOTE) || '').trim();
  const lengthSec = Number(getCell_(sheet, row, c.LENGTH)) || CONFIG.SCENARIO.DEFAULT_LENGTH_SEC;
  const media = String(getCell_(sheet, row, c.MEDIA) || CONFIG.SCENARIO.DEFAULT_MEDIA).trim();

  const scenario = generateScenario({
    theme: theme, note: note, lengthSec: lengthSec, media: media
  });

  const doc = buildScenarioDoc_(scenario, {
    theme: theme, note: note, lengthSec: lengthSec, media: media
  });

  setCell_(sheet, row, c.STATUS, CONFIG.STATUS.DONE);
  setCell_(sheet, row, c.DOC_URL, doc.url);
  setCell_(sheet, row, c.UPDATED_AT, nowStamp_());
  sheet.getRange(row, c.STATUS).clearNote();

  return doc;
}

/** 生成された構成データから、決まったフォーマットのドキュメントを組み立てる。 */
function buildScenarioDoc_(s, input) {
  const folder = getOrCreateFolder_(CONFIG.SCENARIO.FOLDER_NAME);
  const name = formatDateIso_(new Date()) + '_' + sanitizeFileName_(input.theme);
  const doc = DocumentApp.create(name);
  const body = doc.getBody();
  body.clear();

  // タイトル
  body.appendParagraph(input.theme).setHeading(DocumentApp.ParagraphHeading.TITLE);
  body.appendParagraph(
    '媒体: ' + input.media + '　/　尺: 約' + input.lengthSec + '秒　/　作成日: ' +
    formatDateJa_(new Date())
  );
  body.appendParagraph('');

  // タイトル案
  appendSection_(body, 'タイトル案');
  toArray_(s.title_ideas).forEach(function (t) {
    body.appendListItem(String(t)).setGlyphType(DocumentApp.GlyphType.BULLET);
  });
  body.appendParagraph('');

  // フック
  appendSection_(body, '冒頭フック（0〜2秒）');
  body.appendParagraph(String(s.hook || '')).editAsText().setBold(true);
  body.appendParagraph('');

  // 構成表
  appendSection_(body, '構成');
  const cuts = toArray_(s.cuts);
  const rows = [['秒数', '映像・カット', 'セリフ', 'テロップ']];
  cuts.forEach(function (cut) {
    rows.push([
      String(cut.time || ''),
      String(cut.visual || ''),
      String(cut.line || ''),
      String(cut.caption || '')
    ]);
  });
  if (cuts.length) {
    const table = body.appendTable(rows);
    styleHeaderRow_(table.getRow(0));
    table.setColumnWidth(0, 70);
    table.setColumnWidth(1, 130);
    table.setColumnWidth(2, 180);
    table.setColumnWidth(3, 120);
  }
  body.appendParagraph('');

  // 締め
  appendSection_(body, '締め・CTA');
  body.appendParagraph(String(s.closing || ''));
  body.appendParagraph('');

  // ハッシュタグ
  const tags = toArray_(s.hashtags);
  if (tags.length) {
    appendSection_(body, 'ハッシュタグ');
    body.appendParagraph(tags.join(' '));
    body.appendParagraph('');
  }

  // 撮影メモ
  const notes = toArray_(s.shooting_notes);
  if (notes.length) {
    appendSection_(body, '撮影メモ');
    notes.forEach(function (n) {
      body.appendListItem(String(n)).setGlyphType(DocumentApp.GlyphType.BULLET);
    });
    body.appendParagraph('');
  }

  // 元にした入力（あとから見返せるように）
  if (input.note) {
    appendSection_(body, '元メモ');
    body.appendParagraph(input.note).editAsText().setForegroundColor('#666666');
  }

  doc.saveAndClose();
  moveFileToFolder_(doc.getId(), folder);
  return { id: doc.getId(), url: doc.getUrl(), name: name };
}

/** 見出しを追加する。 */
function appendSection_(body, text) {
  body.appendParagraph(text).setHeading(DocumentApp.ParagraphHeading.HEADING2);
}

/** 値を配列に正規化する（未定義・単一値にも耐える）。 */
function toArray_(v) {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}
