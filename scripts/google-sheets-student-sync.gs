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
const STUDENT_MANAGEMENT_SHEETS = Object.freeze({
  students_THCS: 'THCS',
  students_THPT: 'THPT',
});

const STUDENT_STATUS_HEADER = 'Trạng thái';
const STUDENT_STATUS_ACTIVE_LABEL = 'Đang hoạt động';
const STUDENT_STATUS_COMPLETED_LABEL = 'Đã hoàn thành';
const STUDENT_STATUS_INACTIVE_LABEL = 'Ngừng theo dõi';
const STUDENT_EXTERNAL_ID_HEADER = 'Mã học sinh';
const STUDENT_ASSIGNED_COUNSELOR_HEADER = 'Tư vấn viên phụ trách';
const STUDENT_SYNC_STATUS_HEADER = 'Trạng thái đồng bộ';
const STUDENT_PARENT_PHONE_ENTITY_HEADER = 'parent_phone_number';
const STUDENT_PARENT_EMAIL_ENTITY_HEADER = 'parent_email';

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
      .requireValueInList([
        STUDENT_STATUS_ACTIVE_LABEL,
        STUDENT_STATUS_COMPLETED_LABEL,
        STUDENT_STATUS_INACTIVE_LABEL,
      ], true)
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
  setupStudentParentContactColumns_();
}

function installStudentSyncTriggers() {
  installMvpSyncTriggers();
}

function handleStudentFormSubmit(event) {
  if (!event || !event.range) throw new Error('Thiếu dữ liệu sự kiện gửi Google Form.');
  syncStudentRow_(event.range.getSheet(), event.range.getRow());
}

function handleStudentEdit(event) {
  if (!event || !event.range || event.range.getRow() <= 1) return;
  const sheet = event.range.getSheet();
  const firstRow = event.range.getRow();
  const lastRow = firstRow + event.range.getNumRows() - 1;
  if (STUDENT_SHEETS[sheet.getName()]) {
    for (let row = firstRow; row <= lastRow; row += 1) syncStudentRow_(sheet, row);
    return;
  }
  if (STUDENT_MANAGEMENT_SHEETS[sheet.getName()]) {
    for (let row = firstRow; row <= lastRow; row += 1) syncStudentManagementRow_(sheet, row);
  }
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
  mvpRefreshStudentLevelSheets_();
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
  const parentPhoneNumber = firstStudentValue_(row, [
    'Số điện thoại phụ huynh',
    'Số điện thoại người giám hộ',
    'SĐT phụ huynh',
    'Liên hệ phụ huynh - SĐT',
    STUDENT_PARENT_PHONE_ENTITY_HEADER,
  ]);
  const parentEmail = firstStudentValue_(row, [
    'Email phụ huynh',
    'Email người giám hộ',
    'Liên hệ phụ huynh - Email',
    STUDENT_PARENT_EMAIL_ENTITY_HEADER,
  ]);
  const externalStudentId = optionalText_(
    row[STUDENT_EXTERNAL_ID_HEADER] || row.student_id || row['Student ID'],
  ) || mvpEnsureExternalId_(sheet, rowNumber, STUDENT_EXTERNAL_ID_HEADER, 'HS');
  const normalizedStatus = normalizeStudentStatus_(row[STUDENT_STATUS_HEADER]);

  if (!optionalText_(row[STUDENT_STATUS_HEADER])) {
    mvpSetCellByHeader_(sheet, rowNumber, STUDENT_STATUS_HEADER, STUDENT_STATUS_ACTIVE_LABEL);
  }

  try {
    const payload = {
      externalStudentId,
      firstName,
      lastName,
      gender: normalizeGender_(row['Giới tính']),
      phoneNumber,
      email: directEmail || responseEmail || null,
      parentPhoneNumber: parentPhoneNumber || null,
      parentEmail: parentEmail || null,
      dateOfBirth: normalizeDate_(row['Ngày sinh']),
      status: normalizedStatus,
      schoolLevel,
      schoolName: optionalText_(row['Tên trường']) || null,
    };
    const result = postStudent_(payload);
    const counselorExternalId = optionalText_(
      result && result.student && result.student.assignedCounselorExternalId,
    );
    mvpSetCellByHeader_(
      sheet,
      rowNumber,
      STUDENT_ASSIGNED_COUNSELOR_HEADER,
      counselorExternalId || 'Chưa phân công',
    );
    mvpSetCellByHeader_(sheet, rowNumber, STUDENT_SYNC_STATUS_HEADER, mvpSyncTimestamp_('Đã đồng bộ'));
    const entityValues = {
      first_name: firstName,
      last_name: lastName,
      gender: payload.gender,
      phone_number: phoneNumber,
      email: payload.email,
      parent_phone_number: payload.parentPhoneNumber,
      parent_email: payload.parentEmail,
      date_of_birth: payload.dateOfBirth,
      grade_level: optionalText_(row['Lớp/Khối']),
      status: normalizedStatus.toLowerCase(),
      school_name: payload.schoolName,
    };
    mvpUpsertEntityRow_('students', 'student_id', externalStudentId, entityValues);
    mvpUpsertStudentLevelRow_(schoolLevel, externalStudentId, entityValues);
    if (counselorExternalId) {
      mvpUpsertAssignment_(externalStudentId, counselorExternalId, normalizedStatus);
    }
    if (normalizedStatus !== 'ACTIVE') {
      mvpAppendArchive_({
        entityType: 'STUDENT',
        externalId: externalStudentId,
        displayName: `${lastName} ${firstName}`.trim(),
        sourceSheet: sheet.getName(),
        sourceRow: rowNumber,
        previousStatus: normalizedStatus,
        reason: normalizedStatus === 'COMPLETED' ? 'Đã hoàn thành tư vấn' : 'Ngừng theo dõi',
        notes: counselorExternalId ? `Tư vấn viên cuối: ${counselorExternalId}` : '',
      });
    }
    return true;
  } catch (error) {
    mvpSetCellByHeader_(sheet, rowNumber, STUDENT_SYNC_STATUS_HEADER, `Lỗi: ${error.message}`);
    throw error;
  }
}

function syncStudentManagementRow_(sheet, rowNumber) {
  const schoolLevel = STUDENT_MANAGEMENT_SHEETS[sheet.getName()];
  if (!schoolLevel) return false;
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const values = sheet.getRange(rowNumber, 1, 1, sheet.getLastColumn()).getValues()[0];
  const row = Object.fromEntries(headers.map(function(header, index) {
    return [String(header || '').trim(), values[index]];
  }));
  const externalStudentId = optionalText_(row.student_id);
  const firstName = optionalText_(row.first_name);
  const lastName = optionalText_(row.last_name);
  const phoneNumber = optionalText_(row.phone_number);
  if (!externalStudentId || !firstName || !lastName || !phoneNumber) return false;

  const normalizedStatus = normalizeStudentStatus_(row.status);
  const gradeText = optionalText_(row.grade_level);
  const gradeLevel = gradeText ? Number(gradeText) : NaN;
  const payload = {
    externalStudentId,
    firstName,
    lastName,
    gender: normalizeGender_(row.gender),
    phoneNumber,
    email: optionalText_(row.email) || null,
    parentPhoneNumber: optionalText_(row[STUDENT_PARENT_PHONE_ENTITY_HEADER]) || null,
    parentEmail: optionalText_(row[STUDENT_PARENT_EMAIL_ENTITY_HEADER]) || null,
    dateOfBirth: normalizeDate_(row.date_of_birth),
    status: normalizedStatus,
    schoolLevel,
    schoolName: optionalText_(row.school_name) || null,
  };
  postStudent_(payload);
  const entityValues = {
    first_name: firstName,
    last_name: lastName,
    gender: payload.gender,
    phone_number: phoneNumber,
    email: payload.email,
    parent_phone_number: payload.parentPhoneNumber,
    parent_email: payload.parentEmail,
    date_of_birth: payload.dateOfBirth,
    grade_level: Number.isFinite(gradeLevel) ? gradeLevel : '',
    status: normalizedStatus.toLowerCase(),
    school_id: optionalText_(row.school_id),
    school_name: payload.schoolName,
    address_id: optionalText_(row.address_id),
  };
  mvpUpsertEntityRow_('students', 'student_id', externalStudentId, entityValues);
  mvpUpsertEntityRow_(sheet.getName(), 'student_id', externalStudentId, Object.assign({}, entityValues, {
    status: mvpStudentStatusLabel_(normalizedStatus),
  }));
  return true;
}

function postStudent_(payload) {
  const properties = PropertiesService.getScriptProperties();
  const baseUrl = requiredText_(
    properties.getProperty('BACKEND_SYNC_BASE_URL') || properties.getProperty('BACKEND_BASE_URL'),
    'BACKEND_SYNC_BASE_URL/BACKEND_BASE_URL',
  ).replace(/\/$/, '');
  const secret = requiredText_(properties.getProperty('GOOGLE_SHEETS_SYNC_SECRET'), 'GOOGLE_SHEETS_SYNC_SECRET');
  const endpoint = /\/integrations\/google-sheets$/i.test(baseUrl)
    ? `${baseUrl}/students`
    : `${baseUrl}/integrations/google-sheets/students`;
  const response = UrlFetchApp.fetch(endpoint, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: `Bearer ${secret}` },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  const status = response.getResponseCode();
  if (status < 200 || status >= 300) {
    throw new Error(`Backend trả về HTTP ${status}: ${response.getContentText()}`);
  }
  const text = response.getContentText();
  return text ? JSON.parse(text) : {};
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
  if (normalized === STUDENT_STATUS_COMPLETED_LABEL.toLocaleLowerCase('vi-VN') || normalized === 'completed') {
    return 'COMPLETED';
  }
  if (normalized === STUDENT_STATUS_INACTIVE_LABEL.toLocaleLowerCase('vi-VN') || normalized === 'inactive') {
    return 'INACTIVE';
  }
  return 'ACTIVE';
}

function setupStudentParentContactColumns_() {
  const spreadsheet = SpreadsheetApp.getActive();
  ['students', 'students_THCS', 'students_THPT'].forEach(function(sheetName) {
    const sheet = spreadsheet.getSheetByName(sheetName);
    if (!sheet) return;
    [STUDENT_PARENT_PHONE_ENTITY_HEADER, STUDENT_PARENT_EMAIL_ENTITY_HEADER].forEach(function(header) {
      const width = Math.max(sheet.getLastColumn(), 1);
      const headers = sheet.getRange(1, 1, 1, width).getDisplayValues()[0]
        .map(function(value) { return optionalText_(value); });
      if (headers.indexOf(header) >= 0) return;
      const targetColumn = width + 1;
      sheet.getRange(1, width)
        .copyTo(sheet.getRange(1, targetColumn), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
      sheet.getRange(1, targetColumn).setValue(header);
    });
  });
}

function firstStudentValue_(row, headers) {
  for (let index = 0; index < headers.length; index += 1) {
    const value = optionalText_(row[headers[index]]);
    if (value) return value;
  }
  return '';
}

function optionalText_(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function requiredText_(value, fieldName) {
  const text = optionalText_(value);
  if (!text) throw new Error(`Thiếu cấu hình hoặc dữ liệu bắt buộc: ${fieldName}`);
  return text;
}
