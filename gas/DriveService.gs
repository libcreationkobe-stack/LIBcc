/**
 * Google Drive のファイル取得・整理。
 */

/** ソース種別に応じてファイルを Blob で取得する。 */
function fetchFileBlob_(source, fileRef) {
  if (source === 'drive') return fetchDriveBlob_(fileRef);
  if (source === 'dropbox') return fetchDropboxBlob_(fileRef);
  throw new Error('ソース（B列）は "drive" または "dropbox" にしてください。現在: "' + source + '"');
}

/** DriveのURLまたはファイルIDから Blob を取得する。 */
function fetchDriveBlob_(ref) {
  const id = extractDriveId_(ref);
  const file = DriveApp.getFileById(id);
  return file.getBlob();
}

/** Drive共有URL（…/d/<id>/…、?id=<id>）またはそのままのIDからIDを抽出。 */
function extractDriveId_(ref) {
  if (!ref) throw new Error('Driveのファイル参照（C列）が空です。');
  let m = ref.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  m = ref.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  return ref; // すでにID形式とみなす
}

/** 「投稿準備済」フォルダを取得（無ければ作成）。 */
function getReadyFolder_() {
  const folders = DriveApp.getFoldersByName(CONFIG.READY_FOLDER_NAME);
  return folders.hasNext() ? folders.next() : DriveApp.createFolder(CONFIG.READY_FOLDER_NAME);
}

/** 写真Blobを「投稿準備済」フォルダにコピー保存する。 */
function moveToReadyFolder_(blob, name) {
  const folder = getReadyFolder_();
  if (name) blob = blob.setName(name);
  return folder.createFile(blob);
}
