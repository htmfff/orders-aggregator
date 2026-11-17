-- amount_kop остаётся суммой заказа до скидки (gross) для обратной совместимости.
-- amount_paid_kop — то, что клиент фактически заплатил (net).
ALTER TABLE orders ADD COLUMN amount_paid_kop BIGINT;
UPDATE orders SET amount_paid_kop = amount_kop;
ALTER TABLE orders ALTER COLUMN amount_paid_kop SET NOT NULL;
