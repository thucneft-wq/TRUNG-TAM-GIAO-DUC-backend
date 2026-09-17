/**
 * Shared MVP workflow helpers for short IDs, soft archive and assignment mirror.
 * Keep this file in the same Apps Script project as the Student/Counselor sync files.
 */

const MVP_ARCHIVE_SHEET_ = 'Lưu trữ';
const MVP_ASSIGNMENT_SHEET_ = 'counselor_assignments';
const MVP_STUDENT_SOURCE_SHEET_ = 'students';
const MVP_STUDENT_LEVEL_SHEETS_ = Object.freeze({
  THCS: 'students_THCS',
  THPT: 'students_THPT',
});

function installMvpWorkflow() {
  mvpEnsureArchiveSheet_();
  mvpEnsureStudentLevelSheets_();
  setupStudentStatusColumns();
  setupCounselorApprovalColumns();
  installMvpSyncTriggers();
  console.log('Đã cài một bộ trigger chung cho Student, Counselor, Assignment và Feedback.');
}

/**
 * Installs exactly one edit trigger and one form-submit trigger for the entire
 * workbook. Separate installable triggers all fire for every edit, even when
 * their handlers immediately ignore the edited tab. On a busy Sheet that
 * creates concurrent executions which contend for Spreadsheet service access
 * and can time out before the intended counselor approval is synchronized.
 */
function installMvpSyncTriggers() {
  const spreadsheet = SpreadsheetApp.getActive();
  const obsoleteHandlers = [
    'handleMvpEdit',
    'handleMvpFormSubmit',
    'handleMvpChange',
    'handleUnifiedEdit',
    'handleUnifiedFormSubmit',
    'handleUnifiedChange',
    'onEdit',
    'onFormSubmit',
    'handleStudentEdit',
    'handleStudentFormSubmit',
    'handleCounselorEdit',
    'handleCounselorFormSubmit',
    'handleAssignmentEdit',
    'handleFeedbackEdit',
    'handleFeedbackFormSubmit',
    'backendOnEdit',
    'backendOnFormSubmit',
  ];

  ScriptApp.getProjectTriggers()
    .filter(function(trigger) {
      return obsoleteHandlers.indexOf(trigger.getHandlerFunction()) !== -1;
    })
    .forEach(function(trigger) {
      ScriptApp.deleteTrigger(trigger);
    });

  ScriptApp.newTrigger('handleMvpEdit')
    .forSpreadsheet(spreadsheet)
    .onEdit()
    .create();
  ScriptApp.newTrigger('handleMvpFormSubmit')
    .forSpreadsheet(spreadsheet)
    .onFormSubmit()
    .create();
  ScriptApp.newTrigger('handleMvpChange')
    .forSpreadsheet(spreadsheet)
    .onChange()
    .create();
}

function handleMvpChange(event) {
  if (!event || event.changeType !== 'REMOVE_ROW') return;
  counselorHandleSheetRowDeletion_();
  studentHandleSheetRowDeletion_();
}

function handleMvpEdit(event) {
  if (!event || !event.range || event.range.getRow() <= 1) return;
  const sheetName = event.range.getSheet().getName();

  if (sheetName === COUNSELOR_FORM_SHEET_) {
    const firstColumn = event.range.getColumn();
    const lastColumn = firstColumn + event.range.getNumColumns() - 1;
    // The approval field is column Q in the counselor response tab. Ignore
    // cell-by-cell manual entry until Admin makes the lifecycle decision.
    if (17 < firstColumn || 17 > lastColumn) return;
    return handleCounselorEdit(event);
  }
  if (STUDENT_SHEETS[sheetName] || STUDENT_MANAGEMENT_SHEETS[sheetName]) {
    return handleStudentEdit(event);
  }
  if (sheetName === STUDENT_PARENT_SHEET_) return handleParentEdit(event);
  if (FEEDBACK_SYNC_SHEETS_.indexOf(sheetName) !== -1) return handleFeedbackEdit(event);
  if (isAssignmentSheet_(sheetName)) return handleAssignmentEdit(event);
}

function handleMvpFormSubmit(event) {
  if (!event || !event.range) throw new Error('Thiếu dữ liệu sự kiện gửi Google Form.');
  const sheetName = event.range.getSheet().getName();

  if (sheetName === COUNSELOR_FORM_SHEET_) return handleCounselorFormSubmit(event);
  if (STUDENT_SHEETS[sheetName]) return handleStudentFormSubmit(event);
  if (FEEDBACK_SYNC_SHEETS_.indexOf(sheetName) !== -1) return handleFeedbackFormSubmit(event);
}

function syncAllMvpData() {
  syncAllCounselors();
  syncAllStudents();
  syncAllAssignments();
  syncAllFeedback();
  console.log('Đã đồng bộ toàn bộ dữ liệu MVP.');
}

function setupStudentManagementSheets() {
  mvpEnsureStudentLevelSheets_();
  mvpRefreshStudentLevelSheets_();
  console.log('Đã tạo và đồng bộ hai tab students_THCS, students_THPT.');
}

function mvpEnsureStudentLevelSheets_() {
  const spreadsheet = SpreadsheetApp.getActive();
  const source = spreadsheet.getSheetByName(MVP_STUDENT_SOURCE_SHEET_);
  if (!source) throw new Error(`Không tìm thấy tab ${MVP_STUDENT_SOURCE_SHEET_}.`);
  const headers = source.getRange(1, 1, 1, source.getLastColumn()).getDisplayValues()[0];

  Object.keys(MVP_STUDENT_LEVEL_SHEETS_).forEach(function(level) {
    const name = MVP_STUDENT_LEVEL_SHEETS_[level];
    let sheet = spreadsheet.getSheetByName(name);
    if (!sheet) sheet = spreadsheet.insertSheet(name);
    if (sheet.getMaxColumns() < headers.length) {
      sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
    }
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    source.getRange(1, 1, 1, headers.length).copyTo(
      sheet.getRange(1, 1, 1, headers.length),
      SpreadsheetApp.CopyPasteType.PASTE_FORMAT,
      false,
    );
    sheet.setFrozenRows(1);

    const statusIndex = headers.indexOf('status');
    if (statusIndex >= 0) {
      const validation = SpreadsheetApp.newDataValidation()
        .requireValueInList([
          STUDENT_STATUS_ACTIVE_LABEL,
          STUDENT_STATUS_COMPLETED_LABEL,
          STUDENT_STATUS_INACTIVE_LABEL,
        ], true)
        .setAllowInvalid(false)
        .build();
      sheet.getRange(2, statusIndex + 1, Math.max(sheet.getMaxRows() - 1, 1), 1)
        .setDataValidation(validation);
    }
  });
}

function mvpRefreshStudentLevelSheets_() {
  mvpEnsureStudentLevelSheets_();
  const spreadsheet = SpreadsheetApp.getActive();
  const source = spreadsheet.getSheetByName(MVP_STUDENT_SOURCE_SHEET_);
  const headers = source.getRange(1, 1, 1, source.getLastColumn()).getDisplayValues()[0];
  if (source.getLastRow() <= 1) return;

  const rows = source.getRange(2, 1, source.getLastRow() - 1, headers.length).getValues();
  rows.forEach(function(row) {
    const externalId = String(row[headers.indexOf('student_id')] || '').trim();
    if (!externalId) return;
    const level = mvpStudentLevelFromEntityRow_(headers, row);
    if (!level) return;
    const valuesByHeader = {};
    headers.forEach(function(header, index) {
      valuesByHeader[header] = row[index];
    });
    valuesByHeader.status = mvpStudentStatusLabel_(valuesByHeader.status);
    mvpUpsertEntityRow_(MVP_STUDENT_LEVEL_SHEETS_[level], 'student_id', externalId, valuesByHeader);
  });
}

function mvpUpsertStudentLevelRow_(schoolLevel, externalId, valuesByHeader) {
  const normalizedLevel = String(schoolLevel || '').trim().toUpperCase();
  const sheetName = MVP_STUDENT_LEVEL_SHEETS_[normalizedLevel];
  if (!sheetName) return;
  mvpEnsureStudentLevelSheets_();
  const managementValues = Object.assign({}, valuesByHeader, {
    status: mvpStudentStatusLabel_(valuesByHeader.status),
  });
  mvpUpsertEntityRow_(sheetName, 'student_id', externalId, managementValues);
}

function mvpStudentStatusLabel_(value) {
  const normalized = String(value || '').trim().toLocaleLowerCase('vi-VN');
  if (normalized === 'completed' || normalized === STUDENT_STATUS_COMPLETED_LABEL.toLocaleLowerCase('vi-VN')) {
    return STUDENT_STATUS_COMPLETED_LABEL;
  }
  if (normalized === 'inactive' || normalized === STUDENT_STATUS_INACTIVE_LABEL.toLocaleLowerCase('vi-VN')) {
    return STUDENT_STATUS_INACTIVE_LABEL;
  }
  return STUDENT_STATUS_ACTIVE_LABEL;
}

function mvpStudentLevelFromEntityRow_(headers, row) {
  const gradeIndex = headers.indexOf('grade_level');
  const gradeText = gradeIndex >= 0 ? String(row[gradeIndex] || '').trim() : '';
  const grade = gradeText ? Number(gradeText) : NaN;
  if (Number.isFinite(grade)) return grade <= 9 ? 'THCS' : 'THPT';
  const schoolIndex = headers.indexOf('school_name');
  const schoolName = schoolIndex >= 0 ? String(row[schoolIndex] || '').toUpperCase() : '';
  if (schoolName.indexOf('THCS') >= 0) return 'THCS';
  if (schoolName.indexOf('THPT') >= 0) return 'THPT';
  return '';
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

    const pattern = new RegExp('^' + prefix + '-([0-9]+)$', 'i');
    const entityIdHeader = prefix === 'TTV'
      ? 'counselor_id'
      : (prefix === 'HS' ? 'student_id' : '');
    const candidateHeaders = [headerName, entityIdHeader].filter(Boolean);
    let maximum = 0;

    // Only inspect ID columns. Scanning every populated cell across the whole
    // workbook made a single approval take several minutes and time out once
    // the ERD tabs were added.
    SpreadsheetApp.getActive().getSheets().forEach(function(candidate) {
      if (candidate.getLastRow() <= 1 || candidate.getLastColumn() <= 0) return;
      const headers = candidate.getRange(1, 1, 1, candidate.getLastColumn()).getDisplayValues()[0]
        .map(function(value) { return String(value || '').trim(); });
      headers.forEach(function(header, index) {
        if (candidateHeaders.indexOf(header) === -1) return;
        candidate.getRange(2, index + 1, candidate.getLastRow() - 1, 1)
          .getDisplayValues()
          .forEach(function(values) {
            const match = String(values[0] || '').trim().match(pattern);
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
