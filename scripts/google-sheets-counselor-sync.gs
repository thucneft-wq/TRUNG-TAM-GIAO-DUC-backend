/**
 * Synchronizes counselor recruitment responses with PostgreSQL through backend.
 */

const COUNSELOR_FORM_SHEET_ = 'Đăng ký Tư vấn viên tâm lý học đường';
const COUNSELOR_STATUS_HEADER_ = 'Trạng thái';
const COUNSELOR_ID_HEADER_ = 'Mã tư vấn viên';
const COUNSELOR_SYNC_HEADER_ = 'Trạng thái đồng bộ';

function installCounselorSyncTriggers() {
  const spreadsheet = SpreadsheetApp.getActive();
  const handlers = ['handleCounselorFormSubmit', 'handleCounselorEdit'];
  ScriptApp.getProjectTriggers()
    .filter(function(trigger) {
      return handlers.indexOf(trigger.getHandlerFunction()) !== -1;
    })
    .forEach(function(trigger) {
      ScriptApp.deleteTrigger(trigger);
    });
  ScriptApp.newTrigger('handleCounselorFormSubmit').forSpreadsheet(spreadsheet).onFormSubmit().create();
  ScriptApp.newTrigger('handleCounselorEdit').forSpreadsheet(spreadsheet).onEdit().create();
}

function handleCounselorFormSubmit(event) {
  if (!event || !event.range) throw new Error('Thiếu dữ liệu sự kiện gửi Google Form.');
  const sheet = event.range.getSheet();
  if (sheet.getName() !== COUNSELOR_FORM_SHEET_) return;
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
  for (let row = 2; row <= sheet.getLastRow(); row += 1) syncCounselorRow_(sheet, row);
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

  const externalCounselorId = counselorText_(row[COUNSELOR_ID_HEADER_])
    || mvpEnsureExternalId_(sheet, rowNumber, COUNSELOR_ID_HEADER_, 'TTV');
  const status = counselorStatus_(row[COUNSELOR_STATUS_HEADER_]);
  if (!counselorText_(row[COUNSELOR_STATUS_HEADER_])) {
    mvpSetCellByHeader_(sheet, rowNumber, COUNSELOR_STATUS_HEADER_, 'Đang hoạt động');
  }
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
    headers: { 'x-google-sync-secret': secret },
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
