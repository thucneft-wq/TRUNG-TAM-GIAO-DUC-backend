/**
 * Shared MVP workflow helpers for short IDs, soft archive and assignment mirror.
 * Keep this file in the same Apps Script project as the Student/Counselor sync files.
 */

const MVP_ARCHIVE_SHEET_ = 'Lưu trữ';
const MVP_ASSIGNMENT_SHEET_ = 'counselor_assignments';

function installMvpWorkflow() {
  mvpEnsureArchiveSheet_();
  setupStudentStatusColumns();
  installStudentSyncTriggers();
  installCounselorSyncTriggers();
  installAssignmentSyncTriggers();
  installFeedbackSyncTriggers();
  console.log('Đã cài trigger Student, Counselor, Assignment và Feedback.');
}

function syncAllMvpData() {
  syncAllCounselors();
  syncAllStudents();
  syncAllAssignments();
  syncAllFeedback();
  console.log('Đã đồng bộ toàn bộ dữ liệu MVP.');
}

function mvpEnsureArchiveSheet_() {
  const spreadsheet = SpreadsheetApp.getActive();
  let sheet = spreadsheet.getSheetByName(MVP_ARCHIVE_SHEET_);
  if (!sheet) sheet = spreadsheet.insertSheet(MVP_ARCHIVE_SHEET_);
  const headers = [
    'archive_id', 'entity_type', 'external_id', 'display_name', 'source_sheet',
    'source_row', 'previous_status', 'archive_reason', 'archived_at', 'archived_by',
    'sync_status', 'last_synced_at', 'notes',
  ];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
}

function mvpEnsureExternalId_(sheet, rowNumber, headerName, prefix) {
  const existing = mvpCellByHeader_(sheet, rowNumber, headerName);
  if (existing) return existing;

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const afterLock = mvpCellByHeader_(sheet, rowNumber, headerName);
    if (afterLock) return afterLock;

    const pattern = new RegExp(`^${prefix}-(\\d+)$`, 'i');
    let maximum = 0;
    SpreadsheetApp.getActive().getSheets().forEach(function(candidate) {
      const values = candidate.getDataRange().getDisplayValues();
      values.forEach(function(row) {
        row.forEach(function(value) {
          const match = String(value || '').trim().match(pattern);
          if (match) maximum = Math.max(maximum, Number(match[1]));
        });
      });
    });
    const generated = `${prefix}-${String(maximum + 1).padStart(2, '0')}`;
    mvpSetCellByHeader_(sheet, rowNumber, headerName, generated);
    return generated;
  } finally {
    lock.releaseLock();
  }
}

function mvpSetCellByHeader_(sheet, rowNumber, headerName, value) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const index = headers.findIndex(function(header) {
    return String(header || '').trim() === headerName;
  });
  if (index < 0) throw new Error(`Tab ${sheet.getName()} thiếu cột ${headerName}.`);
  sheet.getRange(rowNumber, index + 1).setValue(value);
}

function mvpCellByHeader_(sheet, rowNumber, headerName) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const index = headers.findIndex(function(header) {
    return String(header || '').trim() === headerName;
  });
  if (index < 0) return '';
  return String(sheet.getRange(rowNumber, index + 1).getDisplayValue() || '').trim();
}

function mvpSyncTimestamp_(label) {
  return `${label} ${Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm:ss')}`;
}

function mvpAppendArchive_(entry) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(MVP_ARCHIVE_SHEET_);
  if (!sheet) throw new Error(`Không tìm thấy tab ${MVP_ARCHIVE_SHEET_}.`);
  const rows = sheet.getLastRow() > 1
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 13).getDisplayValues()
    : [];
  const duplicate = rows.some(function(row) {
    return row[1] === entry.entityType
      && row[2] === entry.externalId
      && row[4] === entry.sourceSheet
      && String(row[5]) === String(entry.sourceRow)
      && row[6] === entry.previousStatus;
  });
  if (duplicate) return;

  const now = new Date();
  const archiveId = `LT-${Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyyMMddHHmmss')}-${entry.externalId}`;
  sheet.appendRow([
    archiveId,
    entry.entityType,
    entry.externalId,
    entry.displayName || '',
    entry.sourceSheet || '',
    entry.sourceRow || '',
    entry.previousStatus || '',
    entry.reason || '',
    now,
    Session.getEffectiveUser().getEmail() || 'apps-script',
    'SYNCED',
    now,
    entry.notes || '',
  ]);
}

function mvpUpsertAssignment_(externalStudentId, externalCounselorId, studentStatus) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(MVP_ASSIGNMENT_SHEET_);
  if (!sheet) throw new Error(`Không tìm thấy tab ${MVP_ASSIGNMENT_SHEET_}.`);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const values = sheet.getLastRow() > 1
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues()
    : [];
  const column = function(name) {
    const index = headers.indexOf(name);
    if (index < 0) throw new Error(`Tab ${MVP_ASSIGNMENT_SHEET_} thiếu cột ${name}.`);
    return index;
  };
  const studentIndex = column('student_id');
  const counselorIndex = column('counselor_id');
  const statusIndex = column('status');
  const updatedIndex = column('updated_at');
  const rowIndex = values.findIndex(function(row) {
    return String(row[studentIndex] || '').trim() === externalStudentId
      && String(row[counselorIndex] || '').trim() === externalCounselorId;
  });
  const active = studentStatus === 'ACTIVE';
  const now = new Date();
  if (rowIndex >= 0) {
    const rowNumber = rowIndex + 2;
    sheet.getRange(rowNumber, statusIndex + 1).setValue(active ? 'active' : 'inactive');
    sheet.getRange(rowNumber, updatedIndex + 1).setValue(now);
    return;
  }
  if (!active) return;

  const assignmentIdIndex = column('assignment_id');
  const createdIndex = column('created_at');
  const nextId = mvpNextAssignmentId_(values, assignmentIdIndex);
  const row = new Array(sheet.getLastColumn()).fill('');
  row[assignmentIdIndex] = nextId;
  row[studentIndex] = externalStudentId;
  row[counselorIndex] = externalCounselorId;
  row[statusIndex] = 'active';
  row[createdIndex] = now;
  row[updatedIndex] = now;
  sheet.appendRow(row);
}

function mvpNextAssignmentId_(rows, assignmentIdIndex) {
  const maximum = rows.reduce(function(current, row) {
    const match = String(row[assignmentIdIndex] || '').match(/^PC-(\d+)$/i);
    return match ? Math.max(current, Number(match[1])) : current;
  }, 0);
  return `PC-${String(maximum + 1).padStart(2, '0')}`;
}

function mvpUpsertEntityRow_(sheetName, idHeader, externalId, valuesByHeader) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(sheetName);
  if (!sheet) throw new Error(`Không tìm thấy tab ${sheetName}.`);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const idIndex = headers.indexOf(idHeader);
  if (idIndex < 0) throw new Error(`Tab ${sheetName} thiếu cột ${idHeader}.`);
  const ids = sheet.getLastRow() > 1
    ? sheet.getRange(2, idIndex + 1, sheet.getLastRow() - 1, 1).getDisplayValues().flat()
    : [];
  const matchedIndex = ids.findIndex(function(value) {
    return String(value || '').trim() === externalId;
  });
  const rowNumber = matchedIndex >= 0 ? matchedIndex + 2 : sheet.getLastRow() + 1;
  const row = matchedIndex >= 0
    ? sheet.getRange(rowNumber, 1, 1, sheet.getLastColumn()).getValues()[0]
    : new Array(sheet.getLastColumn()).fill('');
  row[idIndex] = externalId;
  Object.keys(valuesByHeader).forEach(function(header) {
    const index = headers.indexOf(header);
    if (index >= 0) row[index] = valuesByHeader[header] === null ? '' : valuesByHeader[header];
  });
  const createdIndex = headers.indexOf('created_at');
  const updatedIndex = headers.indexOf('updated_at');
  const now = new Date();
  if (createdIndex >= 0 && !row[createdIndex]) row[createdIndex] = now;
  if (updatedIndex >= 0) row[updatedIndex] = now;
  sheet.getRange(rowNumber, 1, 1, row.length).setValues([row]);
}
