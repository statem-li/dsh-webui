/** Copy dictionaries for the file-explorer sidebar panel. */

/** Simplified Chinese dictionary and key source of truth. */
export const zh = {
  entry: '文件',
  drawerTitle: '工作区文件',
  close: '关闭',
  workspaceLabel: '工作区',
  loading: '正在读取…',
  error: '暂时无法读取文件。',
  retry: '重试',
  refresh: '刷新',
  emptyWorkspaces: '还没有工作区。先在会话里打开一个项目目录。',
  emptyDir: '此目录为空',
  binaryError: '二进制文件，无法文本预览。',
  tooLarge: '文件过大，无法预览。',
  notFound: '文件不存在或已被移动。',
  outsideWorkspace: '路径不在任何工作区内。',
  editorTitle: '编辑文件',
  save: '保存',
  cancel: '取消',
  saving: '保存中…',
  unsaved: '有未保存的修改',
  saveFailed: '保存失败',
  staleConflict: '文件已被外部修改。保存会覆盖他人改动，仍要覆盖吗？',
  overwrite: '仍要覆盖',
} satisfies Record<string, string>

/** File-explorer locale key union. */
export type FileExplorerLocaleKey = keyof typeof zh

/** Locale namespace owned by this plugin. */
export const NS = 'fileExplorer'

/** English dictionary checked against the Chinese key set. */
export const en = {
  entry: 'Files',
  drawerTitle: 'Workspace files',
  close: 'Close',
  workspaceLabel: 'Workspace',
  loading: 'Reading…',
  error: 'Files are temporarily unavailable.',
  retry: 'Retry',
  refresh: 'Refresh',
  emptyWorkspaces: 'No workspaces yet. Open a project folder in a session first.',
  emptyDir: 'This folder is empty',
  binaryError: 'Binary file — no text preview.',
  tooLarge: 'File is too large to preview.',
  notFound: 'The file does not exist or was moved.',
  outsideWorkspace: 'The path is outside every workspace.',
  editorTitle: 'Edit file',
  save: 'Save',
  cancel: 'Cancel',
  saving: 'Saving…',
  unsaved: 'Unsaved changes',
  saveFailed: 'Save failed',
  staleConflict: 'The file changed on disk. Saving will overwrite those changes — continue?',
  overwrite: 'Overwrite',
} satisfies Record<FileExplorerLocaleKey, string>
