/**
 * Synchronizes the current Student-Counselor relationship from the
 * `counselor_assignments` entity tab to the backend.
 *
 * Required Script Properties:
 * - BACKEND_SYNC_BASE_URL=https://your-backend.example.com/api/integrations/google-sheets
 *   OR BACKEND_BASE_URL=https://your-backend.example.com/api
 * - GOOGLE_SHEETS_SYNC_SECRET=<same value as backend>
 *
 * Run installAssignmentSyncTriggers() once, then run syncAllAssignments()
 * once for the initial import.
 */

const ASSIGNMENT_SYNC_SHEET_NAMES_ = Object.freeze([
  'counselor_assignments',
  'counselor assignments',
]);

function installAssignmentSyncTriggers() {
  const spreadsheet = SpreadsheetApp.getActive();
  ScriptApp.getProjectTriggers()
    .filter((trigger) => trigger.getHandlerFunction() === 'handleAssignmentEdit')
    .forEach((trigger) => ScriptApp.deleteTrigger(trigger));

  ScriptApp.newTrigger('handleAssignmentEdit')
    .forSpreadsheet(spreadsheet)
    .onEdit()
    .create();
}

function handleAssignmentEdit(event) {
  if (!event || !event.range || event.range.getRow() <= 1) return;
  const sheet = event.range.getSheet();
  if (!isAssignmentSheet_(sheet.getName())) return;

  const firstRow = event.range.getRow();
  const lastRow = firstRow + event.range.getNumRows() - 1;
  for (let row = firstRow; row <= lastRow; row += 1) {
    syncAssignmentRow_(sheet, row);
  }
}

function syncAllAssignments() {
  const spreadsheet = SpreadsheetApp.getActive();
  const sheet = spreadsheet.getSheets().find((candidate) => isAssignmentSheet_(candidate.getName()));
  if (!sheet) throw new Error('Không tìm thấy tab counselor_assignments.');

  let synced = 0;
  for (let row = 2; row <= sheet.getLastRow(); row += 1) {
    if (syncAssignmentRow_(sheet, row)) synced += 1;
  }
  console.log(`Đã đồng bộ ${synced} dòng phân công.`);
}

function syncAssignmentRow_(sheet, rowNumber) {
  const row = assignmentReadRow_(sheet, rowNumber);
  const externalStudentId = assignmentText_(row.student_id || row['Student ID']);
  const externalCounselorId = assignmentText_(row.counselor_id || row['Counselor ID']);
  if (!externalStudentId || !externalCounselorId) return false;

  const spreadsheet = sheet.getParent();
  const student = assignmentFindEntity_(spreadsheet, 'students', 'student_id', externalStudentId);
  const counselor = assignmentFindEntity_(spreadsheet, 'counselors', 'counselor_id', externalCounselorId);
  if (!student) throw new Error(`Không tìm thấy student_id ${externalStudentId} trong tab students.`);
  if (!counselor) throw new Error(`Không tìm thấy counselor_id ${externalCounselorId} trong tab counselors.`);

  const payload = {
    studentEmail: assignmentNull_(student.email),
    studentPhoneNumber: assignmentNull_(student.phone_number),
    counselorEmail: assignmentNull_(counselor.email),
    counselorPhoneNumber: assignmentNull_(counselor.phone_number),
    status: assignmentStatus_(row.status),
    assignedAt: assignmentIsoDate_(row.created_at || row.assigned_at),
    endedAt: assignmentIsoDate_(row.updated_at || row.ended_at),
    caseWeight: assignmentNumber_(row.case_weight),
  };
  Object.keys(payload).forEach((key) => payload[key] === null && delete payload[key]);
  assignmentPost_(payload);
  return true;
}

function assignmentPost_(payload) {
  const properties = PropertiesService.getScriptProperties();
  const configuredBase = assignmentText_(
    properties.getProperty('BACKEND_SYNC_BASE_URL') || properties.getProperty('BACKEND_BASE_URL'),
  ).replace(/\/$/, '');
  const secret = assignmentText_(properties.getProperty('GOOGLE_SHEETS_SYNC_SECRET'));
  if (!configuredBase || !secret) {
    throw new Error('Thiếu BACKEND_SYNC_BASE_URL/BACKEND_BASE_URL hoặc GOOGLE_SHEETS_SYNC_SECRET.');
  }
  const endpoint = /\/integrations\/google-sheets$/i.test(configuredBase)
    ? `${configuredBase}/assignments`
    : `${configuredBase}/integrations/google-sheets/assignments`;
  const response = UrlFetchApp.fetch(endpoint, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: `Bearer ${secret}` },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  const status = response.getResponseCode();
  if (status < 200 || status >= 300) {
    throw new Error(`Backend trả về HTTP ${status} khi đồng bộ phân công.`);
  }
}

function assignmentFindEntity_(spreadsheet, sheetName, idHeader, externalId) {
  const sheet = spreadsheet.getSheets().find(
    (candidate) => assignmentNormalize_(candidate.getName()) === assignmentNormalize_(sheetName),
  );
  if (!sheet || sheet.getLastRow() <= 1) return null;
  const values = sheet.getDataRange().getDisplayValues();
  const headers = values[0].map(assignmentText_);
  const idIndex = headers.findIndex((header) => assignmentNormalize_(header) === assignmentNormalize_(idHeader));
  if (idIndex < 0) return null;
  const row = values.slice(1).find((candidate) => assignmentText_(candidate[idIndex]) === externalId);
  return row ? Object.fromEntries(headers.map((header, index) => [header, row[index]])) : null;
}

function assignmentReadRow_(sheet, rowNumber) {
  const width = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, width).getDisplayValues()[0].map(assignmentText_);
  const values = sheet.getRange(rowNumber, 1, 1, width).getValues()[0];
  return Object.fromEntries(headers.map((header, index) => [header, values[index]]));
}

function isAssignmentSheet_(name) {
  return ASSIGNMENT_SYNC_SHEET_NAMES_.includes(assignmentNormalize_(name));
}

function assignmentStatus_(value) {
  return assignmentNormalize_(value) === 'active' ? 'ACTIVE' : 'INACTIVE';
}

function assignmentIsoDate_(value) {
  if (!value) return null;
  if (Object.prototype.toString.call(value) === '[object Date]' && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function assignmentNumber_(value) {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function assignmentNull_(value) {
  return assignmentText_(value) || null;
}

function assignmentText_(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function assignmentNormalize_(value) {
  return assignmentText_(value).toLocaleLowerCase('vi-VN').replace(/\s+/g, ' ');
}
