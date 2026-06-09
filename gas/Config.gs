/**
 * 設定値。APIキーなどの秘密情報は「スクリプトプロパティ」に保存します。
 * 設定方法: Apps Scriptエディタ →「プロジェクトの設定」→「スクリプト プロパティ」
 *   ANTHROPIC_API_KEY   … Claude(Anthropic) のAPIキー
 *   TRANSCRIBE_API_KEY  … 音声認識(文字起こし)サービスのAPIキー
 *   DROPBOX_TOKEN       … Dropbox のアクセストークン（Dropboxを使う場合）
 */
const CONFIG = {
  // 管理用シート名
  SHEET_NAME: '投稿管理',

  // 完成した写真をまとめる Drive フォルダ名（自動作成されます）
  READY_FOLDER_NAME: '投稿準備済',

  // Claude モデル設定
  CLAUDE_MODEL: 'claude-opus-4-8',
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

  // ステータスの値
  STATUS: {
    TODO: '未処理',
    DONE_DRAFT: '確認待ち',
    POSTED: '投稿済',
    ERROR: 'エラー'
  }
};

/** スクリプトプロパティを取得（未設定ならエラー）。 */
function getProp_(key) {
  const v = PropertiesService.getScriptProperties().getProperty(key);
  if (!v) throw new Error('スクリプトプロパティ "' + key + '" が未設定です。');
  return v;
}
