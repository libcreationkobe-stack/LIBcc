/**
 * 設定値。APIキーなどの秘密情報は「スクリプトプロパティ」に保存します。
 * 設定方法: Apps Scriptエディタ →「プロジェクトの設定」→「スクリプト プロパティ」
 *   ANTHROPIC_API_KEY        … Claude(Anthropic) のAPIキー
 *   DROPBOX_TOKEN            … Dropbox のアクセストークン（Dropboxを使う場合）
 *   INVOICE_TEMPLATE_DOC_ID  … 請求書テンプレートのドキュメントID
 *                              （メニュー［請求書］→［テンプレートを作成］で自動登録されます）
 *
 * 文字起こしは Notta(+Zapier) 側で行い、結果をシートE列またはDriveの.txtで受け取ります。
 * Notta用のAPIキーはGAS側では不要です（Transcribe.gs を参照）。
 */
const CONFIG = {
  // 管理用シート名（GBP投稿）
  SHEET_NAME: '投稿管理',

  // 完成した写真をまとめる Drive フォルダ名（自動作成されます）
  READY_FOLDER_NAME: '投稿準備済',

  // Claude モデル設定
  CLAUDE_MODEL: 'claude-opus-5',
  CLAUDE_MAX_TOKENS: 2000,

  // GBP「最新情報」投稿文の目安文字数（GBPの上限は約1500文字）
  POST_MAX_CHARS: 1400,

  // シートの列番号（1始まり）。実際のシートに合わせて調整してください。
  COL: {
    TYPE: 1,        // A: 種別（"動画" または "写真"）
    SOURCE: 2,      // B: ソース（"drive" または "dropbox"）
    FILE_REF: 3,    // C: ファイル参照（DriveのURL/ID、またはDropboxのパス）
    NOTE: 4,        // D: メモ・補足（写真パターンで使う元情報）
    TRANSCRIPT: 5,  // E: 文字起こし結果（自動入力）
    DRAFT: 6,       // F: 生成された投稿文（自動入力）
    STATUS: 7,      // G: ステータス
    UPDATED_AT: 8   // H: 更新日時（自動入力）
  },

  // ステータスの値（共通）
  STATUS: {
    TODO: '未処理',
    DONE_DRAFT: '確認待ち',
    POSTED: '投稿済',
    DONE: '作成済',
    ERROR: 'エラー'
  },

  // ───────────────────────────────── 請求書 ─────────────────────────────────
  INVOICE: {
    SHEET_NAME: '請求書',
    FOLDER_NAME: '請求書',      // 生成物の保存先（自動作成）
    TEMPLATE_NAME: '請求書テンプレート',

    TAX_RATE: 0.10,             // 消費税率
    TAX_ROUNDING: 'floor',      // 消費税の端数処理: 'floor' | 'round' | 'ceil'
    NUMBER_PREFIX: 'INV-',      // 請求番号の接頭辞（例: INV-202609-001）
    DEFAULT_HONORIFIC: '御中',
    MAKE_PDF: true,             // PDFも一緒に書き出すか

    // 請求書に印字する自社情報。テンプレート側に直接書いてもOKです。
    COMPANY: {
      NAME: '',                 // 例: '株式会社LIB'
      ADDRESS: '',              // 例: '〒650-0000 兵庫県神戸市…'
      TEL: '',
      REG_NO: '',               // インボイス制度の登録番号（例: T1234567890123）
      BANK: ''                  // 例: '〇〇銀行 △△支店 普通 1234567 カ)リブ'
    },

    COL: {
      NUMBER: 1,      // A: 請求番号（空なら自動採番）
      DATE: 2,        // B: 請求日（空なら今日）
      CLIENT: 3,      // C: 請求先
      HONORIFIC: 4,   // D: 敬称（空なら「御中」）
      SUBJECT: 5,     // E: 件名
      DUE_DATE: 6,    // F: 支払期限（空なら翌月末）
      ITEMS: 7,       // G: 明細（1行1明細「品目,数量,単価」）
      NOTE: 8,        // H: 備考
      TOTAL: 9,       // I: 合計金額（自動入力）
      STATUS: 10,     // J: ステータス
      DOC_URL: 11,    // K: ドキュメントURL（自動入力）
      PDF_URL: 12,    // L: PDF URL（自動入力）
      UPDATED_AT: 13  // M: 更新日時（自動入力）
    }
  },

  // ───────────────────────────────── 台本 ─────────────────────────────────
  SCENARIO: {
    SHEET_NAME: '台本',
    FOLDER_NAME: '台本',        // 生成物の保存先（自動作成）
    DEFAULT_MEDIA: 'リール',
    DEFAULT_LENGTH_SEC: 45,

    COL: {
      THEME: 1,       // A: 企画・テーマ
      NOTE: 2,        // B: メモ・素材（話したいこと）
      LENGTH: 3,      // C: 尺（秒）
      MEDIA: 4,       // D: 媒体（リール / TikTok / ショート など）
      STATUS: 5,      // E: ステータス
      DOC_URL: 6,     // F: ドキュメントURL（自動入力）
      UPDATED_AT: 7   // G: 更新日時（自動入力）
    }
  }
};

/** スクリプトプロパティを取得（未設定ならエラー）。 */
function getProp_(key) {
  const v = PropertiesService.getScriptProperties().getProperty(key);
  if (!v) throw new Error('スクリプトプロパティ "' + key + '" が未設定です。');
  return v;
}

/** スクリプトプロパティを取得（未設定なら空文字）。 */
function getPropOptional_(key) {
  return PropertiesService.getScriptProperties().getProperty(key) || '';
}

/** スクリプトプロパティを保存。 */
function setProp_(key, value) {
  PropertiesService.getScriptProperties().setProperty(key, value);
}
