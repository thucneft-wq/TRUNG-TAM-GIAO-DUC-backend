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
const STUDENT_PARENT_PHONE_SOURCE_HEADER = 'Số điện thoại phụ huynh';
const STUDENT_PARENT_EMAIL_SOURCE_HEADER = 'Email phụ huynh';
const STUDENT_PARENT_PHONE_ENTITY_HEADER = 'parent_phone_number';
const STUDENT_PARENT_EMAIL_ENTITY_HEADER = 'parent_email';
const STUDENT_PARENT_ID_ENTITY_HEADER = 'parent_id';
const STUDENT_PARENT_SHEET_ = 'parents';
const STUDENT_PARENT_LINK_SHEET_ = 'student_parents';
const PARENT_STUDENT_IDS_HEADER_ = 'student_ids';
const PARENT_STUDENT_NAMES_HEADER_ = 'student_names';
const STUDENT_DELETION_SNAPSHOT_SHEET_ = '_student_deletion_snapshot';

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
  studentRefreshDeletionSnapshot_();
}

function installStudentSyncTriggers() {
  installMvpSyncTriggers();
}

/**
 * Run once after adding this version to Apps Script. It adds the friendly
 * parent-link columns and backfills the parent mirrors from students_THCS and
 * students_THPT. The normalized relationship remains in student_parents.
 */
function setupStudentParentSync() {
  setupStudentParentContactColumns_();
  const spreadsheet = SpreadsheetApp.getActive();
  Object.keys(STUDENT_MANAGEMENT_SHEETS).forEach(function(sheetName) {
    const sheet = spreadsheet.getSheetByName(sheetName);
    if (!sheet) return;
    for (let row = 2; row <= sheet.getLastRow(); row += 1) {
      syncStudentManagementRow_(sheet, row);
    }
  });
  refreshParentStudentLabels_();
  postStudentReconcile_(studentAllCurrentIds_());
  studentRefreshDeletionSnapshot_();
  console.log('Đã liên kết và đồng bộ parents với students_THCS/students_THPT.');
}

function handleStudentFormSubmit(event) {
  if (!event || !event.range) throw new Error('Thiếu dữ liệu sự kiện gửi Google Form.');
  syncStudentRow_(event.range.getSheet(), event.range.getRow());
  studentRefreshDeletionSnapshot_();
}

function handleStudentEdit(event) {
  if (!event || !event.range || event.range.getRow() <= 1) return;
  const sheet = event.range.getSheet();
  const firstRow = event.range.getRow();
  const lastRow = firstRow + event.range.getNumRows() - 1;
  if (STUDENT_SHEETS[sheet.getName()]) {
    for (let row = firstRow; row <= lastRow; row += 1) syncStudentRow_(sheet, row);
    studentRefreshDeletionSnapshot_();
    return;
  }
  if (STUDENT_MANAGEMENT_SHEETS[sheet.getName()]) {
    for (let row = firstRow; row <= lastRow; row += 1) syncStudentManagementRow_(sheet, row);
    studentRefreshDeletionSnapshot_();
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
  studentRefreshDeletionSnapshot_();
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
    STUDENT_PARENT_PHONE_SOURCE_HEADER,
    'Số điện thoại người giám hộ',
    'Số điện thoại phụ huynh/người liên hệ khẩn cấp',
    'Số điện thoại phụ huynh/người giám hộ',
    'Số điện thoại của phụ huynh/người giám hộ',
    'Số điện thoại liên hệ phụ huynh/người giám hộ',
    'SĐT phụ huynh',
    'SĐT phụ huynh/người giám hộ',
    'Liên hệ phụ huynh - SĐT',
    STUDENT_PARENT_PHONE_ENTITY_HEADER,
  ]);
  const parentEmail = firstStudentValue_(row, [
    STUDENT_PARENT_EMAIL_SOURCE_HEADER,
    'Email người giám hộ',
    'Email phụ huynh/người giám hộ',
    'Email của phụ huynh/người giám hộ',
    'Gmail phụ huynh',
    'Gmail phụ huynh/người giám hộ',
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
    const parentId = syncPrimaryParentSheetRecord_(
      externalStudentId,
      `${lastName} ${firstName}`.trim(),
      payload.parentPhoneNumber,
      payload.parentEmail,
      optionalText_(row[STUDENT_PARENT_ID_ENTITY_HEADER]),
    );
    entityValues.parent_id = parentId;
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

function syncStudentManagementRow_(sheet, rowNumber, skipParentMirror) {
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
  const parentId = skipParentMirror
    ? optionalText_(row[STUDENT_PARENT_ID_ENTITY_HEADER])
    : syncPrimaryParentSheetRecord_(
      externalStudentId,
      `${lastName} ${firstName}`.trim(),
      payload.parentPhoneNumber,
      payload.parentEmail,
      optionalText_(row[STUDENT_PARENT_ID_ENTITY_HEADER]),
    );
  const entityValues = {
    first_name: firstName,
    last_name: lastName,
    gender: payload.gender,
    phone_number: phoneNumber,
    email: payload.email,
    parent_phone_number: payload.parentPhoneNumber,
    parent_email: payload.parentEmail,
    parent_id: parentId,
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
  Object.keys(STUDENT_SHEETS).forEach(function(sheetName) {
    const sheet = spreadsheet.getSheetByName(sheetName);
    if (!sheet) return;
    [STUDENT_PARENT_PHONE_SOURCE_HEADER, STUDENT_PARENT_EMAIL_SOURCE_HEADER].forEach(function(header) {
      ensureStudentColumn_(sheet, header);
    });
  });

  ['students', 'students_THCS', 'students_THPT'].forEach(function(sheetName) {
    const sheet = spreadsheet.getSheetByName(sheetName);
    if (!sheet) return;
    [
      STUDENT_PARENT_PHONE_ENTITY_HEADER,
      STUDENT_PARENT_EMAIL_ENTITY_HEADER,
      STUDENT_PARENT_ID_ENTITY_HEADER,
    ].forEach(function(header) {
      ensureStudentColumn_(sheet, header);
    });
  });

  const parentSheet = spreadsheet.getSheetByName(STUDENT_PARENT_SHEET_);
  if (!parentSheet) throw new Error(`Không tìm thấy tab ${STUDENT_PARENT_SHEET_}.`);
  [PARENT_STUDENT_IDS_HEADER_, PARENT_STUDENT_NAMES_HEADER_].forEach(function(header) {
    ensureStudentColumn_(parentSheet, header);
  });

  const linkSheet = spreadsheet.getSheetByName(STUDENT_PARENT_LINK_SHEET_);
  if (!linkSheet) throw new Error(`Không tìm thấy tab ${STUDENT_PARENT_LINK_SHEET_}.`);
}

function handleParentEdit(event) {
  if (!event || !event.range || event.range.getRow() <= 1) return;
  const sheet = event.range.getSheet();
  if (sheet.getName() !== STUDENT_PARENT_SHEET_) return;
  const firstRow = event.range.getRow();
  const lastRow = firstRow + event.range.getNumRows() - 1;
  for (let row = firstRow; row <= lastRow; row += 1) syncParentRow_(sheet, row);
}

function syncParentRow_(sheet, rowNumber) {
  const row = studentRowObject_(sheet, rowNumber);
  const parentId = optionalText_(row.parent_id);
  if (!parentId) return false;

  const studentIds = linkedStudentIdsForParent_(parentId);
  studentIds.forEach(function(studentId) {
    ['students', 'students_THCS', 'students_THPT'].forEach(function(sheetName) {
      const studentSheet = SpreadsheetApp.getActive().getSheetByName(sheetName);
      if (!studentSheet) return;
      const studentRowNumber = findStudentRowByExternalId_(studentSheet, studentId);
      if (!studentRowNumber) return;
      setStudentCellIfPresent_(studentSheet, studentRowNumber, STUDENT_PARENT_ID_ENTITY_HEADER, parentId);
      setStudentCellIfPresent_(studentSheet, studentRowNumber, STUDENT_PARENT_PHONE_ENTITY_HEADER, optionalText_(row.phone_number));
      setStudentCellIfPresent_(studentSheet, studentRowNumber, STUDENT_PARENT_EMAIL_ENTITY_HEADER, optionalText_(row.email));
      if (STUDENT_MANAGEMENT_SHEETS[sheetName]) {
        syncStudentManagementRow_(studentSheet, studentRowNumber, true);
      }
    });
  });
  refreshParentStudentLabels_();
  return true;
}

function syncPrimaryParentSheetRecord_(externalStudentId, studentName, phoneNumber, email, preferredParentId) {
  const spreadsheet = SpreadsheetApp.getActive();
  const parentSheet = spreadsheet.getSheetByName(STUDENT_PARENT_SHEET_);
  const linkSheet = spreadsheet.getSheetByName(STUDENT_PARENT_LINK_SHEET_);
  if (!parentSheet || !linkSheet) return '';

  let parentId = parentIdLinkedToStudent_(externalStudentId);
  if (!parentId && preferredParentId) parentId = preferredParentId;
  if (!parentId && (phoneNumber || email)) parentId = findParentIdByContact_(phoneNumber, email);
  if (!parentId && (phoneNumber || email)) parentId = nextSheetEntityId_(parentSheet, 'parent_id', 'PH');
  if (!parentId) return '';

  const existingParentRow = findEntityRow_(parentSheet, 'parent_id', parentId);
  const parentValues = {
    phone_number: phoneNumber || '',
    email: email || '',
    status: 'active',
  };
  if (!existingParentRow) {
    parentValues.first_name = 'Phụ huynh';
    parentValues.last_name = studentName || externalStudentId;
  }
  mvpUpsertEntityRow_(STUDENT_PARENT_SHEET_, 'parent_id', parentId, parentValues);

  let linkRow = findStudentParentLinkRow_(externalStudentId, parentId);
  if (!linkRow) {
    const linkId = nextSheetEntityId_(linkSheet, 'student_parent_id', 'PHHS');
    mvpUpsertEntityRow_(STUDENT_PARENT_LINK_SHEET_, 'student_parent_id', linkId, {
      student_id: externalStudentId,
      parent_id: parentId,
      relationship: 'Phụ huynh',
      is_primary: true,
    });
    linkRow = findStudentParentLinkRow_(externalStudentId, parentId);
  } else {
    setStudentCellIfPresent_(linkSheet, linkRow, 'is_primary', true);
  }
  propagateParentContactToStudentSheets_(parentId, phoneNumber, email);
  refreshParentStudentLabels_();
  return parentId;
}

function propagateParentContactToStudentSheets_(parentId, phoneNumber, email) {
  const spreadsheet = SpreadsheetApp.getActive();
  linkedStudentIdsForParent_(parentId).forEach(function(studentId) {
    ['students', 'students_THCS', 'students_THPT'].forEach(function(sheetName) {
      const sheet = spreadsheet.getSheetByName(sheetName);
      if (!sheet) return;
      const rowNumber = findStudentRowByExternalId_(sheet, studentId);
      if (!rowNumber) return;
      setStudentCellIfPresent_(sheet, rowNumber, STUDENT_PARENT_ID_ENTITY_HEADER, parentId);
      setStudentCellIfPresent_(sheet, rowNumber, STUDENT_PARENT_PHONE_ENTITY_HEADER, phoneNumber);
      setStudentCellIfPresent_(sheet, rowNumber, STUDENT_PARENT_EMAIL_ENTITY_HEADER, email);
    });
  });
}

function parentIdLinkedToStudent_(studentId) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(STUDENT_PARENT_LINK_SHEET_);
  if (!sheet || sheet.getLastRow() <= 1) return '';
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0]
    .map(function(value) { return optionalText_(value); });
  const studentIndex = headers.indexOf('student_id');
  const parentIndex = headers.indexOf('parent_id');
  const primaryIndex = headers.indexOf('is_primary');
  if (studentIndex < 0 || parentIndex < 0) return '';
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getDisplayValues();
  const matches = rows.filter(function(row) { return optionalText_(row[studentIndex]) === studentId; });
  matches.sort(function(left, right) {
    const leftPrimary = primaryIndex >= 0 && isTruthySheetValue_(left[primaryIndex]);
    const rightPrimary = primaryIndex >= 0 && isTruthySheetValue_(right[primaryIndex]);
    return Number(rightPrimary) - Number(leftPrimary);
  });
  return matches.length ? optionalText_(matches[0][parentIndex]) : '';
}

function linkedStudentIdsForParent_(parentId) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(STUDENT_PARENT_LINK_SHEET_);
  if (!sheet || sheet.getLastRow() <= 1) return [];
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0]
    .map(function(value) { return optionalText_(value); });
  const studentIndex = headers.indexOf('student_id');
  const parentIndex = headers.indexOf('parent_id');
  if (studentIndex < 0 || parentIndex < 0) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getDisplayValues()
    .filter(function(row) { return optionalText_(row[parentIndex]) === parentId; })
    .map(function(row) { return optionalText_(row[studentIndex]); })
    .filter(Boolean);
}

function findParentIdByContact_(phoneNumber, email) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(STUDENT_PARENT_SHEET_);
  if (!sheet || sheet.getLastRow() <= 1) return '';
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0]
    .map(function(value) { return optionalText_(value); });
  const idIndex = headers.indexOf('parent_id');
  const phoneIndex = headers.indexOf('phone_number');
  const emailIndex = headers.indexOf('email');
  const normalizedEmail = optionalText_(email).toLowerCase();
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getDisplayValues();
  const matched = rows.find(function(row) {
    return (phoneNumber && phoneIndex >= 0 && optionalText_(row[phoneIndex]) === phoneNumber)
      || (normalizedEmail && emailIndex >= 0 && optionalText_(row[emailIndex]).toLowerCase() === normalizedEmail);
  });
  return matched && idIndex >= 0 ? optionalText_(matched[idIndex]) : '';
}

function findStudentParentLinkRow_(studentId, parentId) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(STUDENT_PARENT_LINK_SHEET_);
  if (!sheet || sheet.getLastRow() <= 1) return 0;
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0]
    .map(function(value) { return optionalText_(value); });
  const studentIndex = headers.indexOf('student_id');
  const parentIndex = headers.indexOf('parent_id');
  if (studentIndex < 0 || parentIndex < 0) return 0;
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getDisplayValues();
  const index = rows.findIndex(function(row) {
    return optionalText_(row[studentIndex]) === studentId && optionalText_(row[parentIndex]) === parentId;
  });
  return index < 0 ? 0 : index + 2;
}

function refreshParentStudentLabels_() {
  const spreadsheet = SpreadsheetApp.getActive();
  const parentSheet = spreadsheet.getSheetByName(STUDENT_PARENT_SHEET_);
  if (!parentSheet || parentSheet.getLastRow() <= 1) return;
  const headers = parentSheet.getRange(1, 1, 1, parentSheet.getLastColumn()).getDisplayValues()[0]
    .map(function(value) { return optionalText_(value); });
  const idIndex = headers.indexOf('parent_id');
  const idsIndex = headers.indexOf(PARENT_STUDENT_IDS_HEADER_);
  const namesIndex = headers.indexOf(PARENT_STUDENT_NAMES_HEADER_);
  if (idIndex < 0 || idsIndex < 0 || namesIndex < 0) return;
  const rows = parentSheet.getRange(2, 1, parentSheet.getLastRow() - 1, parentSheet.getLastColumn()).getValues();
  rows.forEach(function(row, index) {
    const parentId = optionalText_(row[idIndex]);
    if (!parentId) return;
    const studentIds = linkedStudentIdsForParent_(parentId);
    const names = studentIds.map(function(studentId) { return studentNameByExternalId_(studentId); }).filter(Boolean);
    parentSheet.getRange(index + 2, idsIndex + 1).setValue(studentIds.join(', '));
    parentSheet.getRange(index + 2, namesIndex + 1).setValue(names.join(', '));
  });
}

function studentNameByExternalId_(studentId) {
  const spreadsheet = SpreadsheetApp.getActive();
  const sheetNames = ['students_THCS', 'students_THPT', 'students'];
  for (let index = 0; index < sheetNames.length; index += 1) {
    const sheet = spreadsheet.getSheetByName(sheetNames[index]);
    const rowNumber = sheet ? findStudentRowByExternalId_(sheet, studentId) : 0;
    if (!rowNumber) continue;
    const row = studentRowObject_(sheet, rowNumber);
    return `${optionalText_(row.last_name)} ${optionalText_(row.first_name)}`.trim();
  }
  return '';
}

function findStudentRowByExternalId_(sheet, studentId) {
  return findEntityRow_(sheet, 'student_id', studentId);
}

function findEntityRow_(sheet, idHeader, idValue) {
  if (!sheet || sheet.getLastRow() <= 1) return 0;
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0]
    .map(function(value) { return optionalText_(value); });
  const idIndex = headers.indexOf(idHeader);
  if (idIndex < 0) return 0;
  const ids = sheet.getRange(2, idIndex + 1, sheet.getLastRow() - 1, 1).getDisplayValues().flat();
  const index = ids.findIndex(function(value) { return optionalText_(value) === idValue; });
  return index < 0 ? 0 : index + 2;
}

function studentRowObject_(sheet, rowNumber) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const values = sheet.getRange(rowNumber, 1, 1, sheet.getLastColumn()).getValues()[0];
  return Object.fromEntries(headers.map(function(header, index) {
    return [optionalText_(header), values[index]];
  }));
}

function setStudentCellIfPresent_(sheet, rowNumber, header, value) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0]
    .map(function(item) { return optionalText_(item); });
  const index = headers.indexOf(header);
  if (index >= 0) sheet.getRange(rowNumber, index + 1).setValue(value || '');
}

function nextSheetEntityId_(sheet, idHeader, prefix) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0]
    .map(function(value) { return optionalText_(value); });
  const idIndex = headers.indexOf(idHeader);
  if (idIndex < 0) throw new Error(`Tab ${sheet.getName()} thiếu cột ${idHeader}.`);
  const values = sheet.getLastRow() > 1
    ? sheet.getRange(2, idIndex + 1, sheet.getLastRow() - 1, 1).getDisplayValues().flat()
    : [];
  const pattern = new RegExp('^' + prefix + '-([0-9]+)$', 'i');
  const maximum = values.reduce(function(current, value) {
    const match = optionalText_(value).match(pattern);
    return match ? Math.max(current, Number(match[1])) : current;
  }, 0);
  return `${prefix}-${String(maximum + 1).padStart(2, '0')}`;
}

function isTruthySheetValue_(value) {
  const normalized = optionalText_(value).toLowerCase();
  return value === true || normalized === 'true' || normalized === '1' || normalized === 'yes';
}

/** Soft-deactivate exactly the student rows that disappeared from a management tab. */
function studentHandleSheetRowDeletion_() {
  const spreadsheet = SpreadsheetApp.getActive();
  const snapshot = spreadsheet.getSheetByName(STUDENT_DELETION_SNAPSHOT_SHEET_);
  if (!snapshot || snapshot.getLastRow() <= 1) {
    postStudentReconcile_(studentAllCurrentIds_());
    studentRefreshDeletionSnapshot_();
    return;
  }

  const headers = snapshot.getRange(1, 1, 1, snapshot.getLastColumn()).getDisplayValues()[0];
  const entries = snapshot.getRange(2, 1, snapshot.getLastRow() - 1, snapshot.getLastColumn())
    .getValues()
    .map(function(values) {
      return Object.fromEntries(headers.map(function(header, index) { return [header, values[index]]; }));
    });
  const currentIdsBySheet = {};
  Object.keys(STUDENT_MANAGEMENT_SHEETS).forEach(function(sheetName) {
    currentIdsBySheet[sheetName] = studentCurrentIdsForSheet_(sheetName);
  });

  entries.forEach(function(entry) {
    const sourceSheet = optionalText_(entry.source_sheet);
    const externalId = optionalText_(entry.external_student_id);
    if (!externalId || !currentIdsBySheet[sourceSheet]) return;
    if (currentIdsBySheet[sourceSheet].indexOf(externalId.toUpperCase()) !== -1) return;
    studentDeactivateSnapshotEntry_(entry, sourceSheet, 'Xóa dòng trên Sheet - tự động ngừng hoạt động');
  });
  postStudentReconcile_(studentAllCurrentIds_());
  studentRefreshDeletionSnapshot_();
}

/**
 * One-time cleanup: students marked ACTIVE in the entity tab but absent from
 * both official management tabs are soft-deactivated in the database.
 */
function reconcileActiveStudentsFromManagementSheets() {
  const spreadsheet = SpreadsheetApp.getActive();
  const entitySheet = spreadsheet.getSheetByName('students');
  if (!entitySheet || entitySheet.getLastRow() <= 1) {
    studentRefreshDeletionSnapshot_();
    return;
  }
  const officialIds = [];
  Object.keys(STUDENT_MANAGEMENT_SHEETS).forEach(function(sheetName) {
    studentCurrentIdsForSheet_(sheetName).forEach(function(id) {
      if (officialIds.indexOf(id) === -1) officialIds.push(id);
    });
  });
  const headers = entitySheet.getRange(1, 1, 1, entitySheet.getLastColumn()).getDisplayValues()[0];
  const rows = entitySheet.getRange(2, 1, entitySheet.getLastRow() - 1, entitySheet.getLastColumn()).getValues();
  let deactivated = 0;
  rows.forEach(function(values) {
    const entry = Object.fromEntries(headers.map(function(header, index) { return [header, values[index]]; }));
    const externalId = optionalText_(entry.student_id || entry.external_student_id);
    if (!externalId || officialIds.indexOf(externalId.toUpperCase()) !== -1) return;
    entry.external_student_id = externalId;
    entry.source_sheet = 'students';
    if (studentDeactivateSnapshotEntry_(
      entry,
      'students',
      'Không còn trong Sheet quản lý - tự động ngừng hoạt động',
      true,
    )) deactivated += 1;
  });
  const result = postStudentReconcile_(officialIds);
  studentRefreshDeletionSnapshot_();
  console.log(
    `Đã chuyển ${deactivated + Number(result.deactivatedStudents || 0)} học sinh không còn trên Sheet sang INACTIVE.`,
  );
}

function postStudentReconcile_(activeExternalStudentIds) {
  const properties = PropertiesService.getScriptProperties();
  const baseUrl = requiredText_(
    properties.getProperty('BACKEND_SYNC_BASE_URL') || properties.getProperty('BACKEND_BASE_URL'),
    'BACKEND_SYNC_BASE_URL/BACKEND_BASE_URL',
  ).replace(/\/$/, '');
  const secret = requiredText_(properties.getProperty('GOOGLE_SHEETS_SYNC_SECRET'), 'GOOGLE_SHEETS_SYNC_SECRET');
  const endpoint = /\/integrations\/google-sheets$/i.test(baseUrl)
    ? `${baseUrl}/students/reconcile`
    : `${baseUrl}/integrations/google-sheets/students/reconcile`;
  const response = UrlFetchApp.fetch(endpoint, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: `Bearer ${secret}` },
    payload: JSON.stringify({ activeExternalStudentIds }),
    muteHttpExceptions: true,
  });
  const status = response.getResponseCode();
  if (status < 200 || status >= 300) {
    throw new Error(`Backend reconcile trả về HTTP ${status}: ${response.getContentText()}`);
  }
  const text = response.getContentText();
  return text ? JSON.parse(text) : { deactivatedStudents: 0, closedAssignments: 0 };
}

function studentDeactivateSnapshotEntry_(entry, sourceSheet, reason, forceDeactivate) {
  if (!forceDeactivate && !studentStatusIsActive_(entry.status)) return false;
  const externalId = optionalText_(entry.external_student_id || entry.student_id);
  const firstName = optionalText_(entry.first_name) || 'Học sinh';
  const lastName = optionalText_(entry.last_name) || externalId;
  const phoneNumber = optionalText_(entry.phone_number);
  if (!externalId || !phoneNumber) return false;
  const schoolLevel = optionalText_(entry.school_level)
    || STUDENT_MANAGEMENT_SHEETS[sourceSheet]
    || null;
  const payload = {
    externalStudentId: externalId,
    firstName,
    lastName,
    gender: normalizeGender_(entry.gender),
    phoneNumber,
    email: optionalText_(entry.email) || null,
    parentPhoneNumber: optionalText_(entry.parent_phone_number) || null,
    parentEmail: optionalText_(entry.parent_email) || null,
    dateOfBirth: normalizeDate_(entry.date_of_birth),
    status: 'INACTIVE',
    schoolLevel,
    schoolName: optionalText_(entry.school_name) || null,
  };
  postStudent_(payload);
  mvpUpsertEntityRow_('students', 'student_id', externalId, {
    first_name: firstName,
    last_name: lastName,
    gender: payload.gender,
    phone_number: phoneNumber,
    email: payload.email,
    parent_phone_number: payload.parentPhoneNumber,
    parent_email: payload.parentEmail,
    date_of_birth: payload.dateOfBirth,
    grade_level: entry.grade_level || '',
    status: 'inactive',
    school_name: payload.schoolName,
    school_id: optionalText_(entry.school_id),
    address_id: optionalText_(entry.address_id),
  });
  studentDeactivateAssignmentRows_(externalId);
  mvpAppendArchive_({
    entityType: 'STUDENT',
    externalId,
    displayName: `${lastName} ${firstName}`.trim(),
    sourceSheet,
    previousStatus: 'ACTIVE',
    reason,
  });
  return true;
}

function studentDeactivateAssignmentRows_(externalStudentId) {
  const sheet = SpreadsheetApp.getActive().getSheetByName('counselor_assignments');
  if (!sheet || sheet.getLastRow() <= 1) return;
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0]
    .map(function(value) { return optionalText_(value); });
  const studentIndex = headers.indexOf('student_id');
  const statusIndex = headers.indexOf('status');
  const updatedIndex = headers.indexOf('updated_at');
  if (studentIndex < 0 || statusIndex < 0) return;
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  rows.forEach(function(row, index) {
    if (optionalText_(row[studentIndex]).toUpperCase() !== externalStudentId.toUpperCase()) return;
    sheet.getRange(index + 2, statusIndex + 1).setValue('inactive');
    if (updatedIndex >= 0) sheet.getRange(index + 2, updatedIndex + 1).setValue(new Date());
  });
}

function studentRefreshDeletionSnapshot_() {
  const spreadsheet = SpreadsheetApp.getActive();
  let snapshot = spreadsheet.getSheetByName(STUDENT_DELETION_SNAPSHOT_SHEET_);
  if (!snapshot) snapshot = spreadsheet.insertSheet(STUDENT_DELETION_SNAPSHOT_SHEET_);
  const snapshotHeaders = [
    'source_sheet', 'external_student_id', 'first_name', 'last_name', 'gender',
    'phone_number', 'email', 'parent_phone_number', 'parent_email', 'date_of_birth',
    'grade_level', 'status', 'school_level', 'school_id', 'school_name', 'address_id',
  ];
  const rows = [];
  Object.keys(STUDENT_MANAGEMENT_SHEETS).forEach(function(sheetName) {
    const sheet = spreadsheet.getSheetByName(sheetName);
    if (!sheet || sheet.getLastRow() <= 1) return;
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
    const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
    values.forEach(function(row) {
      const entry = Object.fromEntries(headers.map(function(header, index) { return [header, row[index]]; }));
      const externalId = optionalText_(entry.student_id);
      if (!externalId) return;
      rows.push([
        sheetName, externalId, entry.first_name || '', entry.last_name || '', entry.gender || '',
        entry.phone_number || '', entry.email || '', entry.parent_phone_number || '',
        entry.parent_email || '', entry.date_of_birth || '', entry.grade_level || '',
        entry.status || '', STUDENT_MANAGEMENT_SHEETS[sheetName], entry.school_id || '',
        entry.school_name || '', entry.address_id || '',
      ]);
    });
  });
  snapshot.clearContents();
  snapshot.getRange(1, 1, 1, snapshotHeaders.length).setValues([snapshotHeaders]);
  if (rows.length) snapshot.getRange(2, 1, rows.length, snapshotHeaders.length).setValues(rows);
  if (!snapshot.isSheetHidden()) snapshot.hideSheet();
}

function studentCurrentIdsForSheet_(sheetName) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() <= 1) return [];
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const idIndex = headers.indexOf('student_id');
  if (idIndex < 0) return [];
  return sheet.getRange(2, idIndex + 1, sheet.getLastRow() - 1, 1).getDisplayValues()
    .map(function(values) { return optionalText_(values[0]).toUpperCase(); })
    .filter(Boolean);
}

function studentAllCurrentIds_() {
  const ids = [];
  Object.keys(STUDENT_MANAGEMENT_SHEETS).forEach(function(sheetName) {
    studentCurrentIdsForSheet_(sheetName).forEach(function(id) {
      if (ids.indexOf(id) === -1) ids.push(id);
    });
  });
  return ids;
}

function studentStatusIsActive_(value) {
  const normalized = optionalText_(value).toLocaleLowerCase('vi-VN');
  return !normalized
    || normalized === 'active'
    || normalized === STUDENT_STATUS_ACTIVE_LABEL.toLocaleLowerCase('vi-VN');
}

function ensureStudentColumn_(sheet, header) {
  const width = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet.getRange(1, 1, 1, width).getDisplayValues()[0]
    .map(function(value) { return optionalText_(value); });
  if (headers.indexOf(header) >= 0) return;
  const targetColumn = width + 1;
  sheet.getRange(1, width)
    .copyTo(sheet.getRange(1, targetColumn), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  sheet.getRange(1, targetColumn).setValue(header);
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
