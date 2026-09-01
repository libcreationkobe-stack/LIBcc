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

  // PDFの保存先。
  //   PDF_PARENT_FOLDER   … 毎月のフォルダを置く親フォルダ。DriveのURLかフォルダIDを入れます。
  //                         空欄ならマイドライブ直下に PDF_FOLDER_NAME のフォルダを作ります。
  //   MONTH_FOLDER_FORMAT … 月フォルダの名前。同じ名前のフォルダが既にあればそれを使い、
  //                         無ければ自動で作ります（手動で作っているフォルダ名に合わせてください）。
  //                         例: 'yyyy年M月' → 2026年8月 ／ 'yyyy-MM' → 2026-08 ／ 'yyyy年M月請求書'
  PDF_PARENT_FOLDER: '',
  PDF_FOLDER_NAME: '請求書PDF',
  MONTH_FOLDER_FORMAT: 'yyyy年M月',

  // PDFのファイル名（拡張子なし）。{yyyy} {M} {MM} {yyyyMM} {請求先名} {請求書番号} が使えます。
  PDF_NAME_TEMPLATE: '{M}月分請求書:{請求先名}様',

  TIMEZONE: 'Asia/Tokyo',

  // 自動実行の対象月。0 = 実行日と同じ月（当月25日発行 → 当月末払い の運用）。
  // 前月ぶんを翌月に発行する運用なら -1 にしてください。
  TARGET_MONTH_OFFSET: 0,

  // 毎月の自動実行タイミング（setupMonthlyInvoiceTrigger で使用）
  TRIGGER_DAY_OF_MONTH: 25,
  TRIGGER_HOUR: 8,

  // 請求書番号の形式: <PREFIX>-<対象年月>-<請求先ID> （例: INV-202608-C001）
  // PDFに印字される見出しは INVOICE_NO_LABEL で変えられます（例: '伝票番号'）。
  INVOICE_NO_PREFIX: 'INV',
  INVOICE_NO_LABEL: '請求書番号',

  // 消費税の端数処理: 'floor'（切り捨て） / 'round'（四捨五入） / 'ceil'（切り上げ）
  TAX_ROUNDING: 'floor',

  // 明細の税率（G列）が空のときに使う税率（%）
  DEFAULT_TAX_RATE: 10,

  // 請求先マスタの支払期日ルールが空のときの既定値
  DEFAULT_DUE_RULE: '当月末',

  // 請求先マスタの敬称が空のときの既定値
  DEFAULT_HONORIFIC: '御中',

  // true にすると、PDFを添付したGmailの「下書き」も作成します（送信はしません）。
  // ※ appsscript.json の gmail.compose スコープが必要です。使わない場合は false のままでOK。
  CREATE_GMAIL_DRAFT: false,
  MAIL_SUBJECT_TEMPLATE: '{対象年月}分 ご請求書のご送付（{自社名}）',

  // 自社（請求書の発行者）情報
  ISSUER: {
    NAME: '株式会社LIB creation.',
    REGISTRATION_NO: '',   // 適格請求書発行事業者の登録番号（T+13桁）。入れると請求書に印字されます
    POSTAL_CODE: '650-0023',
    ADDRESS: '兵庫県神戸市中央区栄町通5丁目2-2 REALIZE KOBE 203',
    TEL: '078-381-5216 / 080-3208-0310',
    EMAIL: 'lib.creation.kobe@gmail.com',
    BANK: 'GMOあおぞらネット銀行 法人営業部 普通 1376427 カ）リブクリエイション'
  },

  // 請求書の備考欄に入れる文言（改行は \n）。不要なら空文字に。
  FOOTER_NOTE: '※振込手数料は貴社ご負担にてお願い申し上げます。\n今後とも何卒よろしくお願い申し上げます。',

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
