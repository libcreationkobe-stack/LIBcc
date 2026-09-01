/**
 * 月次請求書（PDF自動作成）の設定。
 *
 * 3つのシートを使います（メニュー［請求書］→［シートを準備する］で自動作成できます）。
 *   請求先マスタ … 請求先の情報（1行＝1社）
 *   請求明細     … 請求する品目（1行＝1明細、対象年月＋請求先IDで請求書にまとまります）
 *   請求書ログ   … 発行した請求書の記録（自動入力／二重発行の防止に使います）
 *
 * 自社情報（ISSUER）と支払口座は、このファイルを直接書き換えてください。
 */
const INVOICE_CONFIG = {
  // シート名
  CLIENT_SHEET_NAME: '請求先マスタ',
  ITEM_SHEET_NAME: '請求明細',
  LOG_SHEET_NAME: '請求書ログ',

  // PDFの保存先 Drive フォルダ名（自動作成されます。中に年月フォルダを作ります）
  PDF_FOLDER_NAME: '請求書PDF',

  TIMEZONE: 'Asia/Tokyo',

  // 自動実行の対象月。-1 = 実行日の1か月前（例: 9/1に実行 → 8月分）
  TARGET_MONTH_OFFSET: -1,

  // 毎月の自動実行タイミング（setupMonthlyInvoiceTrigger で使用）
  TRIGGER_DAY_OF_MONTH: 1,
  TRIGGER_HOUR: 8,

  // 請求書番号の形式: <PREFIX>-<対象年月>-<請求先ID> （例: INV-202608-C001）
  INVOICE_NO_PREFIX: 'INV',

  // 消費税の端数処理: 'floor'（切り捨て） / 'round'（四捨五入） / 'ceil'（切り上げ）
  TAX_ROUNDING: 'floor',

  // 明細の税率（G列）が空のときに使う税率（%）
  DEFAULT_TAX_RATE: 10,

  // 請求先マスタの支払期日ルールが空のときの既定値
  DEFAULT_DUE_RULE: '翌月末',

  // true にすると、PDFを添付したGmailの「下書き」も作成します（送信はしません）。
  // ※ appsscript.json の gmail.compose スコープが必要です。使わない場合は false のままでOK。
  CREATE_GMAIL_DRAFT: false,
  MAIL_SUBJECT_TEMPLATE: '{対象年月}分 ご請求書のご送付（{自社名}）',

  // 自社（請求書の発行者）情報
  ISSUER: {
    NAME: '株式会社サンプル',
    REGISTRATION_NO: 'T1234567890123',   // 適格請求書発行事業者の登録番号（インボイス番号）
    POSTAL_CODE: '650-0001',
    ADDRESS: '兵庫県神戸市中央区〇〇1-2-3',
    TEL: '078-000-0000',
    EMAIL: 'info@example.com',
    BANK: 'サンプル銀行 神戸支店 普通 1234567 カ）サンプル'
  },

  // 請求書の下部に入れる一言（不要なら空文字に）
  FOOTER_NOTE: 'お忙しいところ恐れ入りますが、お支払期日までにお振込みくださいますようお願い申し上げます。',

  // 請求先マスタの列番号（1始まり）
  CLIENT_COL: {
    ID: 1,          // A: 請求先ID（請求明細と紐付けるキー）
    NAME: 2,        // B: 請求先名
    HONORIFIC: 3,   // C: 敬称（御中 / 様）
    CONTACT: 4,     // D: 部署・担当者
    POSTAL: 5,      // E: 郵便番号
    ADDRESS: 6,     // F: 住所
    EMAIL: 7,       // G: メールアドレス（Gmail下書きを使う場合）
    DUE_RULE: 8,    // H: 支払期日（翌月末 / 当月末 / 翌々月末 / 翌月20日 など）
    NOTE: 9,        // I: 備考（請求書に印字されます）
    ACTIVE: 10      // J: 有効（FALSE または「無効」で対象外）
  },

  // 請求明細の列番号（1始まり）
  ITEM_COL: {
    MONTH: 1,      // A: 対象年月（2026-08 / 2026/8 / 日付セル いずれもOK）
    CLIENT_ID: 2,  // B: 請求先ID
    NAME: 3,       // C: 品目
    QTY: 4,        // D: 数量
    UNIT: 5,       // E: 単位（式・時間・個 など）
    PRICE: 6,      // F: 単価（税抜）
    TAX_RATE: 7,   // G: 税率（10 / 8。空欄なら DEFAULT_TAX_RATE）
    NOTE: 8        // H: 備考
  },

  // 請求書ログの列番号（1始まり）
  LOG_COL: {
    ISSUED_AT: 1,   // A: 発行日時
    MONTH: 2,       // B: 対象年月
    CLIENT_ID: 3,   // C: 請求先ID
    CLIENT_NAME: 4, // D: 請求先名
    INVOICE_NO: 5,  // E: 請求書番号
    SUBTOTAL: 6,    // F: 小計（税抜）
    TAX: 7,         // G: 消費税
    TOTAL: 8,       // H: 合計（税込）
    PDF_URL: 9,     // I: PDFのURL
    STATUS: 10      // J: ステータス
  },

  LOG_STATUS: {
    CREATED: '作成済',
    DRAFTED: '下書き作成済',
    ERROR: 'エラー'
  }
};

/** 各シートの見出し行（シート準備時に書き込みます）。 */
const INVOICE_HEADERS = {
  CLIENT: ['請求先ID', '請求先名', '敬称', '部署・担当者', '郵便番号', '住所', 'メールアドレス', '支払期日', '備考', '有効'],
  ITEM: ['対象年月', '請求先ID', '品目', '数量', '単位', '単価(税抜)', '税率(%)', '備考'],
  LOG: ['発行日時', '対象年月', '請求先ID', '請求先名', '請求書番号', '小計(税抜)', '消費税', '合計(税込)', 'PDFのURL', 'ステータス']
};
