/**
 * Synchronizes counselor recruitment responses with PostgreSQL through backend.
 */

const COUNSELOR_FORM_SHEET_ = 'Đăng ký Tư vấn viên tâm lý học đường';
const COUNSELOR_STATUS_HEADER_ = 'Trạng thái';
const COUNSELOR_ID_HEADER_ = 'Mã tư vấn viên';
const COUNSELOR_SYNC_HEADER_ = 'Trạng thái đồng bộ';
const COUNSELOR_PENDING_LABEL_ = 'Chờ duyệt';
const COUNSELOR_APPROVED_LABEL_ = 'Đã duyệt';
const COUNSELOR_REJECTED_LABEL_ = 'Từ chối';

function setupCounselorApprovalColumns() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(COUNSELOR_FORM_SHEET_);
  if (!sheet) throw new Error(`Không tìm thấy tab ${COUNSELOR_FORM_SHEET_}.`);
  [COUNSELOR_STATUS_HEADER_, COUNSELOR_ID_HEADER_, COUNSELOR_SYNC_HEADER_].forEach(function(header) {
    counselorEnsureColumn_(sheet, header);
  });
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const statusColumn = headers.indexOf(COUNSELOR_STATUS_HEADER_) + 1;
  const idColumn = headers.indexOf(COUNSELOR_ID_HEADER_) + 1;
  const syncColumn = headers.indexOf(COUNSELOR_SYNC_HEADER_) + 1;
  const validation = SpreadsheetApp.newDataValidation()
    .requireValueInList([
      COUNSELOR_PENDING_LABEL_,
      COUNSELOR_APPROVED_LABEL_,
      'Tạm nghỉ',
      'Ngừng hoạt động',
      COUNSELOR_REJECTED_LABEL_,
    ], true)
    .setAllowInvalid(false)
    .setHelpText('Hồ sơ chỉ được tạo trên hệ thống sau khi Admin chọn “Đã duyệt”.')
    .build();
  sheet.getRange(2, statusColumn, Math.max(sheet.getMaxRows() - 1, 1), 1)
    .setDataValidation(validation);
  sheet.getRange(1, statusColumn).setNote(
    'Đăng ký mới mặc định Chờ duyệt và không xuất hiện trên Web. Chọn Đã duyệt để kích hoạt.',
  );
  sheet.setColumnWidth(statusColumn, 170);
  if (idColumn > 0) sheet.hideColumns(idColumn);
  if (syncColumn > 0) sheet.hideColumns(syncColumn);
}

function installCounselorSyncTriggers() {
  installMvpSyncTriggers();
}

function handleCounselorFormSubmit(event) {
  if (!event || !event.range) throw new Error('Thiếu dữ liệu sự kiện gửi Google Form.');
  const sheet = event.range.getSheet();
  if (sheet.getName() !== COUNSELOR_FORM_SHEET_) return;
  if (!mvpCellByHeader_(sheet, event.range.getRow(), COUNSELOR_STATUS_HEADER_)) {
    mvpSetCellByHeader_(sheet, event.range.getRow(), COUNSELOR_STATUS_HEADER_, COUNSELOR_PENDING_LABEL_);
  }
  syncCounselorRow_(sheet, event.range.getRow());
}

function handleCounselorEdit(event) {
  if (!event || !event.range || event.range.getRow() <= 1) return;
  const sheet = event.range.getSheet();
  if (sheet.getName() !== COUNSELOR_FORM_SHEET_) return;
  const firstRow = event.range.getRow();
  const lastRow = firstRow + event.range.getNumRows() - 1;
  for (let row = firstRow; row <= lastRow; row += 1) syncCounselorRow_(sheet, row);
}

function syncAllCounselors() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(COUNSELOR_FORM_SHEET_);
  if (!sheet) throw new Error(`Không tìm thấy tab ${COUNSELOR_FORM_SHEET_}.`);
  if (sheet.getLastRow() <= 1) return;
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const firstNameIndex = headers.indexOf('Tên');
  const lastNameIndex = headers.indexOf('Họ');
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getDisplayValues();
  rows.forEach(function(row, index) {
    if (counselorText_(row[firstNameIndex]) && counselorText_(row[lastNameIndex])) {
      syncCounselorRow_(sheet, index + 2);
    }
  });
}

function syncCounselorRow_(sheet, rowNumber) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const values = sheet.getRange(rowNumber, 1, 1, sheet.getLastColumn()).getValues()[0];
  const row = Object.fromEntries(headers.map(function(header, index) {
    return [String(header || '').trim(), values[index]];
  }));
  const firstName = counselorText_(row['Tên']);
  const lastName = counselorText_(row['Họ']);
  if (!firstName || !lastName) return false;

  const approval = counselorApproval_(row[COUNSELOR_STATUS_HEADER_]);
  const existingExternalId = counselorText_(row[COUNSELOR_ID_HEADER_]);
  const maySyncExistingLifecycle = approval === 'EXISTING_ONLY' && existingExternalId;
  if (approval !== 'APPROVED' && !maySyncExistingLifecycle) {
    if (existingExternalId) {
      counselorDeactivatePending_(sheet, rowNumber, row, existingExternalId, firstName, lastName);
    } else {
      const label = approval === 'REJECTED' ? 'Đã từ chối' : 'Chờ admin duyệt';
      mvpSetCellByHeader_(sheet, rowNumber, COUNSELOR_SYNC_HEADER_, label);
    }
    return false;
  }

  const externalCounselorId = existingExternalId
    || mvpEnsureExternalId_(sheet, rowNumber, COUNSELOR_ID_HEADER_, 'TTV');
  const status = counselorStatus_(row[COUNSELOR_STATUS_HEADER_]);
  const experience = counselorText_(row['Số năm kinh nghiệm']);
  const qualifications = counselorText_(row['Chuyên môn và chứng chỉ']);
  const specialization = [qualifications, experience ? `Kinh nghiệm: ${experience} năm` : '']
    .filter(Boolean)
    .join('; ');
  const payload = {
    externalCounselorId,
    firstName,
    lastName,
    gender: counselorGender_(row['Giới tính']),
    phoneNumber: counselorText_(row['Số điện thoại liên hệ']) || null,
    email: counselorText_(row['Email liên hệ']) || null,
    dateOfBirth: counselorDate_(row['Ngày sinh']),
    role: 'counselor',
    specialization: specialization || null,
    status,
  };

  try {
    counselorPost_(payload);
    mvpSetCellByHeader_(sheet, rowNumber, COUNSELOR_SYNC_HEADER_, mvpSyncTimestamp_('Đã đồng bộ'));
    mvpUpsertEntityRow_('counselors', 'counselor_id', externalCounselorId, {
      first_name: firstName,
      last_name: lastName,
      gender: payload.gender,
      phone_number: payload.phoneNumber,
      email: payload.email,
      date_of_birth: payload.dateOfBirth,
      role: payload.role,
      status: status.toLowerCase(),
      specialization: payload.specialization,
    });
    if (status === 'INACTIVE') {
      mvpAppendArchive_({
        entityType: 'COUNSELOR',
        externalId: externalCounselorId,
        displayName: `${lastName} ${firstName}`.trim(),
        sourceSheet: sheet.getName(),
        sourceRow: rowNumber,
        previousStatus: status,
        reason: 'Ngừng hoạt động',
      });
    }
    return true;
  } catch (error) {
    mvpSetCellByHeader_(sheet, rowNumber, COUNSELOR_SYNC_HEADER_, `Lỗi: ${error.message}`);
    throw error;
  }
}

function counselorDeactivatePending_(sheet, rowNumber, row, externalCounselorId, firstName, lastName) {
  const payload = counselorPayload_(row, externalCounselorId, firstName, lastName, 'INACTIVE');
  counselorPost_(payload);
  counselorUpdateExistingOfficialRow_(externalCounselorId, {
    first_name: firstName,
    last_name: lastName,
    gender: payload.gender,
    phone_number: payload.phoneNumber,
    email: payload.email,
    date_of_birth: payload.dateOfBirth,
    role: payload.role,
    status: 'inactive',
    specialization: payload.specialization,
  });
  const approval = counselorApproval_(row[COUNSELOR_STATUS_HEADER_]);
  const label = approval === 'REJECTED' ? 'Đã từ chối và ẩn khỏi Web' : 'Chờ duyệt - đã ẩn khỏi Web';
  mvpSetCellByHeader_(sheet, rowNumber, COUNSELOR_SYNC_HEADER_, mvpSyncTimestamp_(label));
}

function counselorUpdateExistingOfficialRow_(externalCounselorId, valuesByHeader) {
  const sheet = SpreadsheetApp.getActive().getSheetByName('counselors');
  if (!sheet || sheet.getLastRow() <= 1) return;
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const idIndex = headers.indexOf('counselor_id');
  if (idIndex < 0) return;
  const ids = sheet.getRange(2, idIndex + 1, sheet.getLastRow() - 1, 1).getDisplayValues().flat();
  const exists = ids.some(function(value) {
    return counselorText_(value).toUpperCase() === externalCounselorId.toUpperCase();
  });
  if (exists) mvpUpsertEntityRow_('counselors', 'counselor_id', externalCounselorId, valuesByHeader);
}

function counselorPayload_(row, externalCounselorId, firstName, lastName, status) {
  const experience = counselorText_(row['Số năm kinh nghiệm']);
  const qualifications = counselorText_(row['Chuyên môn và chứng chỉ']);
  const specialization = [qualifications, experience ? `Kinh nghiệm: ${experience} năm` : '']
    .filter(Boolean)
    .join('; ');
  return {
    externalCounselorId,
    firstName,
    lastName,
    gender: counselorGender_(row['Giới tính']),
    phoneNumber: counselorText_(row['Số điện thoại liên hệ']) || null,
    email: counselorText_(row['Email liên hệ']) || null,
    dateOfBirth: counselorDate_(row['Ngày sinh']),
    role: 'counselor',
    specialization: specialization || null,
    status,
  };
}

function counselorPost_(payload) {
  const properties = PropertiesService.getScriptProperties();
  const configuredBase = counselorText_(
    properties.getProperty('BACKEND_SYNC_BASE_URL') || properties.getProperty('BACKEND_BASE_URL'),
  ).replace(/\/$/, '');
  const secret = counselorText_(properties.getProperty('GOOGLE_SHEETS_SYNC_SECRET'));
  if (!configuredBase || !secret) throw new Error('Thiếu cấu hình backend hoặc khóa đồng bộ.');
  const endpoint = /\/integrations\/google-sheets$/i.test(configuredBase)
    ? `${configuredBase}/counselors`
    : `${configuredBase}/integrations/google-sheets/counselors`;
  const response = UrlFetchApp.fetch(endpoint, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: `Bearer ${secret}` },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
    throw new Error(`Backend trả về HTTP ${response.getResponseCode()}: ${response.getContentText()}`);
  }
}

function counselorStatus_(value) {
  const normalized = counselorText_(value).toLocaleLowerCase('vi-VN');
  if (normalized === 'tạm nghỉ' || normalized === 'on_leave') return 'ON_LEAVE';
  if (normalized === 'ngừng hoạt động' || normalized === 'inactive') return 'INACTIVE';
  return 'ACTIVE';
}

function counselorApproval_(value) {
  const normalized = counselorText_(value).toLocaleLowerCase('vi-VN');
  if (!normalized || normalized === 'chờ duyệt' || normalized === 'pending' || normalized === 'pending_review') {
    return 'PENDING';
  }
  if (normalized === 'từ chối' || normalized === 'rejected') return 'REJECTED';
  if (normalized === 'đã duyệt' || normalized === 'đang hoạt động' || normalized === 'active') {
    return 'APPROVED';
  }
  if (
    normalized === 'tạm nghỉ'
    || normalized === 'on_leave'
    || normalized === 'ngừng hoạt động'
    || normalized === 'inactive'
  ) {
    return 'EXISTING_ONLY';
  }
  return 'PENDING';
}

function counselorEnsureColumn_(sheet, headerName) {
  const columnCount = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet.getRange(1, 1, 1, columnCount).getDisplayValues()[0]
    .map(function(header) { return counselorText_(header); });
  if (headers.indexOf(headerName) >= 0) return;
  const targetColumn = columnCount + 1;
  sheet.getRange(1, columnCount)
    .copyTo(sheet.getRange(1, targetColumn), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  sheet.getRange(1, targetColumn).setValue(headerName);
}

function counselorGender_(value) {
  const normalized = counselorText_(value).toLocaleLowerCase('vi-VN');
  if (normalized === 'nam') return 'MALE';
  if (normalized === 'nữ' || normalized === 'nu') return 'FEMALE';
  return normalized ? 'OTHER' : null;
}

function counselorDate_(value) {
  if (!value) return null;
  if (Object.prototype.toString.call(value) === '[object Date]' && !Number.isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return counselorText_(value) || null;
}

function counselorText_(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}
