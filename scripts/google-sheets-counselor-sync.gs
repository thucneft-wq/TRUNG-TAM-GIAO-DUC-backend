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
const COUNSELOR_SNAPSHOT_SHEET_ = '__sync_counselors';

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
  counselorRefreshDeletionSnapshot_();
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

  // Manual data entry can emit one edit event per cell. Only the lifecycle
  // decision should start a backend sync; otherwise a single new profile can
  // fan out into many concurrent executions and exhaust the Apps Script limit.
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0]
    .map(function(header) { return counselorText_(header); });
  const statusColumn = headers.indexOf(COUNSELOR_STATUS_HEADER_) + 1;
  if (statusColumn <= 0) throw new Error(`Tab ${sheet.getName()} thiếu cột ${COUNSELOR_STATUS_HEADER_}.`);
  const firstColumn = event.range.getColumn();
  const lastColumn = firstColumn + event.range.getNumColumns() - 1;
  if (statusColumn < firstColumn || statusColumn > lastColumn) return;

  const firstRow = event.range.getRow();
  const lastRow = firstRow + event.range.getNumRows() - 1;
  for (let row = firstRow; row <= lastRow; row += 1) syncCounselorRow_(sheet, row);
}

function syncAllCounselors() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(COUNSELOR_FORM_SHEET_);
  if (!sheet) throw new Error(`Không tìm thấy tab ${COUNSELOR_FORM_SHEET_}.`);
  if (sheet.getLastRow() <= 1) {
    counselorPostReconcile_(counselorCurrentOfficialIds_());
    counselorRefreshDeletionSnapshot_();
    return;
  }
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const firstNameIndex = headers.indexOf('Tên');
  const lastNameIndex = headers.indexOf('Họ');
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getDisplayValues();
  rows.forEach(function(row, index) {
    if (counselorText_(row[firstNameIndex]) && counselorText_(row[lastNameIndex])) {
      syncCounselorRow_(sheet, index + 2);
    }
  });
  counselorPostReconcile_(counselorCurrentOfficialIds_());
  counselorRefreshDeletionSnapshot_();
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
  let existingExternalId = counselorText_(row[COUNSELOR_ID_HEADER_]);
  if (existingExternalId && counselorExternalIdUsedByAnotherRow_(sheet, rowNumber, existingExternalId)) {
    mvpSetCellByHeader_(sheet, rowNumber, COUNSELOR_ID_HEADER_, '');
    existingExternalId = '';
  }
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
    counselorRefreshDeletionSnapshot_();
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

function counselorExternalIdUsedByAnotherRow_(sheet, rowNumber, externalCounselorId) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0]
    .map(function(header) { return counselorText_(header); });
  const idColumn = headers.indexOf(COUNSELOR_ID_HEADER_) + 1;
  if (idColumn <= 0 || sheet.getLastRow() <= 1) return false;
  const normalizedId = counselorText_(externalCounselorId).toUpperCase();
  const duplicateResponse = sheet.getRange(2, idColumn, sheet.getLastRow() - 1, 1)
    .getDisplayValues()
    .some(function(values, index) {
      return index + 2 !== rowNumber
        && counselorText_(values[0]).toUpperCase() === normalizedId;
    });
  if (duplicateResponse) return true;

  const official = SpreadsheetApp.getActive().getSheetByName('counselors');
  if (!official || official.getLastRow() <= 1) return false;
  const officialHeaders = official.getRange(1, 1, 1, official.getLastColumn()).getDisplayValues()[0]
    .map(function(header) { return counselorText_(header); });
  const officialIdIndex = officialHeaders.indexOf('counselor_id');
  if (officialIdIndex < 0) return false;
  const officialRows = official.getRange(2, 1, official.getLastRow() - 1, official.getLastColumn())
    .getDisplayValues();
  const existing = officialRows.find(function(values) {
    return counselorText_(values[officialIdIndex]).toUpperCase() === normalizedId;
  });
  if (!existing) return false;

  const emailColumn = headers.indexOf('Email liên hệ') + 1;
  const phoneColumn = headers.indexOf('Số điện thoại liên hệ') + 1;
  const rawEmail = emailColumn > 0
    ? counselorText_(sheet.getRange(rowNumber, emailColumn).getDisplayValue()).toLowerCase()
    : '';
  const rawPhone = phoneColumn > 0
    ? counselorText_(sheet.getRange(rowNumber, phoneColumn).getDisplayValue()).replace(/\D/g, '')
    : '';
  const officialEmailIndex = officialHeaders.indexOf('email');
  const officialPhoneIndex = officialHeaders.indexOf('phone_number');
  const officialEmail = officialEmailIndex >= 0
    ? counselorText_(existing[officialEmailIndex]).toLowerCase()
    : '';
  const officialPhone = officialPhoneIndex >= 0
    ? counselorText_(existing[officialPhoneIndex]).replace(/\D/g, '')
    : '';
  const sameEmail = rawEmail && officialEmail && rawEmail === officialEmail;
  const samePhone = rawPhone && officialPhone && rawPhone === officialPhone;
  return !sameEmail && !samePhone;
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

function counselorHandleSheetRowDeletion_() {
  counselorPostReconcile_(counselorCurrentOfficialIds_());
  const spreadsheet = SpreadsheetApp.getActive();
  const snapshot = spreadsheet.getSheetByName(COUNSELOR_SNAPSHOT_SHEET_);
  if (!snapshot || snapshot.getLastRow() <= 1) {
    counselorRefreshDeletionSnapshot_();
    return;
  }

  const snapshotHeaders = snapshot.getRange(1, 1, 1, snapshot.getLastColumn()).getDisplayValues()[0];
  const snapshotRows = snapshot.getRange(2, 1, snapshot.getLastRow() - 1, snapshot.getLastColumn())
    .getValues();
  const previous = snapshotRows.map(function(values) {
    return Object.fromEntries(snapshotHeaders.map(function(header, index) {
      return [header, values[index]];
    }));
  });

  const officialIds = counselorCurrentOfficialIds_();
  const sourceIds = counselorCurrentSourceIds_();
  previous.forEach(function(entry) {
    const externalId = counselorText_(entry.external_counselor_id);
    if (!externalId) return;
    const removedFromOfficial = officialIds.indexOf(externalId.toUpperCase()) === -1;
    const trackedInSource = String(entry.track_source || '').toLowerCase() === 'true';
    const removedFromSource = trackedInSource && sourceIds.indexOf(externalId.toUpperCase()) === -1;
    if (!removedFromOfficial && !removedFromSource) return;

    const payload = {
      externalCounselorId: externalId,
      firstName: counselorText_(entry.first_name) || 'Tư vấn viên',
      lastName: counselorText_(entry.last_name) || externalId,
      gender: counselorText_(entry.gender) || null,
      phoneNumber: counselorText_(entry.phone_number) || null,
      email: counselorText_(entry.email) || null,
      dateOfBirth: counselorDate_(entry.date_of_birth),
      role: counselorText_(entry.role) || 'counselor',
      specialization: counselorText_(entry.specialization) || null,
      status: 'INACTIVE',
    };
    counselorPost_(payload);
    counselorMarkSourceInactive_(externalId);
    counselorUpdateExistingOfficialRow_(externalId, { status: 'inactive' });
    mvpAppendArchive_({
      entityType: 'COUNSELOR',
      externalId,
      displayName: `${payload.lastName} ${payload.firstName}`.trim(),
      sourceSheet: removedFromOfficial ? 'counselors' : COUNSELOR_FORM_SHEET_,
      previousStatus: 'ACTIVE',
      reason: 'Xóa dòng trên Sheet - tự động ngừng hoạt động',
    });
  });
  counselorRefreshDeletionSnapshot_();
}

function reconcileActiveCounselorsFromOfficialSheet() {
  const result = counselorPostReconcile_(counselorCurrentOfficialIds_());
  counselorRefreshDeletionSnapshot_();
  console.log(
    `Đã chuyển ${Number(result.deactivatedCounselors || 0)} tư vấn viên không còn trên Sheet sang INACTIVE.`,
  );
}

function counselorRefreshDeletionSnapshot_() {
  const spreadsheet = SpreadsheetApp.getActive();
  const official = spreadsheet.getSheetByName('counselors');
  if (!official) return;
  let snapshot = spreadsheet.getSheetByName(COUNSELOR_SNAPSHOT_SHEET_);
  if (!snapshot) snapshot = spreadsheet.insertSheet(COUNSELOR_SNAPSHOT_SHEET_);
  const snapshotHeaders = [
    'external_counselor_id', 'first_name', 'last_name', 'gender', 'phone_number',
    'email', 'date_of_birth', 'role', 'specialization', 'status', 'track_source',
  ];
  const rows = [];
  if (official.getLastRow() > 1) {
    const headers = official.getRange(1, 1, 1, official.getLastColumn()).getDisplayValues()[0];
    const values = official.getRange(2, 1, official.getLastRow() - 1, official.getLastColumn())
      .getValues();
    const sourceIds = counselorCurrentSourceIds_();
    values.forEach(function(row) {
      const record = Object.fromEntries(headers.map(function(header, index) {
        return [header, row[index]];
      }));
      const externalId = counselorText_(record.counselor_id || record.external_counselor_id);
      if (!externalId) return;
      rows.push([
        externalId,
        record.first_name || '',
        record.last_name || '',
        record.gender || '',
        record.phone_number || '',
        record.email || '',
        record.date_of_birth || '',
        record.role || 'counselor',
        record.specialization || '',
        record.status || '',
        sourceIds.indexOf(externalId.toUpperCase()) !== -1,
      ]);
    });
  }
  snapshot.clearContents();
  snapshot.getRange(1, 1, 1, snapshotHeaders.length).setValues([snapshotHeaders]);
  if (rows.length) snapshot.getRange(2, 1, rows.length, snapshotHeaders.length).setValues(rows);
  if (!snapshot.isSheetHidden()) snapshot.hideSheet();
}

function counselorCurrentOfficialIds_() {
  const sheet = SpreadsheetApp.getActive().getSheetByName('counselors');
  if (!sheet || sheet.getLastRow() <= 1) return [];
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const idIndex = headers.indexOf('counselor_id');
  if (idIndex < 0) return [];
  return sheet.getRange(2, idIndex + 1, sheet.getLastRow() - 1, 1).getDisplayValues()
    .map(function(values) { return counselorText_(values[0]).toUpperCase(); })
    .filter(Boolean);
}

function counselorCurrentSourceIds_() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(COUNSELOR_FORM_SHEET_);
  if (!sheet || sheet.getLastRow() <= 1) return [];
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const idIndex = headers.indexOf(COUNSELOR_ID_HEADER_);
  if (idIndex < 0) return [];
  return sheet.getRange(2, idIndex + 1, sheet.getLastRow() - 1, 1).getDisplayValues()
    .map(function(values) { return counselorText_(values[0]).toUpperCase(); })
    .filter(Boolean);
}

function counselorMarkSourceInactive_(externalId) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(COUNSELOR_FORM_SHEET_);
  if (!sheet || sheet.getLastRow() <= 1) return;
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const idIndex = headers.indexOf(COUNSELOR_ID_HEADER_);
  const statusIndex = headers.indexOf(COUNSELOR_STATUS_HEADER_);
  const syncIndex = headers.indexOf(COUNSELOR_SYNC_HEADER_);
  if (idIndex < 0 || statusIndex < 0) return;
  const ids = sheet.getRange(2, idIndex + 1, sheet.getLastRow() - 1, 1).getDisplayValues();
  ids.forEach(function(values, index) {
    if (counselorText_(values[0]).toUpperCase() !== externalId.toUpperCase()) return;
    const rowNumber = index + 2;
    sheet.getRange(rowNumber, statusIndex + 1).setValue('Ngừng hoạt động');
    if (syncIndex >= 0) {
      sheet.getRange(rowNumber, syncIndex + 1)
        .setValue(mvpSyncTimestamp_('Đã ngừng hoạt động do xóa dòng'));
    }
  });
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

function counselorPostReconcile_(activeExternalCounselorIds) {
  const properties = PropertiesService.getScriptProperties();
  const configuredBase = counselorText_(
    properties.getProperty('BACKEND_SYNC_BASE_URL') || properties.getProperty('BACKEND_BASE_URL'),
  ).replace(/\/$/, '');
  const secret = counselorText_(properties.getProperty('GOOGLE_SHEETS_SYNC_SECRET'));
  if (!configuredBase || !secret) throw new Error('Thiếu cấu hình backend hoặc khóa đồng bộ.');
  const endpoint = /\/integrations\/google-sheets$/i.test(configuredBase)
    ? `${configuredBase}/counselors/reconcile`
    : `${configuredBase}/integrations/google-sheets/counselors/reconcile`;
  const response = UrlFetchApp.fetch(endpoint, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: `Bearer ${secret}` },
    payload: JSON.stringify({ activeExternalCounselorIds }),
    muteHttpExceptions: true,
  });
  const status = response.getResponseCode();
  if (status < 200 || status >= 300) {
    throw new Error(`Backend counselor reconcile trả về HTTP ${status}: ${response.getContentText()}`);
  }
  const text = response.getContentText();
  return text ? JSON.parse(text) : { deactivatedCounselors: 0, closedAssignments: 0 };
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
