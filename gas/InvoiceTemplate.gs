/**
 * 請求書テンプレート（Googleドキュメント）の自動生成。
 *
 * メニュー［請求書］→［テンプレートを作成］で実行すると、
 * プレースホルダ入りのテンプレートを作り、そのIDをスクリプトプロパティに登録します。
 * 作成後はロゴ・印影・文言などを自由に編集してください（{{ }} は消さないこと）。
 */

/** テンプレートを作成し、IDをスクリプトプロパティに保存する。 */
function createInvoiceTemplate() {
  const inv = CONFIG.INVOICE;
  const folder = getOrCreateFolder_(inv.FOLDER_NAME);
  const doc = DocumentApp.create(inv.TEMPLATE_NAME);
  const body = doc.getBody();
  body.clear();

  body.setMarginTop(50).setMarginBottom(50).setMarginLeft(50).setMarginRight(50);

  // タイトル
  const title = body.appendParagraph('請 求 書');
  title.setHeading(DocumentApp.ParagraphHeading.TITLE)
    .setAlignment(DocumentApp.HorizontalAlignment.CENTER);

  // 右上: 請求番号・請求日
  body.appendParagraph('請求番号: {{請求番号}}')
    .setAlignment(DocumentApp.HorizontalAlignment.RIGHT);
  body.appendParagraph('発行日: {{請求日}}')
    .setAlignment(DocumentApp.HorizontalAlignment.RIGHT);

  // 宛先
  const to = body.appendParagraph('{{請求先}} {{敬称}}');
  to.editAsText().setFontSize(14).setBold(true);
  body.appendParagraph('');

  body.appendParagraph('下記のとおりご請求申し上げます。');
  body.appendParagraph('件名: {{件名}}');
  body.appendParagraph('');

  // ご請求金額（目立たせる）
  const amount = body.appendParagraph('ご請求金額（税込）　{{合計}}');
  amount.editAsText().setFontSize(16).setBold(true);
  body.appendParagraph('お支払期限: {{支払期限}}');
  body.appendParagraph('');

  // 明細テーブル（2行目が1明細ぶんのテンプレート行）
  const itemTable = body.appendTable([
    ['品目', '数量', '単価', '金額'],
    ['{{品目}}', '{{数量}}', '{{単価}}', '{{金額}}']
  ]);
  styleHeaderRow_(itemTable.getRow(0));
  alignRowRight_(itemTable.getRow(0), [1, 2, 3]);
  alignRowRight_(itemTable.getRow(1), [1, 2, 3]);
  itemTable.setColumnWidth(0, 260);
  itemTable.setColumnWidth(1, 60);
  itemTable.setColumnWidth(2, 90);
  itemTable.setColumnWidth(3, 90);

  body.appendParagraph('');

  // 合計テーブル
  const sumTable = body.appendTable([
    ['小計', '{{小計}}'],
    ['消費税（{{税率}}）', '{{消費税}}'],
    ['合計', '{{合計}}']
  ]);
  sumTable.setColumnWidth(0, 360);
  sumTable.setColumnWidth(1, 140);
  for (let r = 0; r < sumTable.getNumRows(); r++) {
    alignRowRight_(sumTable.getRow(r), [1]);
  }
  sumTable.getRow(2).getCell(0).editAsText().setBold(true);
  sumTable.getRow(2).getCell(1).editAsText().setBold(true);

  body.appendParagraph('');
  body.appendParagraph('備考').editAsText().setBold(true);
  body.appendParagraph('{{備考}}');
  body.appendParagraph('');

  // 発行元（自社情報）
  body.appendParagraph('────────────────────────────');
  body.appendParagraph('{{自社名}}').editAsText().setBold(true);
  body.appendParagraph('{{自社住所}}');
  body.appendParagraph('TEL: {{自社TEL}}');
  body.appendParagraph('登録番号: {{登録番号}}');
  body.appendParagraph('お振込先: {{振込先}}');

  doc.saveAndClose();
  moveFileToFolder_(doc.getId(), folder);
  setProp_('INVOICE_TEMPLATE_DOC_ID', doc.getId());

  return { id: doc.getId(), url: doc.getUrl() };
}

/** テーブルのヘッダー行に色と太字を設定する。 */
function styleHeaderRow_(row) {
  for (let c = 0; c < row.getNumCells(); c++) {
    const cell = row.getCell(c);
    cell.setBackgroundColor('#f1f3f4');
    cell.editAsText().setBold(true);
  }
}

/** 指定した列インデックスのセルを右寄せにする。 */
function alignRowRight_(row, colIndexes) {
  colIndexes.forEach(function (c) {
    if (c >= row.getNumCells()) return;
    const cell = row.getCell(c);
    for (let p = 0; p < cell.getNumChildren(); p++) {
      const child = cell.getChild(p);
      if (child.getType() === DocumentApp.ElementType.PARAGRAPH) {
        child.asParagraph().setAlignment(DocumentApp.HorizontalAlignment.RIGHT);
      }
    }
  });
}
