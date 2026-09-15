/**
 * Google Apps Script for the "Response đăng ký" spreadsheet.
 *
 * Required Script Properties:
 * - BACKEND_BASE_URL=https://your-backend.example.com/api
 * - GOOGLE_SHEETS_SYNC_SECRET=<same value as backend .env>
 *
 * Install the on-form-submit and on-edit triggers by running
 * installStudentSyncTriggers() once from the Apps Script editor.
 */

const STUDENT_SHEETS = Object.freeze({
  'Đăng ký tư vấn tâm lý học đường – Dành cho học sinh THCS': 'THCS',
  'Đăng ký tư vấn tâm lý học đường – Dành cho học sinh THPT': 'THPT',
});

const STUDENT_STATUS_HEADER = 'Trạng thái';
const STUDENT_STATUS_ACTIVE_LABEL = 'Đang hoạt động';
const STUDENT_STATUS_INACTIVE_LABEL = 'Ngừng theo dõi';

/**
 * Run once to add the Sheet-side soft-delete control to both student tabs.
 * Existing student rows are initialized as active; blank/formatted rows remain blank.
 */
function setupStudentStatusColumns() {
  const spreadsheet = SpreadsheetApp.getActive();
  Object.keys(STUDENT_SHEETS).forEach((sheetName) => {
    const sheet = spreadsheet.getSheetByName(sheetName);
    if (!sheet) throw new Error(`Không tìm thấy tab: ${sheetName}`);

    const previousLastColumn = sheet.getLastColumn();
    const headers = sheet.getRange(1, 1, 1, previousLastColumn).getDisplayValues()[0]
      .map((header) => optionalText_(header));
    let statusColumn = headers.indexOf(STUDENT_STATUS_HEADER) + 1;
    if (!statusColumn) {
      statusColumn = previousLastColumn + 1;
      sheet.getRange(1, previousLastColumn)
        .copyTo(sheet.getRange(1, statusColumn), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
      sheet.getRange(1, statusColumn).setValue(STUDENT_STATUS_HEADER);
    }

    const validation = SpreadsheetApp.newDataValidation()
      .requireValueInList([STUDENT_STATUS_ACTIVE_LABEL, STUDENT_STATUS_INACTIVE_LABEL], true)
      .setAllowInvalid(false)
      .setHelpText('Chọn "Ngừng theo dõi" để ẩn học sinh khỏi Web nhưng vẫn giữ dữ liệu trong database.')
      .build();
    sheet.getRange(2, statusColumn, Math.max(sheet.getMaxRows() - 1, 1), 1)
      .setDataValidation(validation);
    sheet.getRange(1, statusColumn).setNote(
      'Không xóa dòng. Chọn "Ngừng theo dõi" để ẩn hồ sơ khỏi Web và soft delete trong database.',
    );
    sheet.setColumnWidth(statusColumn, 170);

    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) return;

    const currentHeaders = sheet.getRange(1, 1, 1, statusColumn).getDisplayValues()[0]
      .map((header) => optionalText_(header));
    const firstNameIndex = currentHeaders.indexOf('Tên (học sinh)');
    const lastNameIndex = currentHeaders.indexOf('Họ (học sinh)');
    const phoneIndex = currentHeaders.indexOf('Số điện thoại liên hệ');
    if ([firstNameIndex, lastNameIndex, phoneIndex].some((index) => index < 0)) {
      throw new Error(`Tab ${sheetName} thiếu cột họ, tên hoặc số điện thoại.`);
    }

    const rows = sheet.getRange(2, 1, lastRow - 1, statusColumn).getValues();
    const statuses = rows.map((row) => {
      const currentStatus = optionalText_(row[statusColumn - 1]);
      const isStudent = optionalText_(row[firstNameIndex])
        && optionalText_(row[lastNameIndex])
        && optionalText_(row[phoneIndex]);
      return [currentStatus || (isStudent ? STUDENT_STATUS_ACTIVE_LABEL : '')];
    });
    sheet.getRange(2, statusColumn, statuses.length, 1).setValues(statuses);
  });
}

function installStudentSyncTriggers() {
  const spreadsheet = SpreadsheetApp.getActive();
  ScriptApp.getProjectTriggers()
    .filter((trigger) => ['handleStudentFormSubmit', 'handleStudentEdit'].includes(trigger.getHandlerFunction()))
    .forEach((trigger) => ScriptApp.deleteTrigger(trigger));

  ScriptApp.newTrigger('handleStudentFormSubmit')
    .forSpreadsheet(spreadsheet)
    .onFormSubmit()
    .create();
  ScriptApp.newTrigger('handleStudentEdit')
    .forSpreadsheet(spreadsheet)
    .onEdit()
    .create();
}

function handleStudentFormSubmit(event) {
  if (!event || !event.range) throw new Error('Thiếu dữ liệu sự kiện gửi Google Form.');
  syncStudentRow_(event.range.getSheet(), event.range.getRow());
}

function handleStudentEdit(event) {
  if (!event || !event.range || event.range.getRow() <= 1) return;
  const sheet = event.range.getSheet();
  if (!STUDENT_SHEETS[sheet.getName()]) return;
  const firstRow = event.range.getRow();
  const lastRow = firstRow + event.range.getNumRows() - 1;
  for (let row = firstRow; row <= lastRow; row += 1) syncStudentRow_(sheet, row);
}

function syncAllStudents() {
  const spreadsheet = SpreadsheetApp.getActive();
  let syncedCount = 0;
  let skippedCount = 0;
  Object.keys(STUDENT_SHEETS).forEach((sheetName) => {
    const sheet = spreadsheet.getSheetByName(sheetName);
    if (!sheet) throw new Error(`Không tìm thấy tab: ${sheetName}`);
    for (let row = 2; row <= sheet.getLastRow(); row += 1) {
      if (syncStudentRow_(sheet, row)) syncedCount += 1;
      else skippedCount += 1;
    }
  });
  console.log(`Đồng bộ hoàn tất: ${syncedCount} dòng, bỏ qua ${skippedCount} dòng trống/chưa đủ dữ liệu.`);
}

function syncStudentRow_(sheet, rowNumber) {
  const schoolLevel = STUDENT_SHEETS[sheet.getName()];
  if (!schoolLevel) return;

  const columnCount = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, columnCount).getDisplayValues()[0];
  const values = sheet.getRange(rowNumber, 1, 1, columnCount).getValues()[0];
  const row = Object.fromEntries(headers.map((header, index) => [String(header).trim(), values[index]]));

  if (!values.some((value) => optionalText_(value))) return false;

  const firstName = optionalText_(row['Tên (học sinh)']);
  const lastName = optionalText_(row['Họ (học sinh)']);
  const phoneNumber = optionalText_(row['Số điện thoại liên hệ']);
  if (!firstName || !lastName || !phoneNumber) {
    console.log(`Bỏ qua dòng ${rowNumber} trong tab ${sheet.getName()}: chưa đủ họ, tên hoặc số điện thoại.`);
    return false;
  }
  const directEmail = optionalText_(row['Email nhận thông tin']);
  const responseEmail = optionalText_(row['Email Address']);

  postStudent_({
    firstName,
    lastName,
    gender: normalizeGender_(row['Giới tính']),
    phoneNumber,
    email: directEmail || responseEmail || null,
    dateOfBirth: normalizeDate_(row['Ngày sinh']),
    status: normalizeStudentStatus_(row[STUDENT_STATUS_HEADER]),
    schoolLevel,
    schoolName: optionalText_(row['Tên trường']) || null,
  });
  return true;
}

function postStudent_(payload) {
  const properties = PropertiesService.getScriptProperties();
  const baseUrl = requiredText_(properties.getProperty('BACKEND_BASE_URL'), 'BACKEND_BASE_URL');
  const secret = requiredText_(properties.getProperty('GOOGLE_SHEETS_SYNC_SECRET'), 'GOOGLE_SHEETS_SYNC_SECRET');
  const response = UrlFetchApp.fetch(`${baseUrl.replace(/\/$/, '')}/integrations/google-sheets/students`, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: `Bearer ${secret}` },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  const status = response.getResponseCode();
  if (status < 200 || status >= 300) {
    throw new Error(`Backend trả về HTTP ${status}. Kiểm tra Executions trong Apps Script để xử lý.`);
  }
}

function normalizeGender_(value) {
  const normalized = optionalText_(value).toLocaleLowerCase('vi-VN');
  if (normalized === 'nam') return 'MALE';
  if (normalized === 'nữ' || normalized === 'nu') return 'FEMALE';
  if (!normalized) return null;
  return 'OTHER';
}

function normalizeDate_(value) {
  if (!value) return null;
  if (Object.prototype.toString.call(value) === '[object Date]' && !Number.isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  const text = optionalText_(value);
  const match = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  return match ? `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}` : text;
}

function normalizeStudentStatus_(value) {
  const normalized = optionalText_(value).toLocaleLowerCase('vi-VN');
  if (normalized === STUDENT_STATUS_INACTIVE_LABEL.toLocaleLowerCase('vi-VN') || normalized === 'inactive') {
    return 'INACTIVE';
  }
  return 'ACTIVE';
}

function optionalText_(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function requiredText_(value, fieldName) {
  const text = optionalText_(value);
  if (!text) throw new Error(`Thiếu cấu hình hoặc dữ liệu bắt buộc: ${fieldName}`);
  return text;
}
