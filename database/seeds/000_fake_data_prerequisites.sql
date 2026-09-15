BEGIN;

-- Du lieu nen toi thieu ma fake_data.sql dang tham chieu.
-- Chi dung cho moi truong demo/local.

INSERT INTO Addresses (
    address_id,
    street_address,
    ward,
    city,
    province,
    country
) VALUES
    ('a0000000-0000-0000-0000-000000000001', 'Duong Demo 1', 'Phuong Demo 1', 'TP. Ho Chi Minh', 'TP. Ho Chi Minh', 'Viet Nam'),
    ('a0000000-0000-0000-0000-000000000002', 'Duong Demo 2', 'Phuong Demo 2', 'TP. Ho Chi Minh', 'TP. Ho Chi Minh', 'Viet Nam'),
    ('a0000000-0000-0000-0000-000000000003', 'Duong Demo 3', 'Phuong Demo 3', 'TP. Ho Chi Minh', 'TP. Ho Chi Minh', 'Viet Nam')
ON CONFLICT (address_id) DO NOTHING;

INSERT INTO Schools (school_id, school_name, address_id) VALUES
    ('b0000000-0000-0000-0000-000000000001', 'Truong THCS Demo', 'a0000000-0000-0000-0000-000000000001'),
    ('b0000000-0000-0000-0000-000000000002', 'Truong THPT Demo', 'a0000000-0000-0000-0000-000000000002')
ON CONFLICT (school_id) DO NOTHING;

INSERT INTO Tests (test_id, test_name, test_type, status, platform) VALUES
    ('33333333-0000-0000-0000-000000000001', 'DASS-21 Demo', 'MENTAL_HEALTH', 'ACTIVE', 'GOOGLE_FORMS'),
    ('33333333-0000-0000-0000-000000000002', 'Holland Demo', 'CAREER_GUIDANCE', 'ACTIVE', 'GOOGLE_FORMS')
ON CONFLICT (test_id) DO NOTHING;

COMMIT;
