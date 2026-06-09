/**
 * Dropbox のファイル取得。
 * スクリプトプロパティ DROPBOX_TOKEN にアクセストークンを設定してください。
 * （Dropboxアプリコンソールで作成。files.content.read 権限が必要）
 */

/** Dropboxのパス（例: /reels/2026-06-09.mp4）から Blob を取得する。 */
function fetchDropboxBlob_(path) {
  if (!path) throw new Error('Dropboxのパス（C列）が空です。');
  const token = getProp_('DROPBOX_TOKEN');

  const res = UrlFetchApp.fetch('https://content.dropboxapi.com/2/files/download', {
    method: 'get',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Dropbox-API-Arg': JSON.stringify({ path: path })
    },
    muteHttpExceptions: true
  });

  const code = res.getResponseCode();
  if (code !== 200) {
    throw new Error('Dropboxダウンロード失敗 (HTTP ' + code + '): ' + res.getContentText());
  }
  const blob = res.getBlob();
  // パス末尾をファイル名に
  const name = path.split('/').pop();
  return name ? blob.setName(name) : blob;
}

/**
 * フォルダ内のファイル一覧を取得（応用例: 新着リールを自動検知したいとき）。
 * @return {Array<{name:string, path_lower:string}>}
 */
function listDropboxFolder_(folderPath) {
  const token = getProp_('DROPBOX_TOKEN');
  const res = UrlFetchApp.fetch('https://api.dropboxapi.com/2/files/list_folder', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + token },
    payload: JSON.stringify({ path: folderPath }),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('Dropbox一覧取得失敗: ' + res.getContentText());
  }
  return JSON.parse(res.getContentText()).entries || [];
}
